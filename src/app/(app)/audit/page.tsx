import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { formatDateTime, toDbDate } from "@/lib/dates";
import { PageHead, Pager } from "@/components/ui";
import { SP, one, qs } from "@/lib/web";

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  requirePermission(u, "audit");
  const sp = await searchParams;
  const p = { userId: one(sp.userId), table: one(sp.table), recordId: one(sp.recordId), from: one(sp.from), to: one(sp.to) };
  const page = Number(one(sp.page) ?? 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(p.userId ? { userId: p.userId } : {}),
    ...(p.table ? { tableName: p.table } : {}),
    ...(p.recordId ? { recordId: p.recordId } : {}),
    ...(p.from || p.to ? { at: { ...(p.from ? { gte: toDbDate(p.from) } : {}), ...(p.to ? { lt: new Date(toDbDate(p.to).getTime() + 86_400_000) } : {}) } } : {}),
  };
  const [total, rows, users] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * 100, take: 100 }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const names = new Map(users.map((x) => [x.id, x.name]));
  return (
    <>
      <PageHead title="Audit trail" sub="Append-only. The database rejects any update or delete of these rows.">
        <a className="btn" href={`/api/audit/export${qs(p, {})}`}>Export CSV</a>
      </PageHead>
      <form method="get" className="card mb-3 flex flex-wrap items-end gap-2 p-3">
        <label><span className="lbl">User</span><select className="sel" name="userId" defaultValue={p.userId ?? ""}><option value="">Anyone</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label><span className="lbl">Table</span><select className="sel" name="table" defaultValue={p.table ?? ""}><option value="">Any</option>{["client", "obligation", "contact", "service_engagement", "lead", "deadline_rule", "holiday", "user", "app_setting", "import"].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label><span className="lbl">Record id</span><input className="inp" name="recordId" defaultValue={p.recordId} /></label>
        <label><span className="lbl">From</span><input className="inp" type="date" name="from" defaultValue={p.from} /></label>
        <label><span className="lbl">To</span><input className="inp" type="date" name="to" defaultValue={p.to} /></label>
        <button className="btn btn-primary">Filter</button>
      </form>
      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Table</th><th>Record</th><th>Field</th><th>Old</th><th>New</th><th>IP</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)}><td className="whitespace-nowrap">{formatDateTime(r.at)}</td><td>{r.userId ? names.get(r.userId) : "System"}</td><td>{r.action.toLowerCase()}</td><td>{r.tableName}</td><td className="font-mono text-[11px]">{r.recordId.slice(0, 12)}</td><td>{r.field ?? "—"}</td><td className="max-w-[180px] truncate text-muted" title={r.oldValue ?? ""}>{r.oldValue ?? "—"}</td><td className="max-w-[180px] truncate" title={r.newValue ?? ""}>{r.newValue ?? "—"}</td><td>{r.ip ?? "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager total={total} page={page} pageSize={100} href={(n) => `/audit${qs(p, { page: String(n) })}`} />
      </section>
    </>
  );
}
