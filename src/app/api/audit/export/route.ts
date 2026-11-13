import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { access } from "@/lib/permissions";
import { toDbDate } from "@/lib/dates";

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (access(u, "audit").scope === "none") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const p = new URL(req.url).searchParams;
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(p.get("userId") ? { userId: p.get("userId")! } : {}),
      ...(p.get("table") ? { tableName: p.get("table")! } : {}),
      ...(p.get("recordId") ? { recordId: p.get("recordId")! } : {}),
      ...(p.get("from") || p.get("to") ? { at: { ...(p.get("from") ? { gte: toDbDate(p.get("from")!) } : {}), ...(p.get("to") ? { lt: new Date(toDbDate(p.get("to")!).getTime() + 86_400_000) } : {}) } } : {}),
    },
    orderBy: { at: "desc" },
    take: 100_000,
  });
  const csv = ["at,userId,action,table,recordId,field,oldValue,newValue,ip", ...rows.map((r) => [r.at.toISOString(), r.userId, r.action, r.tableName, r.recordId, r.field, r.oldValue, r.newValue, r.ip].map(esc).join(","))].join("\n");
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
