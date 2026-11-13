import Link from "next/link";
import { notFound } from "next/navigation";
import { ObligationStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { access, obligationWhere } from "@/lib/permissions";
import { STATUS_LABEL, STATUS_ORDER, tone, isOverdue } from "@/lib/engine/workflow";
import { formatDate, formatDateTime, fromDbDate, todayDubai } from "@/lib/dates";
import { Flash, PageHead, StatusChip, TYPE_LABEL, aed } from "@/components/ui";
import { SP, one } from "@/lib/web";
import { assignOne, confirm, overrideDate, resolve, transition } from "../actions";

export default async function ObligationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const o = await prisma.obligation.findFirst({
    where: { AND: [{ id, deletedAt: null }, obligationWhere(u)] },
    include: {
      client: { select: { id: true, legalName: true, clientCode: true, stopWork: true, stopWorkReason: true } },
      preparer: true,
      reviewer: true,
      rule: true,
      engagement: { include: { manager: true, partner: true } },
      history: { include: { changedBy: { select: { name: true } } }, orderBy: { changedAt: "asc" } },
      reminderLogs: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!o) notFound();
  const today = todayDubai();
  const t = tone(o, today);
  const canEdit = access(u, "obligations").edit;
  const setting = await prisma.obligationTypeSetting.findUnique({ where: { type: o.type } });
  const enabled = setting?.enabledStatuses.length ? setting.enabledStatuses : STATUS_ORDER;
  const nextOptions = [...STATUS_ORDER.filter((s) => enabled.includes(s)), "ON_HOLD" as ObligationStatus].filter((s) => s !== o.status);
  const want = (one(sp.transition) as ObligationStatus | undefined) ?? nextOptions.find((s) => STATUS_ORDER.indexOf(s) > STATUS_ORDER.indexOf(o.status)) ?? nextOptions[0];
  const users = canEdit ? await prisma.user.findMany({ where: { isActive: true, role: { key: { notIn: ["BUSINESS_DEVELOPMENT", "READ_ONLY"] } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const moved = fromDbDate(o.internalTargetDate) !== fromDbDate(o.statutoryDueDate);

  return (
    <>
      <PageHead
        title={`${TYPE_LABEL[o.type]} — ${o.client.legalName}`}
        sub={<><Link href={`/clients/${o.client.id}`} className="text-brand-accent hover:underline">{o.client.clientCode}</Link> · Period {formatDate(o.periodStart)} – {formatDate(o.periodEnd)}</>}
      >
        <StatusChip status={o.status} tone={t} overdue={isOverdue(o, today)} />
      </PageHead>
      <Flash sp={sp} />
      {o.client.stopWork && <div className="err mb-3"><strong>STOP WORK</strong> on this client{o.client.stopWorkReason ? `: ${o.client.stopWorkReason}` : ""}. Speak to the relationship partner before continuing.</div>}
      {o.needsReview && (
        <div className="mb-3 rounded border border-[#f3d29b] bg-[var(--amber-bg)] p-3 text-[var(--amber)]">
          <strong>Dates need review.</strong> {o.needsReviewReason}. These dates were generated from the client&apos;s previous data and have not been changed.
          {canEdit && (
            <form action={resolve} className="mt-2 flex gap-2">
              <input type="hidden" name="id" value={o.id} />
              <button name="how" value="keep" className="btn">Keep these dates</button>
              <button name="how" value="replace" className="btn btn-danger">Replace with regenerated obligations</button>
            </form>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-4 lg:col-span-1">
          <h2 className="h2 mb-3">Dates</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
            <dt className="text-muted">Statutory due date</dt><dd className="text-right font-semibold tabular-nums">{formatDate(o.statutoryDueDate)}</dd>
            <dt className="text-muted">Internal target</dt><dd className="text-right tabular-nums">{formatDate(o.internalTargetDate)}</dd>
            <dt className="text-muted">Review deadline</dt><dd className="text-right tabular-nums">{formatDate(o.reviewDeadline)}</dd>
            <dt className="text-muted">Preparation deadline</dt><dd className="text-right tabular-nums">{formatDate(o.prepDeadline)}</dd>
          </dl>
          {moved && <p className="mt-2 text-[12px] text-muted">The statutory date falls on a weekend or UAE public holiday. It is kept as recorded; the firm works to the internal target on the previous working day.</p>}
          <p className="mt-3 border-t border-line pt-2 text-[11.5px] text-muted">
            {o.isManualOverride ? "Manually overridden. " : o.rule ? <>Derived from rule <strong>{o.rule.name}</strong> (version {o.ruleVersion}){o.rule.isConfirmed ? "" : " — rule not yet confirmed by a qualified person"}. </> : null}
            {o.reviewerConfirmed ? "Confirmed by a reviewer." : "Not yet confirmed by a reviewer."} The firm, not the software, is responsible for the filing date.
          </p>
          {canEdit && (
            <>
              {!o.reviewerConfirmed && (
                <form action={confirm} className="mt-2"><input type="hidden" name="id" value={o.id} /><button className="btn">Confirm dates</button></form>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-brand-accent">Override statutory date</summary>
                <form action={overrideDate} className="mt-2 space-y-2">
                  <input type="hidden" name="id" value={o.id} />
                  <input className="inp w-full" type="date" name="statutory" required defaultValue={fromDbDate(o.statutoryDueDate)} aria-label="New statutory date" />
                  <input className="inp w-full" name="reason" required placeholder="Reason (e.g. FTA extension granted)" aria-label="Reason" />
                  <button className="btn">Save override</button>
                </form>
              </details>
            </>
          )}
        </section>

        <section className="card p-4">
          <h2 className="h2 mb-3">People and filing</h2>
          {canEdit ? (
            <form action={assignOne} className="space-y-2">
              <input type="hidden" name="id" value={o.id} />
              <label className="block"><span className="lbl">Preparer</span><select className="sel w-full" name="preparerId" defaultValue={o.preparerId ?? ""}><option value="">Unassigned</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <label className="block"><span className="lbl">Reviewer</span><select className="sel w-full" name="reviewerId" defaultValue={o.reviewerId ?? ""}><option value="">Unassigned</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <button className="btn">Save assignment</button>
            </form>
          ) : (
            <p>Preparer: {o.preparer?.name ?? "Unassigned"}<br />Reviewer: {o.reviewer?.name ?? "—"}</p>
          )}
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t border-line pt-3">
            <dt className="text-muted">Manager</dt><dd className="text-right">{o.engagement?.manager?.name ?? "—"}</dd>
            <dt className="text-muted">Partner</dt><dd className="text-right">{o.engagement?.partner?.name ?? "—"}</dd>
            <dt className="text-muted">Submission ref.</dt><dd className="text-right">{o.submissionReference ?? "—"}</dd>
            <dt className="text-muted">Submitted</dt><dd className="text-right">{formatDateTime(o.submissionDate)}</dd>
            <dt className="text-muted">Amount payable</dt><dd className="text-right">{o.amountPayable ? aed(o.amountPayable) : "—"}</dd>
            <dt className="text-muted">Payment</dt><dd className="text-right">{o.paymentStatus.replace("_", " ").toLowerCase()}{o.waiverReason ? ` (${o.waiverReason})` : ""}</dd>
          </dl>
        </section>

        {canEdit && (
          <section className="card p-4">
            <h2 className="h2 mb-3">Change status</h2>
            <form action={transition} className="space-y-2">
              <input type="hidden" name="id" value={o.id} />
              <label className="block"><span className="lbl">New status</span>
                <select className="sel w-full" name="to" defaultValue={want}>{nextOptions.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
              </label>
              <label className="block"><span className="lbl">Submission reference (required for Submitted)</span><input className="inp w-full" name="submissionReference" defaultValue={o.submissionReference ?? ""} /></label>
              <label className="block"><span className="lbl">On Hold reason (required for On Hold)</span><input className="inp w-full" name="onHoldReason" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" name="paymentConfirmed" /> Payment confirmed (for Completed)</label>
              <label className="block"><span className="lbl">…or waiver reason (for Completed without payment)</span><input className="inp w-full" name="waiverReason" /></label>
              <label className="block"><span className="lbl">Note</span><input className="inp w-full" name="note" /></label>
              <button className="btn btn-primary">Update status</button>
            </form>
          </section>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="h2 border-b border-line px-3 py-2">Status history</h2>
          <table className="tbl">
            <thead><tr><th>When</th><th>From</th><th>To</th><th>By</th><th>Note</th></tr></thead>
            <tbody>
              {o.history.map((h) => (
                <tr key={h.id}><td className="whitespace-nowrap">{formatDateTime(h.changedAt)}</td><td>{h.fromStatus ? STATUS_LABEL[h.fromStatus] : "—"}</td><td>{STATUS_LABEL[h.toStatus]}</td><td>{h.changedBy?.name ?? "System"}</td><td>{h.note}</td></tr>
              ))}
              {o.history.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">No status changes yet.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card overflow-hidden">
          <h2 className="h2 border-b border-line px-3 py-2">Reminders sent for this obligation</h2>
          <table className="tbl">
            <thead><tr><th>Scheduled</th><th>Track</th><th>Recipient</th><th>Status</th><th>Sent</th></tr></thead>
            <tbody>
              {o.reminderLogs.map((r) => (
                <tr key={r.id} title={r.error ?? r.subject}>
                  <td className="whitespace-nowrap">{formatDate(r.scheduledFor)}</td><td>{r.track.replace(/_/g, " ").toLowerCase()}</td><td>{r.recipientEmail}</td>
                  <td><span className={`chip ${r.status === "FAILED" ? "t-red" : r.status === "SENT" || r.status === "REDIRECTED_TEST" ? "t-green" : "t-grey"}`}>{r.status.replace(/_/g, " ").toLowerCase()}</span></td>
                  <td className="whitespace-nowrap">{formatDateTime(r.sentAt)}</td>
                </tr>
              ))}
              {o.reminderLogs.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">No reminders yet.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
