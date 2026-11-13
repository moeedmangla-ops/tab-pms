/**
 * Connector: Outlook → client timeline (Phase 2, BUILD_SPEC Section 7).
 * Reads the shared mailboxes listed in GRAPH_SYNC_MAILBOXES, matches each
 * message's participants against contact emails, and logs a Communication on
 * the client. Stores subject, participants, timestamp; stores a body preview only
 * when Settings → email.storeBodies is on. Idempotent on the Graph message id.
 */
import { prisma } from "../db";
import { getSetting } from "../settings";
import { graphEnabled, graphListMessages } from "./graph";
import { logConnector } from "./log";

export async function syncOutlookToTimeline(): Promise<{ scanned: number; linked: number; skipped?: string }> {
  const boxes = (process.env.GRAPH_SYNC_MAILBOXES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!graphEnabled() || boxes.length === 0) {
    await logConnector("graph-mail-sync", "INBOUND", "DISABLED", "Graph or GRAPH_SYNC_MAILBOXES not configured");
    return { scanned: 0, linked: 0, skipped: "not configured" };
  }
  const storeBodies = (await getSetting("email.storeBodies")) === "true";
  let scanned = 0;
  let linked = 0;
  for (const box of boxes) {
    const cursorKey = `sync.cursor.${box}`;
    const cur = await prisma.appSetting.findUnique({ where: { key: cursorKey } });
    const since = cur?.value ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
    const msgs = await graphListMessages(box, since);
    let last = since;
    for (const m of msgs) {
      scanned++;
      last = m.receivedDateTime;
      const addrs = [m.from?.emailAddress.address, ...m.toRecipients.map((r) => r.emailAddress.address), ...m.ccRecipients.map((r) => r.emailAddress.address)]
        .filter(Boolean)
        .map((a) => a!.toLowerCase());
      const contacts = await prisma.contact.findMany({ where: { deletedAt: null, email: { in: addrs, mode: "insensitive" } }, select: { clientId: true } });
      const clientIds = [...new Set(contacts.map((c) => c.clientId))];
      for (const clientId of clientIds) {
        const exists = await prisma.communication.findUnique({ where: { externalId: `${m.id}:${clientId}` } });
        if (exists) continue;
        await prisma.communication.create({
          data: {
            clientId,
            channel: "EMAIL",
            direction: m.from?.emailAddress.address.toLowerCase() === box.toLowerCase() ? "OUTBOUND" : "INBOUND",
            subject: m.subject || "(no subject)",
            summary: storeBodies ? m.bodyPreview ?? null : null,
            participants: addrs,
            occurredAt: new Date(m.receivedDateTime),
            externalId: `${m.id}:${clientId}`,
          },
        });
        linked++;
      }
    }
    await prisma.appSetting.upsert({ where: { key: cursorKey }, update: { value: last }, create: { key: cursorKey, value: last } });
  }
  await logConnector("graph-mail-sync", "INBOUND", "OK", `scanned ${scanned}, linked ${linked}`);
  return { scanned, linked };
}
