/**
 * Client import from Excel (.xlsx) or CSV (BUILD_SPEC Section 6).
 * 1. parse → headers + rows   2. map columns   3. dry run (per-row errors,
 * duplicates on VAT TRN and licence number, in-file and against the database)
 * 4. commit valid rows in batches, then generate obligations.
 */
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { Actor, requirePermission } from "../permissions";
import { ClientInput, searchTextFor } from "./clients";
import { generateObligations } from "../engine/generate";

export const IMPORT_FIELDS = [
  { key: "clientCode", label: "Client code", required: true },
  { key: "legalName", label: "Legal name", required: true },
  { key: "tradeName", label: "Trade name" },
  { key: "entityType", label: "Entity type" },
  { key: "licenceNumber", label: "Licence number" },
  { key: "licenceAuthority", label: "Licence authority" },
  { key: "licenceExpiry", label: "Licence expiry (YYYY-MM-DD)" },
  { key: "emirate", label: "Emirate" },
  { key: "industry", label: "Industry" },
  { key: "fyEnd", label: "Financial year-end (DD/MM or YYYY-MM-DD)" },
  { key: "vatTrn", label: "VAT TRN" },
  { key: "vatFrequency", label: "VAT frequency (Monthly/Quarterly/Annual)" },
  { key: "vatPeriodAnchor", label: "VAT period start (YYYY-MM-DD)" },
  { key: "ctRegistrationNo", label: "CT registration number" },
  { key: "contactName", label: "Primary contact name" },
  { key: "contactEmail", label: "Primary contact email" },
  { key: "contactMobile", label: "Primary contact mobile" },
] as const;
export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type Mapping = Partial<Record<ImportFieldKey, string>>; // field → source header

export type Parsed = { headers: string[]; rows: Record<string, string>[] };

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("text" in v && v.text) return String(v.text);
    if ("result" in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("hyperlink" in v) return String((v as { text?: string }).text ?? v.hyperlink);
  }
  return String(v).trim();
}

export function parseCsv(text: string): Parsed {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) out.push(row);
  const headers = (out.shift() ?? []).map((h) => h.trim());
  return { headers, rows: out.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}

export async function parseFile(name: string, buf: Buffer): Promise<Parsed> {
  if (name.toLowerCase().endsWith(".csv")) return parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => (headers[col - 1] = cellText(c.value)));
  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rec: Record<string, string> = {};
    let any = false;
    headers.forEach((h, i) => {
      const t = cellText(row.getCell(i + 1).value);
      if (t) any = true;
      rec[h] = t;
    });
    if (any) rows.push(rec);
  }
  return { headers, rows };
}

/** Guess a mapping from header names. */
export function autoMap(headers: string[]): Mapping {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const m: Mapping = {};
  for (const f of IMPORT_FIELDS) {
    const target = norm(f.label.split("(")[0]);
    const h = headers.find((x) => norm(x) === target || norm(x) === norm(f.key));
    if (h) m[f.key] = h;
  }
  return m;
}

function parseFyEnd(s: string): { m: number; d: number } | null {
  if (!s) return null;
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (r) return { m: +r[2], d: +r[3] };
  r = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (r) return { d: +r[1], m: +r[2] };
  r = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})/);
  if (r) {
    const m = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(r[2].slice(0, 3).toLowerCase()) + 1;
    if (m) return { d: +r[1], m };
  }
  return null;
}

function normDate(s: string): string {
  if (!s) return "";
  const r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/YYYY (UAE convention)
  if (r) return `${r[3]}-${r[2].padStart(2, "0")}-${r[1].padStart(2, "0")}`;
  return s;
}

const ENTITY: Record<string, string> = { llc: "LLC", fzco: "FREE_ZONE_COMPANY", fzc: "FREE_ZONE_COMPANY", fze: "FREE_ZONE_ESTABLISHMENT", "sole establishment": "SOLE_ESTABLISHMENT", branch: "BRANCH" };

export type RowResult = { row: number; ok: boolean; errors: string[]; duplicate?: string; data?: ReturnType<typeof ClientInput.parse> & { contact?: { name: string; email: string | null; mobile: string | null } } };

export async function dryRun(parsed: Parsed, mapping: Mapping): Promise<{ results: RowResult[]; valid: number; invalid: number; duplicates: number }> {
  const get = (r: Record<string, string>, k: ImportFieldKey) => (mapping[k] ? (r[mapping[k]!] ?? "").trim() : "");
  const results: RowResult[] = [];
  const seenTrn = new Map<string, number>();
  const seenLic = new Map<string, number>();
  const seenCode = new Map<string, number>();

  const trns = parsed.rows.map((r) => get(r, "vatTrn").replace(/\D/g, "")).filter(Boolean);
  const lics = parsed.rows.map((r) => get(r, "licenceNumber")).filter(Boolean);
  const codes = parsed.rows.map((r) => get(r, "clientCode")).filter(Boolean);
  const [dbTrn, dbLic, dbCode] = await Promise.all([
    prisma.clientTaxProfile.findMany({ where: { vatTrn: { in: trns } }, select: { vatTrn: true } }),
    prisma.client.findMany({ where: { licenceNumber: { in: lics }, deletedAt: null }, select: { licenceNumber: true } }),
    prisma.client.findMany({ where: { clientCode: { in: codes } }, select: { clientCode: true } }),
  ]);
  const dbTrnSet = new Set(dbTrn.map((x) => x.vatTrn));
  const dbLicSet = new Set(dbLic.map((x) => x.licenceNumber));
  const dbCodeSet = new Set(dbCode.map((x) => x.clientCode));

  parsed.rows.forEach((r, i) => {
    const rowNo = i + 2; // spreadsheet row number (header is row 1)
    const errors: string[] = [];
    const fy = parseFyEnd(get(r, "fyEnd"));
    if (get(r, "fyEnd") && !fy) errors.push(`Financial year-end "${get(r, "fyEnd")}" not understood`);
    const freqRaw = get(r, "vatFrequency").toUpperCase();
    const vatFrequency = freqRaw ? (["MONTHLY", "QUARTERLY", "ANNUAL"].includes(freqRaw) ? freqRaw : null) : "NOT_REGISTERED";
    if (vatFrequency === null) errors.push(`VAT frequency "${get(r, "vatFrequency")}" must be Monthly, Quarterly or Annual`);
    const trn = get(r, "vatTrn").replace(/\D/g, "");
    const parsedRow = ClientInput.safeParse({
      clientCode: get(r, "clientCode"),
      legalName: get(r, "legalName"),
      tradeName: get(r, "tradeName"),
      entityType: ENTITY[get(r, "entityType").toLowerCase()] ?? (get(r, "entityType") ? "OTHER" : "LLC"),
      licenceNumber: get(r, "licenceNumber"),
      licenceAuthority: get(r, "licenceAuthority"),
      licenceExpiry: normDate(get(r, "licenceExpiry")),
      emirate: get(r, "emirate"),
      industry: get(r, "industry"),
      fyEndMonth: fy?.m ?? null,
      fyEndDay: fy?.d ?? null,
      vatTrn: trn,
      vatFrequency: vatFrequency ?? "NOT_REGISTERED",
      vatPeriodAnchor: normDate(get(r, "vatPeriodAnchor")),
      ctRegistrationNo: get(r, "ctRegistrationNo"),
      ctRegistered: Boolean(get(r, "ctRegistrationNo")),
    });
    if (!parsedRow.success) errors.push(...parsedRow.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`));
    const email = get(r, "contactEmail");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`Contact email "${email}" is invalid`);

    let duplicate: string | undefined;
    const code = get(r, "clientCode");
    const lic = get(r, "licenceNumber");
    if (trn && seenTrn.has(trn)) duplicate = `VAT TRN duplicates row ${seenTrn.get(trn)}`;
    else if (trn && dbTrnSet.has(trn)) duplicate = "VAT TRN already exists in the system";
    else if (lic && seenLic.has(lic)) duplicate = `Licence number duplicates row ${seenLic.get(lic)}`;
    else if (lic && dbLicSet.has(lic)) duplicate = "Licence number already exists in the system";
    else if (code && seenCode.has(code)) duplicate = `Client code duplicates row ${seenCode.get(code)}`;
    else if (code && dbCodeSet.has(code)) duplicate = "Client code already exists in the system";
    if (trn) seenTrn.set(trn, seenTrn.get(trn) ?? rowNo);
    if (lic) seenLic.set(lic, seenLic.get(lic) ?? rowNo);
    if (code) seenCode.set(code, seenCode.get(code) ?? rowNo);

    const ok = errors.length === 0 && !duplicate;
    results.push({
      row: rowNo,
      ok,
      errors,
      duplicate,
      data: ok && parsedRow.success ? { ...parsedRow.data, contact: get(r, "contactName") || email ? { name: get(r, "contactName") || email, email: email || null, mobile: get(r, "contactMobile") || null } : undefined } : undefined,
    });
  });
  return { results, valid: results.filter((r) => r.ok).length, invalid: results.filter((r) => r.errors.length).length, duplicates: results.filter((r) => r.duplicate && !r.errors.length).length };
}

export async function commitImport(actor: Actor, parsed: Parsed, mapping: Mapping, ip?: string | null) {
  requirePermission(actor, "clients", "edit");
  const dr = await dryRun(parsed, mapping);
  const good = dr.results.filter((r) => r.ok && r.data);
  const ids: string[] = [];
  const BATCH = 250;
  for (let i = 0; i < good.length; i += BATCH) {
    const chunk = good.slice(i, i + BATCH);
    await prisma.$transaction(async (tx) => {
      const created = await tx.client.createManyAndReturn({
        data: chunk.map(({ data: d }) => ({
          clientCode: d!.clientCode,
          legalName: d!.legalName,
          tradeName: d!.tradeName,
          entityType: d!.entityType,
          licenceNumber: d!.licenceNumber,
          licenceAuthority: d!.licenceAuthority,
          licenceExpiry: d!.licenceExpiry ? new Date(`${d!.licenceExpiry}T00:00:00Z`) : null,
          emirate: d!.emirate,
          industry: d!.industry,
          fyEndMonth: d!.fyEndMonth ?? null,
          fyEndDay: d!.fyEndDay ?? null,
          status: "ACTIVE" as const,
          searchText: searchTextFor({ ...d!, contacts: d!.contact ? [d!.contact] : [] }),
        })),
        select: { id: true, clientCode: true },
      });
      const byCode = new Map(created.map((c) => [c.clientCode, c.id]));
      await tx.clientTaxProfile.createMany({
        data: chunk.map(({ data: d }) => ({
          clientId: byCode.get(d!.clientCode)!,
          vatTrn: d!.vatTrn,
          vatFrequency: d!.vatFrequency,
          vatPeriodAnchor: d!.vatPeriodAnchor ? new Date(`${d!.vatPeriodAnchor}T00:00:00Z`) : null,
          ctRegistrationNo: d!.ctRegistrationNo,
          ctRegistered: d!.ctRegistered,
        })),
      });
      const contacts: Prisma.ContactCreateManyInput[] = chunk.filter((c) => c.data!.contact).map(({ data: d }) => ({ clientId: byCode.get(d!.clientCode)!, ...d!.contact!, isPrimary: true }));
      if (contacts.length) await tx.contact.createMany({ data: contacts });
      await tx.auditLog.createMany({ data: created.map((c) => ({ userId: actor.id, ip, action: "CREATE", tableName: "client", recordId: c.id, newValue: "imported" })) });
      ids.push(...created.map((c) => c.id));
    }, { timeout: 60_000 });
  }
  const gen = ids.length ? await generateObligations({ clientIds: ids }) : { created: 0 };
  await audit(prisma, { userId: actor.id, ip, action: "CREATE", table: "import", recordId: new Date().toISOString(), after: { imported: ids.length, rejected: dr.results.length - ids.length } });
  return { imported: ids.length, rejected: dr.results.length - ids.length, obligationsCreated: gen.created, results: dr.results };
}

export async function exportClientsXlsx(rows: { clientCode: string; legalName: string; tradeName: string | null; emirate: string | null; status: string; fyEndMonth: number | null; fyEndDay: number | null; licenceNumber: string | null; licenceExpiry: Date | null; taxProfile: { vatTrn: string | null; vatFrequency: string } | null; engagements: { serviceLine: string; manager: { name: string } | null }[] }[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Clients");
  ws.columns = [
    { header: "Client code", key: "code", width: 14 },
    { header: "Legal name", key: "name", width: 40 },
    { header: "Trade name", key: "trade", width: 30 },
    { header: "Emirate", key: "emirate", width: 14 },
    { header: "Status", key: "status", width: 12 },
    { header: "FY end", key: "fy", width: 10 },
    { header: "Licence no.", key: "lic", width: 16 },
    { header: "Licence expiry", key: "licExp", width: 14 },
    { header: "VAT TRN", key: "trn", width: 18 },
    { header: "VAT frequency", key: "freq", width: 14 },
    { header: "Services", key: "services", width: 30 },
    { header: "Managers", key: "managers", width: 24 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows)
    ws.addRow({
      code: r.clientCode,
      name: r.legalName,
      trade: r.tradeName,
      emirate: r.emirate,
      status: r.status,
      fy: r.fyEndMonth ? `${r.fyEndDay}/${r.fyEndMonth}` : "",
      lic: r.licenceNumber,
      licExp: r.licenceExpiry?.toISOString().slice(0, 10) ?? "",
      trn: r.taxProfile?.vatTrn ?? "",
      freq: r.taxProfile?.vatFrequency ?? "",
      services: [...new Set(r.engagements.map((e) => e.serviceLine))].join(", "),
      managers: [...new Set(r.engagements.map((e) => e.manager?.name).filter(Boolean))].join(", "),
    });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
