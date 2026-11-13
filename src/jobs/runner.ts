/**
 * Every background job runs through `runJob`, which writes a job_run record
 * (started, finished, items, errors). A failed job is recorded as FAILED, alerts
 * the administrators by email, and re-throws so the queue retries it. Nothing
 * fails silently (BUILD_SPEC Section 11).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { generateObligations } from "../lib/engine/generate";
import { runDigests, runLeadReminders, runReminders } from "../lib/engine/reminders";
import { deliver } from "../lib/mailer";
import { syncOutlookToTimeline } from "../lib/connectors/mail-sync";

export const JOBS = {
  "generate-obligations": { cron: "0 1 * * *", run: async () => { const r = await generateObligations(); return { processed: r.processed, created: r.created, detail: { missingData: r.missing.length } }; } },
  "send-reminders": { cron: "5 * * * *", run: async () => { const r = await runReminders(); return { processed: r.considered, created: r.sent, errors: r.failed, detail: r }; } },
  "send-digests": { cron: "10 * * * *", run: async () => { const r = await runDigests(); return { processed: r.digests + r.summaries + r.skipped, created: r.digests + r.summaries, detail: r }; } },
  "lead-reminders": { cron: "15 8 * * *", run: async () => { const r = await runLeadReminders(); return { processed: r.sent, created: r.sent }; } },
  "outlook-sync": { cron: "*/15 * * * *", run: async () => { const r = await syncOutlookToTimeline(); return { processed: r.scanned, created: r.linked, detail: r }; } },
} as const;

export type JobName = keyof typeof JOBS;

type Out = { processed: number; created: number; errors?: number; detail?: unknown };

export async function runJob(name: JobName): Promise<Out> {
  const run = await prisma.jobRun.create({ data: { jobName: name } });
  try {
    const out = (await JOBS[name].run()) as Out;
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: out.errors ? "FAILED" : "SUCCEEDED", itemsProcessed: out.processed, itemsCreated: out.created, errorCount: out.errors ?? 0, detail: (out.detail ?? undefined) as Prisma.InputJsonValue | undefined },
    });
    if (out.errors) await alertAdmins(name, `${out.errors} item(s) failed. See Settings → Jobs.`);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: "FAILED", errorCount: 1, detail: { error: msg } } });
    await alertAdmins(name, msg);
    throw e;
  }
}

async function alertAdmins(job: string, message: string) {
  console.error(JSON.stringify({ level: "error", event: "job_failed", job, message }));
  const admins = await prisma.user.findMany({ where: { isActive: true, role: { key: { in: ["ADMINISTRATOR", "MANAGING_PARTNER"] } } } });
  try {
    if (admins.length) await deliver({ to: admins.map((a) => a.email), subject: `[ALERT] Background job failed: ${job}`, text: `${job} failed at ${new Date().toISOString()}.\n\n${message}\n\nCheck ${process.env.APP_URL ?? ""}/settings/jobs` });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "alert_delivery_failed", job, message: e instanceof Error ? e.message : String(e) }));
  }
}
