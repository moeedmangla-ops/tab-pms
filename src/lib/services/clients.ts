import { ClientStatus, EntityType, FilingFrequency, Prisma, ServiceLine } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import { Actor, ForbiddenError, clientWhere, requirePermission } from "../permissions";
import { FILED } from "../engine/workflow";
import { toDbDate, todayDubai } from "../dates";
import { generateObligations } from "../engine/generate";
import { ValidationError } from "./obligations";

const optStr = z.string().trim().optional().transform((v) => (v ? v : null));
const optDate = z.string().trim().optional().transform((v) => (v ? v : null)).refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use YYYY-MM-DD");

export const ClientInput = z.object({
  clientCode: z.string().trim().min(1, "Client code is required"),
  legalName: z.string().trim().min(2, "Legal name is required"),
  tradeName: optStr,
  entityType: z.nativeEnum(EntityType).default("LLC"),
  licenceNumber: optStr,
  licenceAuthority: optStr,
  licenceExpiry: optDate,
  emirate: optStr,
  industry: optStr,
  status: z.nativeEnum(ClientStatus).default("ACTIVE"),
  fyEndMonth: z.coerce.number().int().min(1).max(12).optional().nullable(),
  fyEndDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
  relationshipPartnerId: optStr,
  notes: optStr,
  vatTrn: optStr.refine((v) => v === null || /^\d{15}$/.test(v), "VAT TRN must be 15 digits"),
  vatFrequency: z.nativeEnum(FilingFrequency).default("NOT_REGISTERED"),
  vatPeriodAnchor: optDate,
  vatEffectiveDate: optDate,
  ctRegistered: z.coerce.boolean().default(false),
  ctRegistrationNo: optStr,
  ctFirstPeriodStart: optDate,
  freeZone: z.coerce.boolean().default(false),
  qfzpStatus: z.coerce.boolean().default(false),
  smallBusinessRelief: z.coerce.boolean().default(false),
});
export type ClientInputT = z.infer<typeof ClientInput>;

export function searchTextFor(c: Partial<ClientInputT> & { contacts?: { email?: string | null; mobile?: string | null }[] }) {
  return [c.legalName, c.tradeName, c.clientCode, c.vatTrn, c.ctRegistrationNo, c.licenceNumber, ...(c.contacts ?? []).flatMap((x) => [x.email, x.mobile])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export type ClientFilters = { q?: string; status?: ClientStatus; serviceLine?: ServiceLine; managerId?: string; emirate?: string; vatFrequency?: FilingFrequency; fyEndMonth?: number; includeArchived?: boolean };

export function clientFilterWhere(actor: Actor, f: ClientFilters): Prisma.ClientWhereInput {
  const and: Prisma.ClientWhereInput[] = [clientWhere(actor), { deletedAt: null }];
  if (!f.includeArchived && !f.status) and.push({ status: { not: "ARCHIVED" } });
  if (f.status) and.push({ status: f.status });
  if (f.q) {
    const q = f.q.toLowerCase().trim();
    and.push({ OR: [{ searchText: { contains: q } }, { contacts: { some: { OR: [{ email: { contains: q, mode: "insensitive" } }, { mobile: { contains: q } }] } } }] });
  }
  if (f.serviceLine) and.push({ engagements: { some: { serviceLine: f.serviceLine, isActive: true } } });
  if (f.managerId) and.push({ engagements: { some: { managerId: f.managerId, isActive: true } } });
  if (f.emirate) and.push({ emirate: f.emirate });
  if (f.vatFrequency) and.push({ taxProfile: { vatFrequency: f.vatFrequency } });
  if (f.fyEndMonth) and.push({ fyEndMonth: f.fyEndMonth });
  return { AND: and };
}

export async function listClients(actor: Actor, f: ClientFilters, page = 1, pageSize = 50, sort: "legalName" | "clientCode" | "updatedAt" = "legalName") {
  const where = clientFilterWhere(actor, f);
  const [total, rows] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      include: { taxProfile: { select: { vatFrequency: true, vatTrn: true } }, engagements: { where: { isActive: true }, select: { serviceLine: true, manager: { select: { name: true } } } } },
      orderBy: { [sort]: sort === "updatedAt" ? "desc" : "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, rows, page, pageSize };
}

export async function getClientForActor(actor: Actor, id: string) {
  const c = await prisma.client.findFirst({ where: { AND: [{ id }, clientWhere(actor)] } });
  if (!c) throw new ForbiddenError("Client not found or not accessible.");
  return c;
}

function splitInput(d: ClientInputT) {
  const client = {
    clientCode: d.clientCode,
    legalName: d.legalName,
    tradeName: d.tradeName,
    entityType: d.entityType,
    licenceNumber: d.licenceNumber,
    licenceAuthority: d.licenceAuthority,
    licenceExpiry: d.licenceExpiry ? toDbDate(d.licenceExpiry) : null,
    emirate: d.emirate,
    industry: d.industry,
    status: d.status,
    fyEndMonth: d.fyEndMonth ?? null,
    fyEndDay: d.fyEndDay ?? null,
    relationshipPartnerId: d.relationshipPartnerId,
    notes: d.notes,
  };
  const tax = {
    vatTrn: d.vatTrn,
    vatFrequency: d.vatFrequency,
    vatPeriodAnchor: d.vatPeriodAnchor ? toDbDate(d.vatPeriodAnchor) : null,
    vatEffectiveDate: d.vatEffectiveDate ? toDbDate(d.vatEffectiveDate) : null,
    ctRegistered: d.ctRegistered,
    ctRegistrationNo: d.ctRegistrationNo,
    ctFirstPeriodStart: d.ctFirstPeriodStart ? toDbDate(d.ctFirstPeriodStart) : null,
    freeZone: d.freeZone,
    qfzpStatus: d.qfzpStatus,
    smallBusinessRelief: d.smallBusinessRelief,
  };
  return { client, tax };
}

function friendlyUnique(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const t = String((e.meta as { target?: string[] })?.target ?? "");
    if (t.includes("vatTrn")) throw new ValidationError("Another client already has this VAT TRN.");
    if (t.includes("clientCode")) throw new ValidationError("Client code already exists.");
    if (t.includes("ctRegistrationNo")) throw new ValidationError("Another client already has this CT registration number.");
    throw new ValidationError("Duplicate value.");
  }
  throw e;
}

export async function createClient(actor: Actor, raw: unknown, ip?: string | null) {
  requirePermission(actor, "clients", "edit");
  const d = ClientInput.parse(raw);
  const { client, tax } = splitInput(d);
  try {
    const c = await prisma.$transaction(async (tx) => {
      const c = await tx.client.create({ data: { ...client, searchText: searchTextFor(d), taxProfile: { create: tax } } });
      await audit(tx, { userId: actor.id, ip, action: "CREATE", table: "client", recordId: c.id, after: { ...client, ...tax } });
      return c;
    });
    await generateObligations({ clientIds: [c.id] });
    return c;
  } catch (e) {
    friendlyUnique(e);
  }
}

/**
 * Update. If the year-end, VAT frequency or VAT anchor changes, future
 * not-yet-filed obligations are flagged for review — never rewritten — and
 * filed or past ones are left untouched (BUILD_SPEC Section 4).
 */
export async function updateClient(actor: Actor, id: string, raw: unknown, ip?: string | null) {
  requirePermission(actor, "clients", "edit");
  const before = await getClientForActor(actor, id);
  const beforeTax = await prisma.clientTaxProfile.findUnique({ where: { clientId: id } });
  const d = ClientInput.parse(raw);
  const { client, tax } = splitInput(d);
  const contacts = await prisma.contact.findMany({ where: { clientId: id, deletedAt: null } });
  const today = todayDubai();

  const yeChanged = before.fyEndMonth !== client.fyEndMonth || before.fyEndDay !== client.fyEndDay;
  const vatChanged = (beforeTax?.vatFrequency ?? "NOT_REGISTERED") !== tax.vatFrequency || (beforeTax?.vatPeriodAnchor?.getTime() ?? null) !== (tax.vatPeriodAnchor?.getTime() ?? null);

  try {
    await prisma.$transaction(async (tx) => {
      const c = await tx.client.update({ where: { id }, data: { ...client, searchText: searchTextFor({ ...d, contacts }) } });
      const t = await tx.clientTaxProfile.upsert({ where: { clientId: id }, update: tax, create: { clientId: id, ...tax } });
      await audit(tx, { userId: actor.id, ip, action: "UPDATE", table: "client", recordId: id, before: { ...before, ...(beforeTax ?? {}) }, after: { ...c, ...t } });
      const flag = async (type: "CT_RETURN" | "VAT_RETURN", reason: string) => {
        await tx.obligation.updateMany({
          where: { clientId: id, type, deletedAt: null, status: { notIn: FILED }, periodEnd: { gte: toDbDate(today) } },
          data: { needsReview: true, needsReviewReason: reason },
        });
      };
      if (yeChanged) await flag("CT_RETURN", `Financial year-end changed from ${before.fyEndDay ?? "?"}/${before.fyEndMonth ?? "?"} to ${client.fyEndDay ?? "?"}/${client.fyEndMonth ?? "?"}`);
      if (vatChanged) await flag("VAT_RETURN", `VAT filing frequency or period anchor changed`);
    });
  } catch (e) {
    friendlyUnique(e);
  }
  // Fill any genuinely missing periods only when nothing is pending review for that type;
  // otherwise a person decides first.
  if (!yeChanged && !vatChanged) await generateObligations({ clientIds: [id] });
}

export async function archiveClient(actor: Actor, id: string, ip?: string | null) {
  requirePermission(actor, "clients", "edit");
  const before = await getClientForActor(actor, id);
  const c = await prisma.client.update({ where: { id }, data: { status: "ARCHIVED" } });
  await audit(prisma, { userId: actor.id, ip, action: "UPDATE", table: "client", recordId: id, before, after: c });
}

export async function bulkReassign(actor: Actor, fromUserId: string, toUserId: string, role: "manager" | "preparer" | "partner", clientIds: string[], ip?: string | null) {
  requirePermission(actor, "clients", "edit");
  const field = role === "manager" ? "managerId" : role === "preparer" ? "preparerId" : "partnerId";
  const allowed = await prisma.client.findMany({ where: { AND: [{ id: { in: clientIds } }, clientWhere(actor)] }, select: { id: true } });
  const ids = allowed.map((a) => a.id);
  const today = todayDubai();
  return prisma.$transaction(async (tx) => {
    const engs = await tx.serviceEngagement.updateMany({ where: { clientId: { in: ids }, [field]: fromUserId }, data: { [field]: toUserId } });
    let obls = 0;
    if (role === "preparer") obls = (await tx.obligation.updateMany({ where: { clientId: { in: ids }, preparerId: fromUserId, status: { notIn: FILED }, statutoryDueDate: { gte: toDbDate(today) } }, data: { preparerId: toUserId } })).count;
    if (role === "manager") obls = (await tx.obligation.updateMany({ where: { clientId: { in: ids }, reviewerId: fromUserId, status: { notIn: FILED }, statutoryDueDate: { gte: toDbDate(today) } }, data: { reviewerId: toUserId } })).count;
    for (const id of ids) await audit(tx, { userId: actor.id, ip, action: "UPDATE", table: "client", recordId: id, before: { [field]: fromUserId }, after: { [field]: toUserId } });
    return { clients: ids.length, engagements: engs.count, obligations: obls };
  });
}
