import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Health: database reachable and the reminder job has run recently. A stalled reminder engine is unhealthy. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const last = await prisma.jobRun.findFirst({ where: { jobName: "send-reminders", status: "SUCCEEDED" }, orderBy: { startedAt: "desc" } });
    const failed24h = await prisma.jobRun.count({ where: { status: "FAILED", startedAt: { gte: new Date(Date.now() - 86_400_000) } } });
    const stale = !last || Date.now() - last.startedAt.getTime() > 3 * 3_600_000;
    const body = { status: stale || failed24h ? "degraded" : "ok", database: "ok", lastReminderRun: last?.startedAt ?? null, failedJobs24h: failed24h };
    return NextResponse.json(body, { status: stale ? 503 : 200 });
  } catch {
    return NextResponse.json({ status: "down", database: "unreachable" }, { status: 503 });
  }
}
