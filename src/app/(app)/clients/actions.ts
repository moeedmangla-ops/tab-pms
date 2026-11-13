"use server";
import { requireUser, clientIp } from "@/lib/auth";
import { act, str } from "@/lib/web";
import { archiveClient, bulkReassign, createClient, getClientForActor, updateClient } from "@/lib/services/clients";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { ValidationError } from "@/lib/services/obligations";
import { generateObligations } from "@/lib/engine/generate";
import { toDbDate } from "@/lib/dates";
import { redirect } from "next/navigation";
import { ServiceLine, BillingFrequency, CommChannel, CommDirection } from "@prisma/client";

function formToClient(fd: FormData) {
  const o: Record<string, unknown> = {};
  for (const k of ["clientCode","legalName","tradeName","entityType","licenceNumber","licenceAuthority","licenceExpiry","emirate","industry","status","relationshipPartnerId","notes","vatTrn","vatFrequency","vatPeriodAnchor","vatEffectiveDate","ctRegistrationNo","ctFirstPeriodStart"]) o[k] = str(fd, k);
  const m = str(fd, "fyEndMonth"); const d = str(fd, "fyEndDay");
  o.fyEndMonth = m ? Number(m) : null; o.fyEndDay = d ? Number(d) : null;
  for (const k of ["ctRegistered","freeZone","qfzpStatus","smallBusinessRelief"]) o[k] = fd.get(k) === "on";
  return o;
}

export async function createAndOpen(fd: FormData) {
  const u = await requireUser();
  let id: string | undefined;
  let err: string | undefined;
  try { id = (await createClient(u, formToClient(fd), await clientIp()))!.id; } catch (e) { err = (await import("@/lib/web")).errorMessage(e); }
  if (err) redirect(`/clients/new?error=${encodeURIComponent(err)}`);
  redirect(`/clients/${id}?ok=${encodeURIComponent("Client created. Add services so obligations are assigned.")}`);
}

export async function update(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/clients/${id}/edit`, async () => updateClient(u, id, formToClient(fd), await clientIp()), "Client saved", `/clients/${id}`);
}

export async function archive(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/clients/${id}`, async () => archiveClient(u, id, await clientIp()), "Client archived");
}

export async function addContact(fd: FormData) {
  const u = await requireUser();
  const clientId = str(fd, "clientId");
  await act(`/clients/${clientId}?tab=contacts`, async () => {
    requirePermission(u, "clients", "edit");
    await getClientForActor(u, clientId);
    if (!str(fd, "name")) throw new ValidationError("Contact name is required.");
    const c = await prisma.contact.create({ data: { clientId, name: str(fd, "name"), designation: str(fd, "designation") || null, email: str(fd, "email") || null, mobile: str(fd, "mobile") || null, isPrimary: fd.get("isPrimary") === "on", isAccounts: fd.get("isAccounts") === "on", isAuthorisedSignatory: fd.get("isAuthorisedSignatory") === "on" } });
    const all = await prisma.contact.findMany({ where: { clientId, deletedAt: null } });
    const cl = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, include: { taxProfile: true } });
    const { searchTextFor } = await import("@/lib/services/clients");
    await prisma.client.update({ where: { id: clientId }, data: { searchText: searchTextFor({ legalName: cl.legalName, tradeName: cl.tradeName, clientCode: cl.clientCode, vatTrn: cl.taxProfile?.vatTrn, ctRegistrationNo: cl.taxProfile?.ctRegistrationNo, licenceNumber: cl.licenceNumber, contacts: all }) } });
    await audit(prisma, { userId: u.id, ip: await clientIp(), action: "CREATE", table: "contact", recordId: c.id, after: { clientId, name: c.name } });
  }, "Contact added");
}

export async function removeContact(fd: FormData) {
  const u = await requireUser();
  const clientId = str(fd, "clientId");
  await act(`/clients/${clientId}?tab=contacts`, async () => {
    requirePermission(u, "clients", "edit");
    await getClientForActor(u, clientId);
    await prisma.contact.update({ where: { id: str(fd, "id") }, data: { deletedAt: new Date() } });
    await audit(prisma, { userId: u.id, action: "DELETE", table: "contact", recordId: str(fd, "id") });
  }, "Contact removed");
}

export async function addEngagement(fd: FormData) {
  const u = await requireUser();
  const clientId = str(fd, "clientId");
  await act(`/clients/${clientId}?tab=services`, async () => {
    requirePermission(u, "clients", "edit");
    await getClientForActor(u, clientId);
    const e = await prisma.serviceEngagement.create({
      data: {
        clientId,
        serviceLine: str(fd, "serviceLine") as ServiceLine,
        fee: Number(str(fd, "fee") || 0),
        billingFrequency: (str(fd, "billingFrequency") || "ANNUAL") as BillingFrequency,
        contractStart: toDbDate(str(fd, "contractStart")),
        contractEnd: str(fd, "contractEnd") ? toDbDate(str(fd, "contractEnd")) : null,
        partnerId: str(fd, "partnerId") || null,
        managerId: str(fd, "managerId") || null,
        preparerId: str(fd, "preparerId") || null,
      },
    });
    await audit(prisma, { userId: u.id, ip: await clientIp(), action: "CREATE", table: "service_engagement", recordId: e.id, after: { serviceLine: e.serviceLine, fee: String(e.fee) } });
    // Assign open, unassigned obligations of the matching type to this team.
    const typeFor: Partial<Record<ServiceLine, "VAT_RETURN" | "CT_RETURN" | "AUDIT_REPORT">> = { VAT: "VAT_RETURN", CORPORATE_TAX: "CT_RETURN", AUDIT: "AUDIT_REPORT" };
    const t = typeFor[e.serviceLine];
    if (t) await prisma.obligation.updateMany({ where: { clientId, type: t, preparerId: null, deletedAt: null, status: { notIn: ["SUBMITTED", "PAYMENT_PENDING", "COMPLETED"] } }, data: { preparerId: e.preparerId, reviewerId: e.managerId, engagementId: e.id } });
    await generateObligations({ clientIds: [clientId] });
  }, "Service added");
}

export async function endEngagement(fd: FormData) {
  const u = await requireUser();
  const clientId = str(fd, "clientId");
  await act(`/clients/${clientId}?tab=services`, async () => {
    requirePermission(u, "clients", "edit");
    await getClientForActor(u, clientId);
    await prisma.serviceEngagement.update({ where: { id: str(fd, "id") }, data: { isActive: false } });
    await audit(prisma, { userId: u.id, action: "UPDATE", table: "service_engagement", recordId: str(fd, "id"), before: { isActive: true }, after: { isActive: false } });
  }, "Service ended");
}

export async function logCommunication(fd: FormData) {
  const u = await requireUser();
  const clientId = str(fd, "clientId");
  await act(`/clients/${clientId}?tab=communication`, async () => {
    requirePermission(u, "clients", "edit");
    await getClientForActor(u, clientId);
    if (!str(fd, "subject")) throw new ValidationError("Subject is required.");
    await prisma.communication.create({ data: { clientId, channel: str(fd, "channel") as CommChannel, direction: str(fd, "direction") as CommDirection, subject: str(fd, "subject"), summary: str(fd, "summary") || null, participants: str(fd, "participants").split(",").map((s) => s.trim()).filter(Boolean), occurredAt: new Date(`${str(fd, "date")}T${str(fd, "time") || "09:00"}:00+04:00`), obligationId: str(fd, "obligationId") || null, loggedById: u.id } });
  }, "Interaction logged");
}

export async function addTask(fd: FormData) {
  const u = await requireUser();
  const clientId = str(fd, "clientId");
  await act(`/clients/${clientId}?tab=tasks`, async () => {
    requirePermission(u, "clients", "edit");
    await getClientForActor(u, clientId);
    if (!str(fd, "title")) throw new ValidationError("Task title is required.");
    await prisma.task.create({ data: { clientId, title: str(fd, "title"), description: str(fd, "description") || null, assigneeId: str(fd, "assigneeId") || u.id, dueDate: str(fd, "dueDate") ? toDbDate(str(fd, "dueDate")) : null, priority: (str(fd, "priority") || "NORMAL") as "NORMAL", obligationId: str(fd, "obligationId") || null } });
  }, "Task added");
}

export async function setTaskStatus(fd: FormData) {
  const u = await requireUser();
  const back = str(fd, "back");
  await act(back, async () => {
    const t = await prisma.task.findUniqueOrThrow({ where: { id: str(fd, "id") } });
    if (t.assigneeId !== u.id) requirePermission(u, "clients", "edit");
    if (t.clientId) await getClientForActor(u, t.clientId);
    await prisma.task.update({ where: { id: t.id }, data: { status: str(fd, "status") as "DONE" } });
  }, "Task updated");
}

export async function saveNotes(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/clients/${id}?tab=notes`, async () => {
    requirePermission(u, "clients", "edit");
    const before = await getClientForActor(u, id);
    const c = await prisma.client.update({ where: { id }, data: { notes: str(fd, "notes") || null } });
    await audit(prisma, { userId: u.id, action: "UPDATE", table: "client", recordId: id, before: { notes: before.notes }, after: { notes: c.notes } });
  }, "Notes saved");
}

export async function setStopWork(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/clients/${id}`, async () => {
    requirePermission(u, "collections", "edit");
    const before = await getClientForActor(u, id);
    const on = str(fd, "on") === "1";
    if (on && !str(fd, "reason")) throw new ValidationError("A reason is required.");
    const c = await prisma.client.update({ where: { id }, data: { stopWork: on, stopWorkReason: on ? str(fd, "reason") : null } });
    await audit(prisma, { userId: u.id, action: "UPDATE", table: "client", recordId: id, before, after: c });
  }, "Stop-work flag updated");
}

export async function reassign(fd: FormData) {
  const u = await requireUser();
  const ids = fd.getAll("ids").map(String);
  const back = str(fd, "back") || "/clients";
  await act(back, async () => {
    if (!ids.length) throw new ValidationError("Select at least one client.");
    if (!str(fd, "fromUserId") || !str(fd, "toUserId")) throw new ValidationError("Choose who to reassign from and to.");
    const r = await bulkReassign(u, str(fd, "fromUserId"), str(fd, "toUserId"), str(fd, "role") as "manager", ids, await clientIp());
    if (r.engagements === 0) throw new ValidationError("None of the selected clients had that person in that role.");
  }, "Clients reassigned");
}
