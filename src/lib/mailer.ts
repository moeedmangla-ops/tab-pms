/**
 * Outbound email gateway. Every message from the system goes through `deliver`,
 * which honours the global pause switch and the test-mode redirect (Section 6),
 * then hands off to the Microsoft Graph connector. With Graph not configured,
 * messages are written to the outbox log (status SENT via "console" transport)
 * only when MAIL_TRANSPORT=console — otherwise they fail loudly.
 */
import { getSettings } from "./settings";
import { graphEnabled, graphSendMail } from "./connectors/graph";
import { logConnector } from "./connectors/log";

export type Mail = { to: string[]; cc?: string[]; subject: string; text: string };
export type DeliveryResult = { status: "SENT" | "SKIPPED_PAUSED" | "REDIRECTED_TEST"; transport: string };

/** In-process outbox used by the console transport and by tests. */
export const outbox: (Mail & { at: Date })[] = [];

export async function deliver(mail: Mail): Promise<DeliveryResult> {
  const s = await getSettings();
  if (s["email.paused"] === "true") return { status: "SKIPPED_PAUSED", transport: "none" };

  let m = mail;
  let redirected = false;
  if (s["email.testModeAddress"]) {
    m = {
      to: [s["email.testModeAddress"]],
      subject: `[TEST → ${mail.to.join(", ")}] ${mail.subject}`,
      text: mail.text,
    };
    redirected = true;
  }

  const transport = process.env.MAIL_TRANSPORT ?? (graphEnabled() ? "graph" : "none");
  if (transport === "graph") {
    if (!s["email.senderMailbox"]) throw new Error("Sender mailbox is not configured (Settings → Email).");
    await graphSendMail({ from: s["email.senderMailbox"], ...m });
  } else if (transport === "console") {
    outbox.push({ ...m, at: new Date() });
    await logConnector("mail-console", "OUTBOUND", "OK", `console transport: ${m.subject.slice(0, 80)}`);
  } else {
    await logConnector("graph-mail", "OUTBOUND", "DISABLED", "No mail transport configured");
    throw new Error("No mail transport configured: set the GRAPH_* variables or MAIL_TRANSPORT=console.");
  }
  return { status: redirected ? "REDIRECTED_TEST" : "SENT", transport };
}

/** {{merge_field}} substitution. Unknown fields are left visible so a bad template is noticed. */
export function render(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k: string) => (vars[k] === undefined || vars[k] === null ? all : String(vars[k])));
}
