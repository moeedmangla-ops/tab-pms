"use server";
import { redirect } from "next/navigation";
import { ObligationStatus } from "@prisma/client";
import { requireUser, clientIp } from "@/lib/auth";
import { act, str } from "@/lib/web";
import { assignObligations, bulkStatus, changeStatus, overrideDueDate, confirmDates, resolveReview, ValidationError } from "@/lib/services/obligations";
import { sendDocumentRequests } from "@/lib/services/document-requests";

const NEEDS_INPUT: ObligationStatus[] = ["SUBMITTED", "PAYMENT_PENDING", "ON_HOLD", "COMPLETED"];

export async function inlineStatus(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  const to = str(fd, "to") as ObligationStatus;
  const back = str(fd, "back") || "/obligations";
  if (NEEDS_INPUT.includes(to)) redirect(`/obligations/${id}?transition=${to}`);
  await act(back, () => changeStatus(u, id, { to }, null), "Status updated");
}

export async function transition(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/obligations/${id}`, async () =>
    changeStatus(u, id, {
      to: str(fd, "to") as ObligationStatus,
      note: str(fd, "note") || undefined,
      submissionReference: str(fd, "submissionReference") || undefined,
      onHoldReason: str(fd, "onHoldReason") || undefined,
      paymentConfirmed: fd.get("paymentConfirmed") === "on",
      waiverReason: str(fd, "waiverReason") || undefined,
    }, await clientIp()), "Status updated");
}

export async function assignOne(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/obligations/${id}`, async () => assignObligations(u, [id], { preparerId: str(fd, "preparerId"), reviewerId: str(fd, "reviewerId") }, await clientIp()), "Assignment saved");
}

export async function overrideDate(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/obligations/${id}`, async () => overrideDueDate(u, id, str(fd, "statutory"), str(fd, "reason"), await clientIp()), "Statutory date overridden — reviewer confirmation required");
}

export async function confirm(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/obligations/${id}`, async () => confirmDates(u, id, await clientIp()), "Dates confirmed");
}

export async function resolve(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  const how = str(fd, "how") as "keep" | "replace";
  await act(`/obligations/${id}`, async () => resolveReview(u, id, how, await clientIp()), how === "keep" ? "Dates kept and confirmed" : "Replaced with regenerated obligations", how === "replace" ? "/obligations?view=firm&status=OPEN" : undefined);
}

export async function bulk(fd: FormData) {
  const u = await requireUser();
  const ids = fd.getAll("ids").map(String);
  const back = str(fd, "back") || "/obligations";
  const op = str(fd, "op");
  await act(back, async () => {
    if (!ids.length) throw new ValidationError("Select at least one obligation.");
    const ip = await clientIp();
    if (op === "assignPreparer") return assignObligations(u, ids, { preparerId: str(fd, "userId") }, ip);
    if (op === "assignReviewer") return assignObligations(u, ids, { reviewerId: str(fd, "userId") }, ip);
    if (op === "status") {
      const r = await bulkStatus(u, ids, { to: str(fd, "to") as ObligationStatus, note: "Bulk update" }, ip);
      const failed = r.filter((x) => !x.ok);
      if (failed.length) throw new ValidationError(`${r.length - failed.length} updated; ${failed.length} not updated: ${failed[0].error}`);
      return;
    }
    if (op === "docRequest") {
      const r = await sendDocumentRequests(u, ids);
      if (r.skipped.length) throw new ValidationError(`${r.sent} request(s) sent; ${r.skipped.length} skipped: ${r.skipped[0]}`);
      return;
    }
    throw new ValidationError("Choose a bulk action.");
  }, `Bulk action applied to ${ids.length} obligation(s)`);
}
