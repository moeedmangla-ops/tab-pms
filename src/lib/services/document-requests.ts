import { prisma } from "../db";
import { Actor, obligationWhere, requirePermission } from "../permissions";
import { deliver, render } from "../mailer";
import { formatDate, todayDubai } from "../dates";
import { claimDedupe } from "../engine/reminders";
import { changeStatus } from "./obligations";

/**
 * Manual document request (bulk action). One request per obligation per day
 * (dedupe key), sent to the client's accounts/primary contact, logged in
 * reminder_log and the client timeline, and moves Upcoming → Documents Requested.
 */
export async function sendDocumentRequests(actor: Actor, ids: string[]) {
  requirePermission(actor, "obligations", "edit");
  const today = todayDubai();
  const tpl = await prisma.emailTemplate.findUniqueOrThrow({ where: { key: "client_documents" } });
  const obs = await prisma.obligation.findMany({
    where: { AND: [{ id: { in: ids } }, obligationWhere(actor), { deletedAt: null }] },
    include: { client: { include: { contacts: { where: { deletedAt: null } } } } },
  });
  let sent = 0;
  const skipped: string[] = [];
  for (const o of obs) {
    const c = o.client.contacts.find((x) => x.isAccounts && x.email) ?? o.client.contacts.find((x) => x.isPrimary && x.email) ?? o.client.contacts.find((x) => x.email);
    if (!c?.email) { skipped.push(`${o.client.legalName}: no contact email`); continue; }
    const v = { recipient_name: c.name, client_name: o.client.legalName, obligation_title: o.title, statutory_due_date: formatDate(o.statutoryDueDate) };
    const subject = render(tpl.subject, v);
    const logId = await claimDedupe({ obligationId: o.id, track: "CLIENT_DOCUMENT_REQUEST", recipientEmail: c.email, templateKey: tpl.key, subject, scheduledFor: today, dedupeKey: `manual-docreq|${o.id}|${c.email.toLowerCase()}|${today}` });
    if (!logId) { skipped.push(`${o.client.legalName}: already requested today`); continue; }
    try {
      const r = await deliver({ to: [c.email], subject, text: render(tpl.body, v) });
      await prisma.reminderLog.update({ where: { id: logId }, data: { status: r.status, sentAt: r.status === "SKIPPED_PAUSED" ? null : new Date(), attempts: 1 } });
      await prisma.communication.create({ data: { clientId: o.clientId, obligationId: o.id, channel: "EMAIL", direction: "OUTBOUND", subject, summary: "Document request sent from the system", participants: [c.email], occurredAt: new Date(), loggedById: actor.id } });
      if (o.status === "UPCOMING") await changeStatus(actor, o.id, { to: "DOCUMENTS_REQUESTED", note: "Document request sent" });
      sent++;
    } catch (e) {
      await prisma.reminderLog.update({ where: { id: logId }, data: { status: "FAILED", error: e instanceof Error ? e.message.slice(0, 500) : String(e), attempts: 1 } });
      skipped.push(`${o.client.legalName}: ${e instanceof Error ? e.message : "send failed"}`);
    }
  }
  return { sent, skipped };
}
