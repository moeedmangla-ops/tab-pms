/**
 * Connector: Microsoft Graph (app-only, client-credentials).
 *
 * Mail.Send          — send from the shared compliance mailbox (Phase 1)
 * Mail.Read          — read shared mailboxes for the client timeline (Phase 2)
 *
 * Required Entra app registration (application permissions, admin consent):
 *   Mail.Send, Mail.Read — scope them to the compliance mailbox with an
 *   Exchange Online application access policy (New-ApplicationAccessPolicy).
 *
 * Disabled unless GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET are set.
 */
import { logConnector } from "./log";

export function graphEnabled() {
  return Boolean(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET);
}

let cached: { token: string; exp: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID!,
      client_secret: process.env.GRAPH_CLIENT_SECRET!,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  if (!res.ok) throw new Error(`Graph token request failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function graph(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 429 || res.status >= 500) throw new Error(`Graph ${res.status} (retryable)`);
  return res;
}

export type OutboundMail = { from: string; to: string[]; cc?: string[]; subject: string; text: string };

export async function graphSendMail(m: OutboundMail): Promise<void> {
  const res = await graph(`/users/${encodeURIComponent(m.from)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: m.subject,
        body: { contentType: "Text", content: m.text },
        toRecipients: m.to.map((a) => ({ emailAddress: { address: a } })),
        ccRecipients: (m.cc ?? []).map((a) => ({ emailAddress: { address: a } })),
      },
      saveToSentItems: true,
    }),
  });
  if (res.status !== 202) {
    const body = await res.text();
    await logConnector("graph-mail", "OUTBOUND", "ERROR", `sendMail ${res.status}: ${body.slice(0, 300)}`);
    throw new Error(`Graph sendMail failed (${res.status})`);
  }
  await logConnector("graph-mail", "OUTBOUND", "OK", "sendMail 202");
}

export type GraphMessage = {
  id: string;
  subject: string;
  receivedDateTime: string;
  from?: { emailAddress: { address: string; name?: string } };
  toRecipients: { emailAddress: { address: string } }[];
  ccRecipients: { emailAddress: { address: string } }[];
  bodyPreview?: string;
};

/** Messages in a mailbox received since an ISO timestamp (Phase 2 timeline sync). */
export async function graphListMessages(mailbox: string, sinceIso: string, top = 50): Promise<GraphMessage[]> {
  const q = new URLSearchParams({
    $filter: `receivedDateTime ge ${sinceIso}`,
    $select: "id,subject,receivedDateTime,from,toRecipients,ccRecipients,bodyPreview",
    $orderby: "receivedDateTime asc",
    $top: String(top),
  });
  const res = await graph(`/users/${encodeURIComponent(mailbox)}/messages?${q}`);
  if (!res.ok) {
    await logConnector("graph-mail-sync", "INBOUND", "ERROR", `list ${res.status}`);
    throw new Error(`Graph list messages failed (${res.status})`);
  }
  const j = (await res.json()) as { value: GraphMessage[] };
  return j.value;
}
