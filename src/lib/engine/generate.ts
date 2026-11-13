/**
 * Obligation roll-forward (BUILD_SPEC Section 4).
 *
 * - Generates obligations whose period ends from 6 months ago to 18 months ahead.
 * - Idempotent: inserts with ON CONFLICT DO NOTHING against the partial unique
 *   index (client, type, period). Existing rows are never altered.
 * - Missing inputs (no year-end, no VAT anchor) generate nothing and are
 *   reported as exceptions instead of guessed.
 */
import { DeadlineRule, ObligationType, Prisma, ServiceLine } from "@prisma/client";
import { prisma } from "../db";
import { YMD, addMonths, fromDbDate, toDbDate, todayDubai, WorkingCalendar } from "../dates";
import { deriveDates, financialYears, vatPeriods, Period, RuleParams } from "./periods";
import { loadCalendar } from "./calendar";

export const HORIZON_MONTHS = 18;
export const LOOKBACK_MONTHS = 6;

export type MissingData = { clientId: string; clientCode: string; legalName: string; issue: string };

type RuleSet = Map<ObligationType, DeadlineRule[]>;

async function loadRules(jurisdiction = "AE"): Promise<RuleSet> {
  const rules = await prisma.deadlineRule.findMany({
    where: { jurisdiction },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
  });
  const m: RuleSet = new Map();
  for (const r of rules) m.set(r.obligationType, [...(m.get(r.obligationType) ?? []), r]);
  return m;
}

/** The rule version in force on a given period end date. */
export function ruleFor(rules: RuleSet, type: ObligationType, periodEnd: YMD): DeadlineRule | undefined {
  return (rules.get(type) ?? []).find(
    (r) => fromDbDate(r.effectiveFrom) <= periodEnd && (!r.effectiveTo || fromDbDate(r.effectiveTo) >= periodEnd),
  );
}

function params(r: DeadlineRule): RuleParams {
  return {
    basis: r.basis,
    offsetDays: r.offsetDays,
    offsetMonths: r.offsetMonths,
    prepLeadWorkingDays: r.prepLeadWorkingDays,
    reviewLeadWorkingDays: r.reviewLeadWorkingDays,
  };
}

const TYPE_LABEL: Record<ObligationType, string> = {
  VAT_RETURN: "VAT return",
  CT_RETURN: "Corporate Tax return",
  TRADE_LICENCE_RENEWAL: "Trade licence renewal",
  ENGAGEMENT_RENEWAL: "Engagement letter renewal",
  AUDIT_REPORT: "Audit report",
  TP_LOCAL_FILE: "Transfer pricing Local File",
  TAX_PAYMENT: "Tax payment",
  DOCUMENT_EXPIRY: "Document renewal",
  OTHER: "Obligation",
};

const SERVICE_FOR: Partial<Record<ObligationType, ServiceLine>> = {
  VAT_RETURN: "VAT",
  CT_RETURN: "CORPORATE_TAX",
  AUDIT_REPORT: "AUDIT",
  TP_LOCAL_FILE: "TRANSFER_PRICING",
  TRADE_LICENCE_RENEWAL: "BUSINESS_SETUP",
};

type ClientForGen = Prisma.ClientGetPayload<{ include: { taxProfile: true; engagements: true } }>;

export function buildObligationsForClient(
  c: ClientForGen,
  rules: RuleSet,
  cal: WorkingCalendar,
  today: YMD,
): { rows: Prisma.ObligationCreateManyInput[]; missing: MissingData[] } {
  const rows: Prisma.ObligationCreateManyInput[] = [];
  const missing: MissingData[] = [];
  // Window is on the statutory DUE date: due from 6 months ago to 18 months ahead.
  // Periods are scanned from 24 months back so long-lead obligations (CT: 9 months) are not missed.
  const dueFrom = addMonths(today, -LOOKBACK_MONTHS);
  const dueTo = addMonths(today, HORIZON_MONTHS);
  const from = addMonths(today, -24);
  const to = dueTo;
  const flag = (issue: string) => missing.push({ clientId: c.id, clientCode: c.clientCode, legalName: c.legalName, issue });
  const tp = c.taxProfile;
  const active = c.engagements.filter((e) => e.isActive);

  const push = (type: ObligationType, p: Period, sourceDate?: YMD) => {
    const rule = ruleFor(rules, type, p.end);
    if (!rule) {
      flag(`No deadline rule in force for ${TYPE_LABEL[type]} on ${p.end}`);
      return;
    }
    const dates = deriveDates(sourceDate ?? p.end, params(rule), cal);
    if (dates.statutoryDueDate < dueFrom || dates.statutoryDueDate > dueTo) return;
    const sl = SERVICE_FOR[type];
    const eng = sl ? active.find((e) => e.serviceLine === sl) : undefined;
    rows.push({
      clientId: c.id,
      engagementId: eng?.id,
      type,
      title: `${TYPE_LABEL[type]} — ${p.start} to ${p.end}`,
      periodStart: toDbDate(p.start),
      periodEnd: toDbDate(p.end),
      statutoryDueDate: toDbDate(dates.statutoryDueDate),
      internalTargetDate: toDbDate(dates.internalTargetDate),
      prepDeadline: toDbDate(dates.prepDeadline),
      reviewDeadline: toDbDate(dates.reviewDeadline),
      preparerId: eng?.preparerId ?? undefined,
      reviewerId: eng?.managerId ?? undefined,
      ruleId: rule.id,
      ruleVersion: rule.version,
      paymentStatus: type === "VAT_RETURN" || type === "CT_RETURN" ? "UNPAID" : "NOT_APPLICABLE",
    });
  };

  // VAT
  if (tp && tp.vatFrequency !== "NOT_REGISTERED") {
    if (!tp.vatPeriodAnchor) flag("VAT registered but no tax-period anchor date");
    else {
      const notBefore = tp.vatEffectiveDate ? fromDbDate(tp.vatEffectiveDate) : undefined;
      for (const p of vatPeriods(fromDbDate(tp.vatPeriodAnchor), tp.vatFrequency, from, to, notBefore)) push("VAT_RETURN", p);
    }
  }

  // Corporate Tax
  if (tp?.ctRegistered) {
    if (!c.fyEndMonth || !c.fyEndDay) flag("CT registered but no financial year-end recorded");
    else {
      const notBefore = tp.ctFirstPeriodStart ? fromDbDate(tp.ctFirstPeriodStart) : undefined;
      for (const p of financialYears(c.fyEndMonth, c.fyEndDay, from, to, notBefore)) push("CT_RETURN", p);
    }
  }

  // Trade licence renewal: due on expiry date
  if (c.licenceExpiry) {
    const exp = fromDbDate(c.licenceExpiry);
    if (exp >= dueFrom && exp <= dueTo) push("TRADE_LICENCE_RENEWAL", { start: exp, end: exp }, exp);
  } else if (c.licenceNumber) {
    flag("Trade licence recorded without an expiry date");
  }

  // Engagement letter renewal: due on contract end
  for (const e of active) {
    if (!e.contractEnd) continue;
    const end = fromDbDate(e.contractEnd);
    if (end >= dueFrom && end <= dueTo) {
      const before = rows.length;
      push("ENGAGEMENT_RENEWAL", { start: fromDbDate(e.contractStart), end }, end);
      if (rows.length > before) {
        rows[rows.length - 1].engagementId = e.id;
        rows[rows.length - 1].title = `Engagement renewal — ${e.serviceLine.replace("_", " ")} — ends ${end}`;
        rows[rows.length - 1].preparerId = e.managerId ?? undefined;
        rows[rows.length - 1].reviewerId = e.partnerId ?? undefined;
      }
    }
  }

  return { rows, missing };
}

export async function generateObligations(opts: { clientIds?: string[]; today?: YMD } = {}) {
  const today = opts.today ?? todayDubai();
  const rules = await loadRules();
  const cal = await loadCalendar();
  let created = 0;
  let processed = 0;
  const missing: MissingData[] = [];
  const BATCH = 500;
  let cursor: string | undefined;

  for (;;) {
    const clients = await prisma.client.findMany({
      where: { status: "ACTIVE", deletedAt: null, ...(opts.clientIds ? { id: { in: opts.clientIds } } : {}) },
      include: { taxProfile: true, engagements: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (clients.length === 0) break;
    const rows: Prisma.ObligationCreateManyInput[] = [];
    for (const c of clients) {
      const r = buildObligationsForClient(c, rules, cal, today);
      rows.push(...r.rows);
      missing.push(...r.missing);
    }
    if (rows.length) {
      const res = await prisma.obligation.createMany({ data: rows, skipDuplicates: true });
      created += res.count;
    }
    processed += clients.length;
    cursor = clients[clients.length - 1].id;
    if (clients.length < BATCH) break;
  }
  return { processed, created, missing };
}

/** Missing-data exception report (live query, used by the dashboard). */
export async function missingDataReport(): Promise<MissingData[]> {
  const today = todayDubai();
  const rules = await loadRules();
  const cal = await loadCalendar();
  const clients = await prisma.client.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      OR: [
        { taxProfile: { ctRegistered: true }, fyEndMonth: null },
        { taxProfile: { vatFrequency: { not: "NOT_REGISTERED" }, vatPeriodAnchor: null } },
        { licenceNumber: { not: null }, licenceExpiry: null },
      ],
    },
    include: { taxProfile: true, engagements: true },
    take: 500,
  });
  return clients.flatMap((c) => buildObligationsForClient(c, rules, cal, today).missing);
}
