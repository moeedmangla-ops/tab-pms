"use server";
import { redirect } from "next/navigation";
import { LeadStage, ServiceLine } from "@prisma/client";
import { requireUser, clientIp } from "@/lib/auth";
import { act, errorMessage, str } from "@/lib/web";
import { changeLeadStage, convertLead, createLead, logLeadContact, updateLead } from "@/lib/services/leads";

function formToLead(fd: FormData) {
  return {
    name: str(fd, "name"), company: str(fd, "company"), email: str(fd, "email"), mobile: str(fd, "mobile"), country: str(fd, "country"),
    source: str(fd, "source"), serviceInterest: fd.getAll("serviceInterest").map(String) as ServiceLine[],
    estimatedAnnualFee: str(fd, "estimatedAnnualFee") ? Number(str(fd, "estimatedAnnualFee")) : null,
    ownerId: str(fd, "ownerId"), nextActionDate: str(fd, "nextActionDate"), nextAction: str(fd, "nextAction"), notes: str(fd, "notes"),
  };
}

export async function create(fd: FormData) {
  const u = await requireUser();
  let id = "";
  let err = "";
  try { id = (await createLead(u, formToLead(fd), await clientIp())).id; } catch (e) { err = errorMessage(e); }
  if (err) redirect(`/leads/new?error=${encodeURIComponent(err)}`);
  redirect(`/leads/${id}?ok=Lead%20created`);
}

export async function update(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/leads/${id}`, async () => updateLead(u, id, formToLead(fd), await clientIp()), "Lead saved");
}

export async function stage(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/leads/${id}`, async () => changeLeadStage(u, id, str(fd, "stage") as LeadStage, str(fd, "lostReason"), await clientIp()), "Stage updated");
}

export async function contact(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await act(`/leads/${id}`, async () => logLeadContact(u, id, { channel: str(fd, "channel") as "PHONE", subject: str(fd, "subject"), summary: str(fd, "summary"), nextActionDate: str(fd, "nextActionDate"), nextAction: str(fd, "nextAction") }), "Contact logged");
}

export async function convert(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  const lines = fd.getAll("serviceLine").map(String);
  const fees = fd.getAll("fee").map(String);
  const freqs = fd.getAll("billingFrequency").map(String);
  const engagements = lines.map((s, i) => ({ serviceLine: s, fee: fees[i], billingFrequency: freqs[i], managerId: str(fd, "managerId"), preparerId: str(fd, "preparerId"), partnerId: str(fd, "partnerId") })).filter((e) => e.serviceLine && e.fee);
  let cid = "";
  let err = "";
  try { cid = (await convertLead(u, id, { clientCode: str(fd, "clientCode"), legalName: str(fd, "legalName"), engagements }, await clientIp())).id; } catch (e) { err = errorMessage(e); }
  if (err) redirect(`/leads/${id}?error=${encodeURIComponent(err)}`);
  redirect(`/clients/${cid}/edit?ok=${encodeURIComponent("Lead converted. Complete the year-end, VAT and licence details so deadlines generate.")}`);
}
