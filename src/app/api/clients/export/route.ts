import { NextResponse } from "next/server";
import { ClientStatus, FilingFrequency, ServiceLine } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientFilterWhere } from "@/lib/services/clients";
import { exportClientsXlsx } from "@/lib/services/import";
import { isForbidden } from "@/lib/permissions";

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const g = (k: string) => p.get(k) || undefined;
  try {
    const where = clientFilterWhere(u, { q: g("q"), status: g("status") as ClientStatus, serviceLine: g("serviceLine") as ServiceLine, managerId: g("managerId"), emirate: g("emirate"), vatFrequency: g("vatFrequency") as FilingFrequency, fyEndMonth: g("fyEndMonth") ? Number(g("fyEndMonth")) : undefined });
    const rows = await prisma.client.findMany({ where, include: { taxProfile: { select: { vatTrn: true, vatFrequency: true } }, engagements: { where: { isActive: true }, select: { serviceLine: true, manager: { select: { name: true } } } } }, orderBy: { legalName: "asc" }, take: 20000 });
    const buf = await exportClientsXlsx(rows);
    await prisma.auditLog.create({ data: { userId: u.id, action: "VIEW_SENSITIVE", tableName: "client", recordId: "export", newValue: `exported ${rows.length} clients` } });
    return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="clients-${new Date().toISOString().slice(0, 10)}.xlsx"` } });
  } catch (e) {
    if (isForbidden(e)) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
