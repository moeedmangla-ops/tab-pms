/**
 * Reminder engine (BUILD_SPEC Section 6). Runs hourly.
 *
 * Deduplication: before any send, a reminder_log row is inserted with a unique
 * dedupe key  obligation|rule|recipient|scheduledDate. If the insert conflicts,
 * the reminder was already handled and is skipped. A re-run can never send twice.
 *
 * Non-working days: nothing fires on a weekend or holiday. "N days before"
 * reminders whose date lands on a non-working day are moved to the previous
 * working day.
 */
import { Obligation, Prisma, ReminderRule, ReminderTrack, User } from "@prisma/client";
import { prisma } from "../db";
import { YMD, addDays, diffDays, formatDate, fromDbDate, hourDubai, toDbDate, todayDubai, WorkingCalendar } from "../dates";
import { loadCalendar } from "./calendar";
import { CLOSED, FILED, STATUS_LABEL } from "./workflow";
import { deliver, render } from "../mailer";
import { getSetting } from "../settings";
import { randomUUID } from "node:crypto";

const OPEN_WHERE: Prisma.ObligationWhereInput = {
  deletedAt: null,
  status: { notIn: [...FILED, ...CLOSED] },
  client: { deletedAt: null, status: { in: ["ACTIVE", "ON_HOLD"] } },
};

type Ob = Obligation & {
  client: { id: string; legalName: string; clientCode: string; relationshipPartnerId: string | null; contacts: { name: string; email: string | null; isPrimary: boolean; isAccounts: boolean }[] };
  preparer: User | null;
  reviewer: User | null;
  engagement: { manager: User | null; partner: User | null } | null;
};

const OB_INCLUDE = {
  client: { select: { id: true, legalName: true, clientCode: true, relationshipPartnerId: true, contacts: { where: { deletedAt: null }, select: { name: true, email: true, isPrimary: true, isAccounts: true } } } },
  preparer: true,
  reviewer: true,
  engagement: { select: { manager: true, partner: true } },
} satisfies Prisma.ObligationInclude;

export type Recipient = { email: string; name: string; userId?: string };

function onLeave(u: User, today: YMD) {
  return !!(u.onLeaveFrom && u.onLeaveTo && fromDbDate(u.onLeaveFrom) <= today && fromDbDate(u.onLeaveTo) >= today);
}

function userRecipient(u: User | null | undefined): Recipient | null {
  return u && u.isActive ? { email: u.email, name: u.name, userId: u.id } : null;
}

async function partnerFor(o: Ob): Promise<User | null> {
  if (o.engagement?.partner) return o.engagement.partner;
  if (o.client.relationshipPartnerId) return prisma.user.findUnique({ where: { id: o.client.relationshipPartnerId } });
  return null;
}

/**
 * Who receives a reminder on a track. A staff member on leave is replaced by
 * their manager (or the engagement manager) so a reminder never goes only to
 * someone who is away.
 */
export async function recipientsFor(track: ReminderTrack, o: Ob, today: YMD): Promise<Recipient[]> {
  const withCover = async (u: User | null): Promise<Recipient[]> => {
    if (!u) {
      const m = userRecipient(o.engagement?.manager);
      return m ? [m] : []; // unassigned → engagement manager
    }
    if (!onLeave(u, today)) return [userRecipient(u)].filter(Boolean) as Recipient[];
    const cover = u.managerId ? await prisma.user.findUnique({ where: { id: u.managerId } }) : o.engagement?.manager;
    return [userRecipient(cover ?? null)].filter(Boolean) as Recipient[];
  };
  const clientContact = () => {
    const c = o.client.contacts.find((x) => x.isAccounts && x.email) ?? o.client.contacts.find((x) => x.isPrimary && x.email) ?? o.client.contacts.find((x) => x.email);
    return c?.email ? [{ email: c.email, name: c.name }] : [];
  };
  switch (track) {
    case "INTERNAL_PREPARER":
      return withCover(o.preparer);
    case "INTERNAL_REVIEWER":
      return withCover(o.reviewer);
    case "MANAGER_ESCALATION":
      return withCover(o.engagement?.manager ?? o.reviewer);
    case "PARTNER_ESCALATION":
      return [userRecipient(await partnerFor(o))].filter(Boolean) as Recipient[];
    case "CLIENT_DOCUMENT_REQUEST":
      return ["UPCOMING", "DOCUMENTS_REQUESTED"].includes(o.status) ? clientContact() : [];
    case "CLIENT_APPROVAL_REQUEST":
      return o.status === "PENDING_CLIENT_APPROVAL" ? clientContact() : [];
    case "PAYMENT_FOLLOW_UP":
      return o.status === "PAYMENT_PENDING" ? clientContact() : [];
    default:
      return [];
  }
}


/**
 * Claim a dedupe key: inserts the reminder_log row unless the key already exists.
 * Returns the new row id, or null when the reminder was already handled.
 * (INSERT … ON CONFLICT DO NOTHING — no error is raised or logged for a duplicate.)
 */
export async function claimDedupe(d: { obligationId?: string | null; ruleId?: string | null; track: ReminderTrack; recipientEmail: string; recipientUserId?: string | null; templateKey: string; subject: string; scheduledFor: YMD; dedupeKey: string }): Promise<string | null> {
  const id = `rl_${randomUUID()}`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO reminder_log (id, "obligationId", "ruleId", track, "recipientEmail", "recipientUserId", channel, "templateKey", subject, "scheduledFor", status, attempts, "dedupeKey", "createdAt")
    VALUES (${id}, ${d.obligationId ?? null}, ${d.ruleId ?? null}, ${d.track}::"ReminderTrack", ${d.recipientEmail}, ${d.recipientUserId ?? null}, 'email', ${d.templateKey}, ${d.subject}, ${d.scheduledFor}::date, 'QUEUED'::"DeliveryStatus", 0, ${d.dedupeKey}, now())
    ON CONFLICT ("dedupeKey") DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export function dedupeKey(obligationId: string, ruleId: string, recipient: string, scheduled: YMD) {
  return `${obligationId}|${ruleId}|${recipient.toLowerCase()}|${scheduled}`;
}

/** The date an "N days before" reminder fires: moved back to a working day. */
export function sendDateBefore(statutory: YMD, offset: number, cal: WorkingCalendar): YMD {
  return cal.onOrBefore(addDays(statutory, -offset));
}

type Due = { o: Ob; rule: ReminderRule; scheduled: YMD; label: string };

/** Which (obligation, rule, scheduled date) reminders are due today. Pure apart from the queries. */
export async function findDue(today: YMD, cal: WorkingCalendar): Promise<Due[]> {
  const rules = await prisma.reminderRule.findMany({ where: { isActive: true, track: { notIn: ["DAILY_DIGEST", "WEEKLY_PARTNER_SUMMARY", "LEAD_FOLLOW_UP", "TASK_ESCALATION"] } } });
  const disabledTypes = (await prisma.obligationTypeSetting.findMany({ where: { remindersEnabled: false } })).map((t) => t.type);
  const due: Due[] = [];
  const CATCH_UP = 3; // a missed run (outage) is caught up within 3 days

  for (const rule of rules) {
    const typeWhere: Prisma.ObligationWhereInput = rule.obligationType ? { type: rule.obligationType } : { type: { notIn: disabledTypes } };
    if (rule.trigger === "BEFORE_STATUTORY") {
      const maxOff = Math.max(...rule.offsetsDays, 0);
      const obs = (await prisma.obligation.findMany({
        where: { ...OPEN_WHERE, ...typeWhere, statutoryDueDate: { gte: toDbDate(addDays(today, -1)), lte: toDbDate(addDays(today, maxOff + 14)) } },
        include: OB_INCLUDE,
      })) as Ob[];
      for (const o of obs) {
        const stat = fromDbDate(o.statutoryDueDate);
        for (const off of rule.offsetsDays) {
          const send = sendDateBefore(stat, off, cal);
          if (send <= today && send > addDays(today, -CATCH_UP) && stat >= today) {
            due.push({ o, rule, scheduled: send, label: off === 0 ? "due today" : `due in ${diffDays(stat, today)} day(s)` });
          }
        }
      }
    } else if (rule.trigger === "OVERDUE_REPEAT") {
      const every = rule.repeatEveryDays ?? 2;
      const obs = (await prisma.obligation.findMany({
        where: { ...OPEN_WHERE, ...typeWhere, statutoryDueDate: { lt: toDbDate(today) } },
        include: OB_INCLUDE,
      })) as Ob[];
      for (const o of obs) {
        const daysOver = diffDays(today, fromDbDate(o.statutoryDueDate));
        // one reminder per `every`-day bucket, keyed on the bucket's first day
        const bucketStart = addDays(fromDbDate(o.statutoryDueDate), Math.floor((daysOver - 1) / every) * every + 1);
        due.push({ o, rule, scheduled: bucketStart, label: `overdue by ${daysOver} day(s)` });
      }
    } else if (rule.trigger === "AT_PREP_DEADLINE") {
      const obs = (await prisma.obligation.findMany({
        where: { ...OPEN_WHERE, ...typeWhere, prepDeadline: { lte: toDbDate(today) }, status: { in: ["UPCOMING", "DOCUMENTS_REQUESTED", "DOCUMENTS_RECEIVED", "IN_PREPARATION", "PENDING_INTERNAL_REVIEW", "PENDING_CLIENT_APPROVAL"] } },
        include: OB_INCLUDE,
      })) as Ob[];
      for (const o of obs) due.push({ o, rule, scheduled: fromDbDate(o.prepDeadline), label: "past internal preparation deadline" });
    } else if (rule.trigger === "BEFORE_STATUTORY_OPEN") {
      const off = rule.offsetsDays[0] ?? 3;
      const obs = (await prisma.obligation.findMany({
        where: { ...OPEN_WHERE, ...typeWhere, statutoryDueDate: { lte: toDbDate(addDays(today, off + 7)) } },
        include: OB_INCLUDE,
      })) as Ob[];
      for (const o of obs) {
        const send = sendDateBefore(fromDbDate(o.statutoryDueDate), off, cal);
        if (send <= today) due.push({ o, rule, scheduled: send, label: `still open, statutory date ${formatDate(o.statutoryDueDate)}` });
      }
    }
  }
  return due;
}

async function templateFor(key: string) {
  const t = await prisma.emailTemplate.findUnique({ where: { key } });
  if (!t) throw new Error(`Email template "${key}" is missing.`);
  return t;
}

function vars(o: Ob, r: Recipient, label: string) {
  return {
    recipient_name: r.name,
    client_name: o.client.legalName,
    client_code: o.client.clientCode,
    obligation_title: o.title,
    status: STATUS_LABEL[o.status],
    statutory_due_date: formatDate(o.statutoryDueDate),
    internal_target_date: formatDate(o.internalTargetDate),
    prep_deadline: formatDate(o.prepDeadline),
    reminder_reason: label,
    link: `${process.env.APP_URL ?? ""}/obligations/${o.id}`,
  };
}

export type ReminderRunResult = { considered: number; sent: number; skippedDuplicate: number; paused: number; failed: number; errors: string[] };

export async function runReminders(now = new Date()): Promise<ReminderRunResult> {
  const today = todayDubai(now);
  const cal = await loadCalendar();
  const res: ReminderRunResult = { considered: 0, sent: 0, skippedDuplicate: 0, paused: 0, failed: 0, errors: [] };
  if (!cal.isWorkingDay(today)) return res; // never fire on a non-working day

  const due = await findDue(today, cal);
  for (const d of due) {
    const recips = await recipientsFor(d.rule.track, d.o, today);
    for (const r of recips) {
      res.considered++;
      const key = dedupeKey(d.o.id, d.rule.id, r.email, d.scheduled);
      const tpl = await templateFor(d.rule.templateKey);
      const v = vars(d.o, r, d.label);
      const subject = render(tpl.subject, v);
      // Claim the dedupe key first. Already claimed = already handled → skip.
      const logId = await claimDedupe({ obligationId: d.o.id, ruleId: d.rule.id, track: d.rule.track, recipientEmail: r.email, recipientUserId: r.userId, templateKey: tpl.key, subject, scheduledFor: d.scheduled, dedupeKey: key });
      if (!logId) {
        res.skippedDuplicate++;
        continue;
      }
      await sendLogged(logId, { to: [r.email], cc: ccFor(d), subject, text: render(tpl.body, v) }, res);
    }
  }
  await retryFailed(res);
  return res;
}

function ccFor(d: Due): string[] | undefined {
  return undefined; // obligation reminders: no cc. (Invoice ladder copies the partner from 30 days — Phase 3.)
}

async function sendLogged(logId: string, mail: { to: string[]; cc?: string[]; subject: string; text: string }, res: ReminderRunResult) {
  try {
    const r = await deliver(mail);
    if (r.status === "SKIPPED_PAUSED") res.paused++;
    else res.sent++;
    await prisma.reminderLog.update({ where: { id: logId }, data: { status: r.status, sentAt: r.status === "SKIPPED_PAUSED" ? null : new Date(), attempts: { increment: 1 }, error: null } });
  } catch (e) {
    res.failed++;
    const msg = e instanceof Error ? e.message : String(e);
    res.errors.push(msg);
    await prisma.reminderLog.update({ where: { id: logId }, data: { status: "FAILED", error: msg.slice(0, 500), attempts: { increment: 1 } } });
  }
}

/** Retry FAILED reminders from the last 3 days, at most 5 attempts each. */
async function retryFailed(res: ReminderRunResult) {
  const rows = await prisma.reminderLog.findMany({
    where: { status: "FAILED", attempts: { lt: 5 }, createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) }, obligationId: { not: null } },
    include: { obligation: { include: OB_INCLUDE } },
  });
  for (const row of rows) {
    if (!row.obligation) continue;
    const tpl = await templateFor(row.templateKey);
    const v = vars(row.obligation as Ob, { email: row.recipientEmail, name: row.recipientEmail }, "reminder (retry)");
    await sendLogged(row.id, { to: [row.recipientEmail], subject: row.subject, text: render(tpl.body, v) }, res);
  }
}

// ───────────── Daily digest and weekly partner summary ─────────────

export async function runDigests(now = new Date()): Promise<{ digests: number; summaries: number; skipped: number }> {
  const today = todayDubai(now);
  const cal = await loadCalendar();
  const out = { digests: 0, summaries: 0, skipped: 0 };
  const hour = Number(await getSetting("digest.hourGst"));
  if (!cal.isWorkingDay(today) || hourDubai(now) < hour) return out;

  const users = await prisma.user.findMany({ where: { isActive: true, role: { key: { notIn: ["READ_ONLY"] } } }, include: { role: true } });
  const weekEnd = addDays(today, 7);
  for (const u of users) {
    if (onLeave(u, today)) continue;
    const mine: Prisma.ObligationWhereInput = { ...OPEN_WHERE, OR: [{ preparerId: u.id }, { reviewerId: u.id }] };
    const [overdue, thisWeek, waiting, leads] = await Promise.all([
      prisma.obligation.findMany({ where: { ...mine, statutoryDueDate: { lt: toDbDate(today) } }, include: { client: true }, orderBy: { statutoryDueDate: "asc" }, take: 50 }),
      prisma.obligation.findMany({ where: { ...mine, statutoryDueDate: { gte: toDbDate(today), lte: toDbDate(weekEnd) } }, include: { client: true }, orderBy: { statutoryDueDate: "asc" }, take: 50 }),
      prisma.obligation.findMany({ where: { ...OPEN_WHERE, reviewerId: u.id, status: "PENDING_INTERNAL_REVIEW" }, include: { client: true }, take: 50 }),
      prisma.lead.findMany({ where: { ownerId: u.id, deletedAt: null, stage: { notIn: ["WON", "LOST"] }, nextActionDate: { lte: toDbDate(today) } }, take: 50 }),
    ]);
    if (!overdue.length && !thisWeek.length && !waiting.length && !leads.length) continue;
    const line = (o: { client: { legalName: string }; title: string; statutoryDueDate: Date }) => `  - ${o.client.legalName}: ${o.title} (statutory ${formatDate(o.statutoryDueDate)})`;
    const text = [
      `Good morning ${u.name},`,
      "",
      `OVERDUE (${overdue.length})`,
      ...overdue.map(line),
      "",
      `DUE THIS WEEK (${thisWeek.length})`,
      ...thisWeek.map(line),
      "",
      `WAITING ON YOUR REVIEW (${waiting.length})`,
      ...waiting.map(line),
      "",
      `LEADS NEEDING ACTION (${leads.length})`,
      ...leads.map((l) => `  - ${l.company ?? l.name}: next action ${formatDate(l.nextActionDate)}`),
      "",
      `${process.env.APP_URL ?? ""}/work`,
    ].join("\n");
    if (await sendOnce(`digest|${u.id}|${today}`, "DAILY_DIGEST", u, `Your work for ${formatDate(today)}`, text, today)) out.digests++;
    else out.skipped++;
  }

  // Weekly partner summary: Monday (or first working day of the week)
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((dow + 6) % 7));
  const firstWorking = cal.onOrBefore(monday) === monday ? monday : (() => { let d = monday; while (!cal.isWorkingDay(d)) d = addDays(d, 1); return d; })();
  if (today === firstWorking) {
    const partners = users.filter((u) => u.role.key === "PARTNER" || u.role.key === "MANAGING_PARTNER");
    const in14 = addDays(today, 14);
    const [due14, overdue, unassigned] = await Promise.all([
      prisma.obligation.count({ where: { ...OPEN_WHERE, statutoryDueDate: { gte: toDbDate(today), lte: toDbDate(in14) } } }),
      prisma.obligation.count({ where: { ...OPEN_WHERE, statutoryDueDate: { lt: toDbDate(today) } } }),
      prisma.obligation.count({ where: { ...OPEN_WHERE, preparerId: null, statutoryDueDate: { lte: toDbDate(addDays(today, 60)) } } }),
    ]);
    for (const p of partners) {
      const scope: Prisma.ObligationWhereInput = p.role.key === "MANAGING_PARTNER" ? {} : { OR: [{ engagement: { partnerId: p.id } }, { client: { relationshipPartnerId: p.id } }] };
      const list = await prisma.obligation.findMany({
        where: { ...OPEN_WHERE, ...scope, statutoryDueDate: { lte: toDbDate(in14) } },
        include: { client: true, preparer: true },
        orderBy: { statutoryDueDate: "asc" },
        take: 100,
      });
      const text = [
        `Weekly summary for ${p.name} — week of ${formatDate(today)}`,
        "",
        `Firm-wide: ${overdue} overdue · ${due14} due in the next 14 days · ${unassigned} with no preparer (next 60 days)`,
        "",
        "Your portfolio — overdue or due in 14 days:",
        ...list.map((o) => `  - ${fromDbDate(o.statutoryDueDate) < today ? "OVERDUE " : ""}${o.client.legalName}: ${o.title} — ${formatDate(o.statutoryDueDate)} — ${o.preparer?.name ?? "UNASSIGNED"} — ${STATUS_LABEL[o.status]}`),
        "",
        `${process.env.APP_URL ?? ""}/obligations?view=firm`,
      ].join("\n");
      if (await sendOnce(`partner-summary|${p.id}|${today}`, "WEEKLY_PARTNER_SUMMARY", p, `Partner summary — week of ${formatDate(today)}`, text, today)) out.summaries++;
    }
  }
  return out;
}

async function sendOnce(key: string, track: ReminderTrack, u: User, subject: string, text: string, today: YMD): Promise<boolean> {
  const id = await claimDedupe({ track, recipientEmail: u.email, recipientUserId: u.id, templateKey: track.toLowerCase(), subject, scheduledFor: today, dedupeKey: key });
  if (!id) return false;
  const r: ReminderRunResult = { considered: 0, sent: 0, skippedDuplicate: 0, paused: 0, failed: 0, errors: [] };
  await sendLogged(id, { to: [u.email], subject, text }, r);
  if (r.failed) throw new Error(r.errors[0]);
  return true;
}

// ───────────── Lead follow-up reminders (Phase 2 feature, uses same engine) ─────────────

export async function runLeadReminders(now = new Date()) {
  const today = todayDubai(now);
  const cal = await loadCalendar();
  if (!cal.isWorkingDay(today)) return { sent: 0 };
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, stage: { notIn: ["WON", "LOST"] }, nextActionDate: { lte: toDbDate(today) } },
    include: { owner: true },
  });
  let sent = 0;
  for (const l of leads) {
    const subject = `Lead needs action: ${l.company ?? l.name}`;
    const text = `${l.owner.name},\n\nThe next action on this lead was due ${formatDate(l.nextActionDate)}${l.nextAction ? ` (${l.nextAction})` : ""}.\nStage: ${l.stage}\n\nUpdate it here: ${process.env.APP_URL ?? ""}/leads/${l.id}`;
    try {
      if (await sendOnce(`lead|${l.id}|${l.owner.email}|${today}`, "LEAD_FOLLOW_UP", l.owner, subject, text, today)) sent++;
    } catch {
      /* logged as FAILED in reminder_log */
    }
  }
  return { sent };
}
