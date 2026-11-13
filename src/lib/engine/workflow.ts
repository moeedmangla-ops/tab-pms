/**
 * One status workflow for every obligation type (BUILD_SPEC Section 6).
 * Overdue is derived from dates and never stored.
 */
import { Obligation, ObligationStatus } from "@prisma/client";
import { YMD, fromDbDate } from "../dates";

export const STATUS_ORDER: ObligationStatus[] = [
  "UPCOMING",
  "DOCUMENTS_REQUESTED",
  "DOCUMENTS_RECEIVED",
  "IN_PREPARATION",
  "PENDING_INTERNAL_REVIEW",
  "PENDING_CLIENT_APPROVAL",
  "READY_FOR_SUBMISSION",
  "SUBMITTED",
  "PAYMENT_PENDING",
  "COMPLETED",
];

export const STATUS_LABEL: Record<ObligationStatus, string> = {
  UPCOMING: "Upcoming",
  DOCUMENTS_REQUESTED: "Documents Requested",
  DOCUMENTS_RECEIVED: "Documents Received",
  IN_PREPARATION: "In Preparation",
  PENDING_INTERNAL_REVIEW: "Pending Internal Review",
  PENDING_CLIENT_APPROVAL: "Pending Client Approval",
  READY_FOR_SUBMISSION: "Ready for Submission",
  SUBMITTED: "Submitted",
  PAYMENT_PENDING: "Payment Pending",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
};

/** Statuses at or after Submitted are "filed": the generator never touches them. */
export const FILED: ObligationStatus[] = ["SUBMITTED", "PAYMENT_PENDING", "COMPLETED"];
export const CLOSED: ObligationStatus[] = ["COMPLETED", "ON_HOLD"];

export function isOverdue(o: Pick<Obligation, "status" | "statutoryDueDate">, today: YMD): boolean {
  return !FILED.includes(o.status) && o.status !== "ON_HOLD" && fromDbDate(o.statutoryDueDate) < today;
}

export type Tone = "red" | "amber" | "blue" | "green" | "grey" | "none";

/** Colour coding: red overdue, amber due within 7 days, blue in progress, green completed, grey on hold. */
export function tone(o: Pick<Obligation, "status" | "statutoryDueDate">, today: YMD): Tone {
  if (o.status === "COMPLETED") return "green";
  if (o.status === "ON_HOLD") return "grey";
  if (isOverdue(o, today)) return "red";
  const due = fromDbDate(o.statutoryDueDate);
  const days = (Date.parse(due) - Date.parse(today)) / 86_400_000;
  if (!FILED.includes(o.status) && days <= 7) return "amber";
  if (o.status !== "UPCOMING") return "blue";
  return "none";
}

export type TransitionInput = {
  to: ObligationStatus;
  note?: string;
  submissionReference?: string;
  onHoldReason?: string;
  paymentConfirmed?: boolean;
  waiverReason?: string;
};

/** Validates a transition. Returns an error message or null. The database enforces the same rules. */
export function validateTransition(
  o: Pick<Obligation, "status" | "submissionReference" | "paymentStatus">,
  t: TransitionInput,
  enabled: ObligationStatus[] | null,
): string | null {
  if (t.to === o.status) return "Obligation is already in that status.";
  if (enabled && t.to !== "ON_HOLD" && !enabled.includes(t.to)) return `${STATUS_LABEL[t.to]} is not enabled for this obligation type.`;
  if (t.to === "ON_HOLD" && !t.onHoldReason?.trim()) return "On Hold requires a reason.";
  if (t.to === "SUBMITTED" && !(t.submissionReference?.trim() || o.submissionReference)) return "Submitted requires a submission reference.";
  if (t.to === "PAYMENT_PENDING" && !(t.submissionReference?.trim() || o.submissionReference)) return "Record the submission reference before Payment Pending.";
  if (t.to === "COMPLETED") {
    const paid = t.paymentConfirmed || o.paymentStatus === "PAID" || o.paymentStatus === "NOT_APPLICABLE";
    if (!paid && !t.waiverReason?.trim()) return "Completed requires payment confirmation or a waiver with a reason.";
  }
  return null;
}
