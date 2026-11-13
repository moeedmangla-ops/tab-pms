import { LeadSource, LeadStage, Prisma, ServiceLine } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import { Actor, ForbiddenError, canEditLead, leadWhere, requirePermission } from "../permissions";
import { addDays, toDbDate, todayDubai } from "../dates";
import { ValidationError } from "./obligations";
import { searchTextFor } from "./clients";
import { generateObligations } from "../engine/generate";

export const LeadInput = z.object({
  name: z.string().trim().min(2, "Name is required"),
  company: z.string().trim().optional().transform((v) => v || null),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")).transform((v) => v || null),
  mobile: z.string().trim().optional().transform((v) => v || null),
  country: z.string().trim().optional().transform((v) => v || null),
  source: z.nativeEnum(LeadSource),
  serviceInterest: z.array(z.nativeEnum(ServiceLine)).default([]),
  estimatedAnnualFee: z.coerce.number().nonnegative().optional().nullable(),
  ownerId: z.string().min(1, "Owner is mandatory"),
  nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Next-action date is mandatory"),
  nextAction: z.string().trim().optional().transform((v) => v || null),
  notes: z.string().trim().optional().transform((v) => v || null),
});

export const STAGE_ORDER: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"];
/** Default stage probabilities for weighted pipeline value (configurable later in settings). */
export const STAGE_WEIGHT: Record<LeadStage, number> = { NEW: 0.1, CONTACTED: 0.2, QUALIFIED: 0.4, PROPOSAL_SENT: 0.6, NEGOTIATION: 0.8, WON: 1, LOST: 0 };

export async function createLead(actor: Actor | null, raw: unknown, ip?: string | null) {
  if (actor) requirePermission(actor, "leads", "edit");
  const d = LeadInput.parse(raw);
  if (actor && !canEditLead(actor, d.ownerId) && d.ownerId !== actor.id) throw new ForbiddenError("You can only create leads you own.");
  const l = await prisma.lead.create({ data: { ...d, estimatedAnnualFee: d.estimatedAnnualFee ?? null, nextActionDate: toDbDate(d.nextActionDate) } });
  await audit(prisma, { userId: actor?.id ?? null, ip, action: "CREATE", table: "lead", recordId: l.id, after: { name: d.name, source: d.source } });
  return l;
}

/** Round-robin owner for web-form leads: the Business Development user with the fewest open leads. */
export async function autoOwner(): Promise<string> {
  const bd = await prisma.user.findMany({
    where: { isActive: true, role: { key: { in: ["BUSINESS_DEVELOPMENT"] } } },
    select: { id: true, _count: { select: { ownedLeads: { where: { stage: { notIn: ["WON", "LOST"] }, deletedAt: null } } } } },
  });
  const pool = bd.length ? bd : await prisma.user.findMany({ where: { isActive: true, role: { key: "MANAGING_PARTNER" } }, select: { id: true, _count: { select: { ownedLeads: true } } } });
  if (!pool.length) throw new Error("No active Business Development or Managing Partner user to own web leads.");
  pool.sort((a, b) => a._count.ownedLeads - b._count.ownedLeads);
  return pool[0].id;
}

/** Website / Zapier / Power Automate enquiry → lead, assigned, next action = next working day. */
export async function createLeadFromWebForm(raw: Record<string, unknown>, ip?: string | null) {
  const ownerId = await autoOwner();
  const today = todayDubai();
  const { loadCalendar } = await import("../engine/calendar");
  const cal = await loadCalendar();
  let next = addDays(today, 1);
  while (!cal.isWorkingDay(next)) next = addDays(next, 1);
  const services = String(raw.service ?? raw.serviceInterest ?? "")
    .split(/[,;]/)
    .map((s) => s.trim().toUpperCase().replace(/[\s-]+/g, "_"))
    .filter((s): s is ServiceLine => (Object.values(ServiceLine) as string[]).includes(s));
  return createLead(
    null,
    {
      name: raw.name ?? raw.full_name,
      company: raw.company,
      email: raw.email,
      mobile: raw.mobile ?? raw.phone,
      country: raw.country,
      source: (Object.values(LeadSource) as string[]).includes(String(raw.source)) ? raw.source : "WEBSITE_FORM",
      serviceInterest: services,
      notes: raw.message ?? raw.notes,
      ownerId,
      nextActionDate: next,
      nextAction: "First contact — reply to enquiry",
    },
    ip,
  );
}

async function loadEditable(actor: Actor, id: string) {
  const l = await prisma.lead.findFirst({ where: { AND: [{ id, deletedAt: null }, leadWhere(actor)] } });
  if (!l) throw new ForbiddenError("Lead not found or not accessible.");
  if (!canEditLead(actor, l.ownerId)) throw new ForbiddenError();
  return l;
}

export async function updateLead(actor: Actor, id: string, raw: unknown, ip?: string | null) {
  const before = await loadEditable(actor, id);
  const d = LeadInput.parse(raw);
  const l = await prisma.lead.update({ where: { id }, data: { ...d, estimatedAnnualFee: d.estimatedAnnualFee ?? null, nextActionDate: toDbDate(d.nextActionDate) } });
  await audit(prisma, { userId: actor.id, ip, action: "UPDATE", table: "lead", recordId: id, before, after: l });
  return l;
}

export async function changeLeadStage(actor: Actor, id: string, stage: LeadStage, lostReason?: string, ip?: string | null) {
  const before = await loadEditable(actor, id);
  if (stage === "LOST" && !lostReason?.trim()) throw new ValidationError("A lost lead requires a reason.");
  if (stage === "WON") throw new ValidationError("Use Convert to client to mark a lead as won.");
  const data: Prisma.LeadUpdateInput = { stage, lostReason: stage === "LOST" ? lostReason : null };
  if (stage !== "NEW" && !before.firstContactAt) data.firstContactAt = new Date();
  const l = await prisma.lead.update({ where: { id }, data });
  await audit(prisma, { userId: actor.id, ip, action: "UPDATE", table: "lead", recordId: id, before, after: l });
  return l;
}

/** Logging a contact starts the response-time clock's end. */
export async function logLeadContact(actor: Actor, id: string, c: { channel: "EMAIL" | "PHONE" | "WHATSAPP" | "MEETING" | "SITE_VISIT"; subject: string; summary?: string; nextActionDate: string; nextAction?: string }) {
  const before = await loadEditable(actor, id);
  await prisma.$transaction([
    prisma.communication.create({ data: { leadId: id, channel: c.channel, direction: "OUTBOUND", subject: c.subject, summary: c.summary, participants: [], occurredAt: new Date(), loggedById: actor.id } }),
    prisma.lead.update({
      where: { id },
      data: { firstContactAt: before.firstContactAt ?? new Date(), stage: before.stage === "NEW" ? "CONTACTED" : before.stage, nextActionDate: toDbDate(c.nextActionDate), nextAction: c.nextAction ?? null },
    }),
  ]);
}

export const ConvertInput = z.object({
  clientCode: z.string().trim().min(1),
  legalName: z.string().trim().min(2),
  engagements: z
    .array(z.object({ serviceLine: z.nativeEnum(ServiceLine), fee: z.coerce.number().nonnegative(), billingFrequency: z.enum(["ONE_OFF", "MONTHLY", "QUARTERLY", "ANNUAL"]), managerId: z.string().optional(), preparerId: z.string().optional(), partnerId: z.string().optional() }))
    .min(1, "Add at least one service"),
});

/** Won lead → client + primary contact + notes + engagements, then obligations generate. */
export async function convertLead(actor: Actor, id: string, raw: unknown, ip?: string | null) {
  const l = await loadEditable(actor, id);
  if (l.convertedClientId) throw new ValidationError("Lead already converted.");
  const d = ConvertInput.parse(raw);
  const today = todayDubai();
  const client = await prisma.$transaction(async (tx) => {
    const c = await tx.client.create({
      data: {
        clientCode: d.clientCode,
        legalName: d.legalName,
        status: "ACTIVE",
        notes: l.notes,
        searchText: searchTextFor({ legalName: d.legalName, clientCode: d.clientCode, contacts: [{ email: l.email, mobile: l.mobile }] }),
        taxProfile: { create: {} },
        contacts: { create: { name: l.name, email: l.email, mobile: l.mobile, isPrimary: true } },
        engagements: { create: d.engagements.map((e) => ({ ...e, contractStart: toDbDate(today), managerId: e.managerId || null, preparerId: e.preparerId || null, partnerId: e.partnerId || null })) },
      },
    });
    await tx.lead.update({ where: { id }, data: { stage: "WON", convertedClientId: c.id } });
    await tx.communication.updateMany({ where: { leadId: id }, data: { clientId: c.id } });
    await audit(tx, { userId: actor.id, ip, action: "CREATE", table: "client", recordId: c.id, after: { fromLead: id, legalName: d.legalName } });
    return c;
  });
  await generateObligations({ clientIds: [client.id] });
  return client;
}
