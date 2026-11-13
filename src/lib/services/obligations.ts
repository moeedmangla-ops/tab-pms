import { ObligationStatus, ObligationType, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { Actor, ForbiddenError, obligationWhere, requirePermission } from "../permissions";
import { FILED, CLOSED, TransitionInput, validateTransition } from "../engine/workflow";
import { addDays, toDbDate, todayDubai } from "../dates";

export class ValidationError extends Error {
  readonly name = "ValidationError";
}
export const isValidation = (e: unknown): e is ValidationError => !!e && typeof e === "object" && (e as Error).name === "ValidationError";

export type ObligationFilters = {
  view?: "mine" | "team" | "firm";
  type?: ObligationType;
  status?: ObligationStatus | "OVERDUE" | "OPEN";
  preparerId?: string;
  reviewerId?: string;
  managerId?: string;
  clientId?: string;
  dueFrom?: string;
  dueTo?: string;
  periodEndFrom?: string;
  periodEndTo?: string;
  needsReview?: boolean;
  unassigned?: boolean;
  q?: string;
};

export function obligationFilterWhere(actor: Actor, f: ObligationFilters): Prisma.ObligationWhereInput {
  const today = todayDubai();
  const and: Prisma.ObligationWhereInput[] = [obligationWhere(actor), { deletedAt: null, client: { deletedAt: null } }];
  if (f.view === "mine") and.push({ OR: [{ preparerId: actor.id }, { reviewerId: actor.id }] });
  if (f.view === "team") {
    const ids = [actor.id, ...actor.teamIds];
    and.push({ OR: [{ preparerId: { in: ids } }, { reviewerId: { in: ids } }, { engagement: { managerId: { in: ids } } }] });
  }
  if (f.type) and.push({ type: f.type });
  if (f.status === "OVERDUE") and.push({ status: { notIn: [...FILED, "ON_HOLD"] }, statutoryDueDate: { lt: toDbDate(today) } });
  else if (f.status === "OPEN") and.push({ status: { notIn: [...FILED, ...CLOSED] } });
  else if (f.status) and.push({ status: f.status });
  if (f.preparerId) and.push({ preparerId: f.preparerId });
  if (f.reviewerId) and.push({ reviewerId: f.reviewerId });
  if (f.managerId) and.push({ engagement: { managerId: f.managerId } });
  if (f.clientId) and.push({ clientId: f.clientId });
  if (f.dueFrom) and.push({ statutoryDueDate: { gte: toDbDate(f.dueFrom) } });
  if (f.dueTo) and.push({ statutoryDueDate: { lte: toDbDate(f.dueTo) } });
  if (f.periodEndFrom) and.push({ periodEnd: { gte: toDbDate(f.periodEndFrom) } });
  if (f.periodEndTo) and.push({ periodEnd: { lte: toDbDate(f.periodEndTo) } });
  if (f.needsReview) and.push({ needsReview: true });
  if (f.unassigned) and.push({ preparerId: null });
  if (f.q) and.push({ OR: [{ title: { contains: f.q, mode: "insensitive" } }, { client: { legalName: { contains: f.q, mode: "insensitive" } } }, { client: { clientCode: { contains: f.q, mode: "insensitive" } } }] });
  return { AND: and };
}

/**
 * Default sort: overdue first, then due soonest. Overdue rows have the earliest
 * statutory dates among open items, so open-first + statutory ascending gives it;
 * closed items sink to the bottom.
 */
export async function listObligations(actor: Actor, f: ObligationFilters, page = 1, pageSize = 50) {
  const where = obligationFilterWhere(actor, f);
  const [total, rows] = await Promise.all([
    prisma.obligation.count({ where }),
    prisma.obligation.findMany({
      where,
      include: { client: { select: { id: true, legalName: true, clientCode: true, stopWork: true } }, preparer: { select: { id: true, name: true } }, reviewer: { select: { id: true, name: true } } },
      orderBy: [{ statutoryDueDate: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, rows, page, pageSize };
}

async function loadForEdit(actor: Actor, id: string) {
  requirePermission(actor, "obligations", "edit");
  const o = await prisma.obligation.findFirst({ where: { AND: [{ id }, obligationWhere(actor), { deletedAt: null }] } });
  if (!o) throw new ForbiddenError("Obligation not found or not accessible.");
  return o;
}

export async function changeStatus(actor: Actor, id: string, t: TransitionInput, ip?: string | null) {
  const o = await loadForEdit(actor, id);
  const setting = await prisma.obligationTypeSetting.findUnique({ where: { type: o.type } });
  const err = validateTransition(o, t, setting?.enabledStatuses?.length ? setting.enabledStatuses : null);
  if (err) throw new ValidationError(err);

  const data: Prisma.ObligationUpdateInput = { status: t.to, lastChangedById: actor.id };
  if (t.to === "ON_HOLD") data.onHoldReason = t.onHoldReason;
  else if (o.status === "ON_HOLD") data.onHoldReason = null;
  if (t.submissionReference?.trim()) {
    data.submissionReference = t.submissionReference.trim();
    if (!o.submissionDate) data.submissionDate = new Date();
  }
  if (t.to === "SUBMITTED" && !o.submissionDate) data.submissionDate = new Date();
  if (t.to === "COMPLETED") {
    if (t.paymentConfirmed) data.paymentStatus = "PAID";
    else if (o.paymentStatus === "UNPAID" && t.waiverReason) {
      data.paymentStatus = "WAIVED";
      data.waiverReason = t.waiverReason;
    }
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.obligation.update({ where: { id }, data });
    await tx.obligationStatusHistory.create({ data: { obligationId: id, fromStatus: o.status, toStatus: t.to, changedById: actor.id, note: t.note || t.onHoldReason || t.waiverReason || null } });
    await audit(tx, { userId: actor.id, ip, action: "UPDATE", table: "obligation", recordId: id, before: o, after: updated });
    return updated;
  });
}

export async function assignObligations(actor: Actor, ids: string[], a: { preparerId?: string | null; reviewerId?: string | null }, ip?: string | null) {
  let n = 0;
  for (const id of ids) {
    const o = await loadForEdit(actor, id);
    const data: Prisma.ObligationUncheckedUpdateInput = { lastChangedById: actor.id };
    if (a.preparerId !== undefined) data.preparerId = a.preparerId || null;
    if (a.reviewerId !== undefined) data.reviewerId = a.reviewerId || null;
    await prisma.$transaction(async (tx) => {
      const u = await tx.obligation.update({ where: { id }, data });
      await audit(tx, { userId: actor.id, ip, action: "UPDATE", table: "obligation", recordId: id, before: o, after: u });
    });
    n++;
  }
  return n;
}

export async function bulkStatus(actor: Actor, ids: string[], t: TransitionInput, ip?: string | null) {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      await changeStatus(actor, id, t, ip);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/** Manual override of the derived statutory date: recorded as an override and needs reviewer confirmation. */
export async function overrideDueDate(actor: Actor, id: string, statutory: string, reason: string, ip?: string | null) {
  const o = await loadForEdit(actor, id);
  if (FILED.includes(o.status)) throw new ValidationError("Filed obligations cannot be changed.");
  if (!reason.trim()) throw new ValidationError("A reason is required for a manual override.");
  const { loadCalendar } = await import("../engine/calendar");
  const cal = await loadCalendar();
  const target = cal.onOrBefore(statutory);
  return prisma.$transaction(async (tx) => {
    const u = await tx.obligation.update({
      where: { id },
      data: {
        statutoryDueDate: toDbDate(statutory),
        internalTargetDate: toDbDate(target),
        prepDeadline: toDbDate(cal.subtractWorkingDays(target, 10)),
        reviewDeadline: toDbDate(cal.subtractWorkingDays(target, 5)),
        isManualOverride: true,
        reviewerConfirmed: false,
        needsReview: false,
        needsReviewReason: null,
        lastChangedById: actor.id,
      },
    });
    await audit(tx, { userId: actor.id, ip, action: "UPDATE", table: "obligation", recordId: id, before: o, after: { ...u, overrideReason: reason } });
    return u;
  });
}

export async function confirmDates(actor: Actor, id: string, ip?: string | null) {
  const o = await loadForEdit(actor, id);
  const u = await prisma.obligation.update({ where: { id }, data: { reviewerConfirmed: true, needsReview: false, needsReviewReason: null, lastChangedById: actor.id } });
  await audit(prisma, { userId: actor.id, ip, action: "UPDATE", table: "obligation", recordId: id, before: o, after: u });
  return u;
}

/** Counts for the dashboard — every figure a live query, each mapped to a list URL. */
export async function obligationExceptionCounts(actor: Actor) {
  const today = todayDubai();
  const base = (f: ObligationFilters) => prisma.obligation.count({ where: obligationFilterWhere(actor, f) });
  const weekEnd = addDays(today, 7);
  const [overdue, dueWeek, dueWeekNoPreparer, unassigned, needsReview, mine] = await Promise.all([
    base({ view: "firm", status: "OVERDUE" }),
    base({ view: "firm", status: "OPEN", dueFrom: today, dueTo: weekEnd }),
    base({ view: "firm", status: "OPEN", dueFrom: today, dueTo: weekEnd, unassigned: true }),
    base({ view: "firm", status: "OPEN", unassigned: true }),
    base({ view: "firm", status: "OPEN", needsReview: true }),
    base({ view: "mine", status: "OPEN", dueTo: addDays(today, 14) }),
  ]);
  return { overdue, dueWeek, dueWeekNoPreparer, unassigned, needsReview, mine, today, weekEnd };
}

/**
 * Resolve an obligation flagged for review after a year-end or frequency change.
 * keep: the dates stand (confirmed by the reviewer).
 * replace: archive this obligation (soft delete) and regenerate from the new data.
 */
export async function resolveReview(actor: Actor, id: string, action: "keep" | "replace", ip?: string | null) {
  const o = await loadForEdit(actor, id);
  if (!o.needsReview) throw new ValidationError("This obligation is not flagged for review.");
  if (action === "keep") return confirmDates(actor, id, ip);
  if (FILED.includes(o.status)) throw new ValidationError("Filed obligations cannot be replaced.");
  await prisma.$transaction(async (tx) => {
    const u = await tx.obligation.update({ where: { id }, data: { deletedAt: new Date(), lastChangedById: actor.id } });
    await audit(tx, { userId: actor.id, ip, action: "DELETE", table: "obligation", recordId: id, after: { softDeleted: true, reason: o.needsReviewReason } });
    return u;
  });
  const { generateObligations } = await import("../engine/generate");
  return generateObligations({ clientIds: [o.clientId] });
}
