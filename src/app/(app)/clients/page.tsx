import Link from "next/link";
import { ClientStatus, FilingFrequency, ServiceLine } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { access } from "@/lib/permissions";
import { listClients, ClientFilters } from "@/lib/services/clients";
import { Flash, PageHead, Pager, SERVICE_LABEL } from "@/components/ui";
import { SelectAll } from "@/components/client";
import { SP, one, qs } from "@/lib/web";
import { reassign } from "./actions";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default async function Clients({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  const sp = await searchParams;
  const p = { q: one(sp.q), status: one(sp.status), serviceLine: one(sp.serviceLine), managerId: one(sp.managerId), emirate: one(sp.emirate), vatFrequency: one(sp.vatFrequency), fyEndMonth: one(sp.fyEndMonth), sort: one(sp.sort) };
  const f: ClientFilters = { q: p.q, status: p.status as ClientStatus, serviceLine: p.serviceLine as ServiceLine, managerId: p.managerId, emirate: p.emirate, vatFrequency: p.vatFrequency as FilingFrequency, fyEndMonth: p.fyEndMonth ? Number(p.fyEndMonth) : undefined };
  const page = Number(one(sp.page) ?? 1);
  const r = await listClients(u, f, page, 50, (p.sort as "legalName") ?? "legalName");
  const staff = await prisma.user.findMany({ where: { isActive: true, role: { key: { notIn: ["BUSINESS_DEVELOPMENT", "READ_ONLY"] } } }, select: { id: true, name: true, role: { select: { key: true } } }, orderBy: { name: "asc" } });
  const canEdit = access(u, "clients").edit;
  const here = `/clients${qs(p, { page: one(sp.page) })}`;
  return (
    <>
      <PageHead title="Clients" sub={`${r.total.toLocaleString()} client(s) in view`}>
        <a className="btn" href={`/api/clients/export${qs(p, {})}`}>Export view to Excel</a>
        {canEdit && <Link className="btn" href="/clients/import">Import</Link>}
        {canEdit && <Link className="btn btn-primary" href="/clients/new">New client</Link>}
      </PageHead>
      <Flash sp={sp} />
      <form className="card mb-3 grid grid-cols-2 gap-2 p-3 md:grid-cols-4 xl:grid-cols-8" method="get">
        <label className="col-span-2"><span className="lbl">Search name, code, TRN, CT no., licence, contact email or mobile</span><input className="inp w-full" name="q" defaultValue={p.q} /></label>
        <label><span className="lbl">Service line</span><select className="sel w-full" name="serviceLine" defaultValue={p.serviceLine ?? ""}><option value="">All</option>{Object.values(ServiceLine).map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}</select></label>
        <label><span className="lbl">Status</span><select className="sel w-full" name="status" defaultValue={p.status ?? ""}><option value="">Active, prospect, on hold</option>{Object.values(ClientStatus).map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase().replace("_", " ")}</option>)}</select></label>
        <label><span className="lbl">Manager</span><select className="sel w-full" name="managerId" defaultValue={p.managerId ?? ""}><option value="">Any</option>{staff.filter((s) => ["MANAGER", "PARTNER", "MANAGING_PARTNER"].includes(s.role.key)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label><span className="lbl">Emirate</span><select className="sel w-full" name="emirate" defaultValue={p.emirate ?? ""}><option value="">Any</option>{["Abu Dhabi","Dubai","Sharjah","Ajman","Umm Al Quwain","Ras Al Khaimah","Fujairah"].map((e) => <option key={e}>{e}</option>)}</select></label>
        <label><span className="lbl">VAT frequency</span><select className="sel w-full" name="vatFrequency" defaultValue={p.vatFrequency ?? ""}><option value="">Any</option>{Object.values(FilingFrequency).map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}</select></label>
        <label><span className="lbl">Year-end month</span><select className="sel w-full" name="fyEndMonth" defaultValue={p.fyEndMonth ?? ""}><option value="">Any</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <div className="flex items-end gap-2"><button className="btn btn-primary">Apply</button><Link className="btn" href="/clients">Reset</Link></div>
      </form>

      <form action={reassign} className="card overflow-hidden">
        <input type="hidden" name="back" value={here} />
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-2">
            <span className="font-semibold">Bulk reassign selected:</span>
            <select className="sel" name="role" defaultValue="manager"><option value="manager">Manager</option><option value="preparer">Preparer</option><option value="partner">Partner</option></select>
            <span>from</span>
            <select className="sel" name="fromUserId" defaultValue=""><option value="">(person)</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <span>to</span>
            <select className="sel" name="toUserId" defaultValue=""><option value="">(person)</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <button className="btn">Reassign</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr>{canEdit && <th className="w-6"><SelectAll name="ids" /></th>}<th><Link href={`/clients${qs(p, { sort: "clientCode" })}`}>Code</Link></th><th><Link href={`/clients${qs(p, { sort: "legalName" })}`}>Legal name</Link></th><th>Emirate</th><th>Year-end</th><th>VAT</th><th>VAT TRN</th><th>Services</th><th>Manager</th><th>Status</th></tr></thead>
            <tbody>
              {r.rows.map((c) => (
                <tr key={c.id}>
                  {canEdit && <td><input type="checkbox" name="ids" value={c.id} aria-label={`Select ${c.legalName}`} /></td>}
                  <td className="font-mono text-[12px]">{c.clientCode}</td>
                  <td className="max-w-[280px] truncate"><Link href={`/clients/${c.id}`}>{c.legalName}</Link>{c.stopWork && <span className="chip t-red ml-1">STOP WORK</span>}</td>
                  <td>{c.emirate ?? "—"}</td>
                  <td>{c.fyEndMonth ? `${c.fyEndDay} ${MONTHS[c.fyEndMonth - 1]}` : <span className="chip t-amber">Missing</span>}</td>
                  <td>{c.taxProfile?.vatFrequency === "NOT_REGISTERED" ? "—" : c.taxProfile?.vatFrequency.toLowerCase()}</td>
                  <td className="font-mono text-[12px]">{c.taxProfile?.vatTrn ?? "—"}</td>
                  <td className="max-w-[220px] truncate">{[...new Set(c.engagements.map((e) => SERVICE_LABEL[e.serviceLine]))].join(", ") || "—"}</td>
                  <td>{[...new Set(c.engagements.map((e) => e.manager?.name).filter(Boolean))].join(", ") || "—"}</td>
                  <td>{c.status.toLowerCase().replace("_", " ")}</td>
                </tr>
              ))}
              {r.rows.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-muted">No clients match.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager total={r.total} page={r.page} pageSize={r.pageSize} href={(n) => `/clients${qs(p, { page: String(n) })}`} />
      </form>
    </>
  );
}
