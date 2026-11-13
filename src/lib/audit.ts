import { Prisma } from "@prisma/client";
import { prisma } from "./db";

type Tx = Prisma.TransactionClient | typeof prisma;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Append-only audit trail: one row per changed field. */
export async function audit(
  tx: Tx,
  a: { userId?: string | null; ip?: string | null; action: "CREATE" | "UPDATE" | "DELETE" | "VIEW_SENSITIVE"; table: string; recordId: string; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null },
) {
  const rows: Prisma.AuditLogCreateManyInput[] = [];
  if (a.action === "UPDATE" && a.before && a.after) {
    for (const k of Object.keys(a.after)) {
      if (k === "updatedAt" || k === "searchText") continue;
      const o = str(a.before[k]);
      const n = str(a.after[k]);
      if (o !== n) rows.push({ userId: a.userId, ip: a.ip, action: "UPDATE", tableName: a.table, recordId: a.recordId, field: k, oldValue: o, newValue: n });
    }
  } else {
    rows.push({ userId: a.userId, ip: a.ip, action: a.action, tableName: a.table, recordId: a.recordId, newValue: a.after ? str(a.after) : null });
  }
  if (rows.length) await tx.auditLog.createMany({ data: rows });
}
