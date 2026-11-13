import Link from "next/link";
import { LeadStage, Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { access, leadWhere } from "@/lib/permissions";
import { STAGE_ORDER, STAGE_WEIGHT } from "@/lib/services/leads";
import { formatDate, toDbDate, todayDubai } from "@/lib/dates";
import { Flash, LEAD_STAGE_LABEL, PageHead, SERVICE_LABEL, SOURCE_LABEL, aed } from "@/components/ui";
import { SP, one, qs } from "@/lib/web";

export default async function Leads({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  const sp = await searchParams;
  const today = todayDubai();
  const p = { attention: one(sp.attention), stage: one(sp.stage), source: one(sp.source), ownerId: one(sp.ownerId), q: one(sp.q) };
  const and: Prisma.LeadWhereInput[] = [leadWhere(u), { deletedAt: null }];
  if (p.attention) and.push({ stage: { notIn: ["WON", "LOST"] }, nextActionDate: { lt: toDbDate(today) } });
  if (p.stage) and.push({ stage: p.stage as LeadStage });
  else if (!p.attention) and.push({ stage: { notIn: ["WON", "LOST"] } });
  if (p.source) and.push({ source: p.source as "REFERRAL" });
  if (p.ownerId) and.push({ ownerId: p.ownerId });
  if (p.q) and.push({ OR: [{ name: { contains: p.q, mode: "insensitive" } }, { company: { contains: p.q, mode: "insensitive" } }, { email: { contains: p.q, mode: "insensitive" } }] });
  const where = { AND: and };
  const [rows, all, bySource] = await Promise.all([
    prisma.lead.findMany({ where, include: { owner: { select: { name: true } } }, orderBy: { nextActionDate: "asc" }, take: 200 }),
    prisma.lead.findMany({ where: { AND: [leadWhere(u), { deletedAt: null }] }, select: { stage: true, estimatedAnnualFee: true, source: true, createdAt: true, firstContactAt: true, ownerId: true } }),
    Promise.resolve(null),
  ]);
  void bySource;
  const pipeline = STAGE_ORDER.map((s) => {
    const items = all.filter((l) => l.stage === s);
    const value = items.reduce((a, l) => a + Number(l.estimatedAnnualFee ?? 0), 0);
    return { s, n: items.length, value, weighted: value * STAGE_WEIGHT[s] };
  });
  const sources = [...new Set(all.map((l) => l.source))].map((src) => {
    const items = all.filter((l) => l.source === src);
    const won = items.filter((l) => l.stage === "WON");
    const closed = items.filter((l) => l.stage === "WON" || l.stage === "LOST");
    const contacted = items.filter((l) => l.firstContactAt);
    const hrs = contacted.length ? contacted.reduce((a, l) => a + (l.firstContactAt!.getTime() - l.createdAt.getTime()) / 3_600_000, 0) / contacted.length : null;
    return { src, n: items.length, conv: closed.length ? won.length / closed.length : null, avgFee: won.length ? won.reduce((a, l) => a + Number(l.estimatedAnnualFee ?? 0), 0) / won.length : null, hrs };
  });
  const owners = await prisma.user.findMany({ where: { ownedLeads: { some: {} } }, select: { id: true, name: true } });
  const canEdit = access(u, "leads").edit;
  return (
    <>
      <PageHead title="Leads" sub="Every enquiry has an owner and a next-action date.">
        <Link className={`btn ${p.attention ? "btn-primary" : ""}`} href="/leads?attention=1">Needs attention</Link>
        {canEdit && <Link className="btn btn-primary" href="/leads/new">New lead</Link>}
      </PageHead>
      <Flash sp={sp} />
      <section className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-7">
        {pipeline.map((x) => (
          <Link key={x.s} href={`/leads?stage=${x.s}`} className={`card p-3 hover:border-brand ${p.stage === x.s ? "border-brand" : ""}`}>
            <div className="lbl">{LEAD_STAGE_LABEL[x.s]}</div>
            <div className="text-xl font-semibold tabular-nums">{x.n}</div>
            <div className="text-[11.5px] text-muted">{aed(x.value)} · weighted {aed(x.weighted)}</div>
          </Link>
        ))}
      </section>
      <form method="get" className="card mb-3 flex flex-wrap items-end gap-2 p-3">
        <label><span className="lbl">Search</span><input className="inp" name="q" defaultValue={p.q} /></label>
        <label><span className="lbl">Source</span><select className="sel" name="source" defaultValue={p.source ?? ""}><option value="">Any</option>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span className="lbl">Owner</span><select className="sel" name="ownerId" defaultValue={p.ownerId ?? ""}><option value="">Any</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label><span className="lbl">Stage</span><select className="sel" name="stage" defaultValue={p.stage ?? ""}><option value="">Open stages</option>{STAGE_ORDER.map((s) => <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>)}</select></label>
        <button className="btn btn-primary">Apply</button><Link className="btn" href="/leads">Reset</Link>
      </form>
      <section className="card mb-4 overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Lead</th><th>Company</th><th>Source</th><th>Interest</th><th>Est. fee</th><th>Stage</th><th>Owner</th><th>Next action</th></tr></thead>
          <tbody>
            {rows.map((l) => {
              const late = !["WON", "LOST"].includes(l.stage) && l.nextActionDate.toISOString().slice(0, 10) < today;
              return (
                <tr key={l.id} className={late ? "bar-red" : ""}>
                  <td><Link href={`/leads/${l.id}`}>{l.name}</Link></td><td>{l.company ?? "—"}</td><td>{SOURCE_LABEL[l.source]}</td>
                  <td className="max-w-[200px] truncate">{l.serviceInterest.map((s) => SERVICE_LABEL[s]).join(", ") || "—"}</td>
                  <td className="tabular-nums">{aed(l.estimatedAnnualFee)}</td><td>{LEAD_STAGE_LABEL[l.stage]}</td><td>{l.owner.name}</td>
                  <td className="whitespace-nowrap">{late ? <span className="chip t-red">{formatDate(l.nextActionDate)}</span> : formatDate(l.nextActionDate)} {l.nextAction && <span className="text-muted">· {l.nextAction}</span>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted">No leads match.</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="h2 border-b border-line px-3 py-2">Source report — conversion, average fee, response time</h2>
        <table className="tbl">
          <thead><tr><th>Source</th><th>Leads</th><th>Conversion (won / closed)</th><th>Average won fee</th><th>Avg. time to first contact</th></tr></thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.src}><td><Link href={`/leads${qs({}, { source: s.src, stage: "" })}`}>{SOURCE_LABEL[s.src]}</Link></td><td>{s.n}</td><td>{s.conv === null ? "—" : `${Math.round(s.conv * 100)}%`}</td><td>{s.avgFee === null ? "—" : aed(s.avgFee)}</td><td>{s.hrs === null ? "—" : s.hrs < 48 ? `${s.hrs.toFixed(1)} h` : `${(s.hrs / 24).toFixed(1)} days`}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
