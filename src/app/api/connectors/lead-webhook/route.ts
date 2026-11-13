/**
 * Connector: website / Zapier / Power Automate → lead.
 * POST JSON or form-encoded with header `x-webhook-secret: $LEAD_WEBHOOK_SECRET`.
 * Fields: name (required), company, email, mobile|phone, country, service (comma-separated
 * service lines), message, source. The lead is assigned and given a next-action date.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createLeadFromWebForm } from "@/lib/services/leads";
import { logConnector } from "@/lib/connectors/log";
import { errorMessage } from "@/lib/web";

const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  const given = req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("secret") ?? "";
  if (!secret) {
    await logConnector("lead-webhook", "INBOUND", "DISABLED", "LEAD_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  if (given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    await logConnector("lead-webhook", "INBOUND", "ERROR", "bad secret");
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 30) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  hits.set(ip, [...recent, now]);

  let body: Record<string, unknown>;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) body = (await req.json()) as Record<string, unknown>;
  else body = Object.fromEntries((await req.formData()).entries());
  try {
    const lead = await createLeadFromWebForm(body, ip);
    await logConnector("lead-webhook", "INBOUND", "OK", "lead created", { type: "lead", id: lead.id });
    return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
  } catch (e) {
    const msg = errorMessage(e);
    await logConnector("lead-webhook", "INBOUND", "ERROR", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
