import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { access, leadWhere, clientWhere } from "@/lib/permissions";
import { obligationExceptionCounts, listObligations } from "@/lib/services/obligations";
import { prisma } from "@/lib/db";
import { addDays, formatDate, formatDateTime, toDbDate, todayDubai } from "@/lib/dates";
import { PageHead, Stat, StatusChip, TYPE_LABEL } from "@/components/ui";
import { tone, isOverdue } from "@/lib/engine/workflow";

export default async function Dashboard() {
  const u = await requireUser();
  const today = todayDubai();
  const seeObl = access(u, "obligations").scope !== "none";
  const seeLeads = access(u, "leads").scope !== "none";
  const seeClients = access(u, "clients").scope !== "none";

  const c = seeObl ? await obligationExceptionCounts(u) : null;
  const leadBase = seeLeads ? { AND: [leadWhere(u), { deletedAt: null, stage: { notIn: ["WON", "LOST"] as ("WON" | "LOST")[] } }] } : null;
  const [leadsAttention, openLeads, missingCount, jobs, urgent] = await Promise.all([
    leadBase ? prisma.lead.count({ where: { AND: [leadBase, { nextActionDate: { lt: toDbDate(today) } }] } }) : 0,
    leadBase ? prisma.lead.count({ where: leadBase }) : 0,
    seeClients
      ? prisma.client.count({
          where: { AND: [clientWhere(u), { deletedAt: null, status: "ACTIVE" }, { OR: [{ taxProfile: { ctRegistered: true }, fyEndMonth: null }, { taxProfile: { vatFrequency: { not: "NOT_REGISTERED" }, vatPeriodAnchor: null } }, { licenceNumber: { not: null }, licenceExpiry: null }] }] },
        })
      : 0,
    prisma.jobRun.findMany({ distinct: ["jobName"], orderBy: [{ jobName: "asc" }, { startedAt: "desc" }] }),
    seeObl ? listObligations(u, { view: "firm", status: "OPEN", dueTo: addDays(today, 7) }, 1, 15) : null,
  ]);

  return (
    <>
      <PageHead title="Dashboard" sub={`${formatDate(today)} · exceptions first — every figure opens the matching list`} />

      {c && (
        <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Overdue" value={c.overdue} href="/obligations?view=firm&status=OVERDUE" tone={c.overdue ? "red" : undefined} />
          <Stat label="Due this week, no preparer" value={c.dueWeekNoPreparer} href={`/obligations?view=firm&status=OPEN&dueFrom=${c.today}&dueTo=${c.weekEnd}&unassigned=1`} tone={c.dueWeekNoPreparer ? "red" : undefined} />
          <Stat label="Unassigned (open)" value={c.unassigned} href="/obligations?view=firm&status=OPEN&unassigned=1" tone={c.unassigned ? "amber" : undefined} />
          <Stat label="Dates need review" value={c.needsReview} href="/obligations?view=firm&status=OPEN&needsReview=1" tone={c.needsReview ? "amber" : undefined} />
          <Stat label="Due in 7 days" value={c.dueWeek} href={`/obligations?view=firm&status=OPEN&dueFrom=${c.today}&dueTo=${c.weekEnd}`} />
          <Stat label="Mine, next 14 days" value={c.mine} href={`/obligations?view=mine&status=OPEN&dueTo=${addDays(today, 14)}`} />
        </section>
      )}

      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {seeLeads && <Stat label="Leads needing attention" value={leadsAttention} href="/leads?attention=1" tone={leadsAttention ? "red" : undefined} />}
        {seeLeads && <Stat label="Open leads" value={openLeads} href="/leads" />}
        {seeClients && <Stat label="Clients missing deadline data" value={missingCount} href="/reports/missing-data" tone={missingCount ? "amber" : undefined} />}
      </section>

      {urgent && (
        <section className="card mb-5 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="h2">Overdue and due within 7 days</h2>
            <Link href={`/obligations?view=firm&status=OPEN&dueTo=${addDays(today, 7)}`} className="text-brand-accent hover:underline">All {urgent.total} →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Client</th><th>Obligation</th><th>Statutory</th><th>Internal target</th><th>Preparer</th><th>Status</th></tr></thead>
              <tbody>
                {urgent.rows.map((o) => (
                  <tr key={o.id} className={`bar-${tone(o, today)}`}>
                    <td><Link href={`/clients/${o.client.id}`}>{o.client.legalName}</Link></td>
                    <td><Link href={`/obligations/${o.id}`}>{TYPE_LABEL[o.type]} · {formatDate(o.periodEnd)}</Link></td>
                    <td className="tabular-nums">{formatDate(o.statutoryDueDate)}</td>
                    <td className="tabular-nums">{formatDate(o.internalTargetDate)}</td>
                    <td>{o.preparer?.name ?? <span className="chip t-red">Unassigned</span>}</td>
                    <td><StatusChip status={o.status} tone={tone(o, today)} overdue={isOverdue(o, today)} /></td>
                  </tr>
                ))}
                {urgent.rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Nothing overdue or due this week.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {access(u, "settings").scope !== "none" && (
        <section className="card overflow-hidden">
          <div className="border-b border-line px-3 py-2"><h2 className="h2">Background jobs — last run</h2></div>
          <table className="tbl">
            <thead><tr><th>Job</th><th>Started</th><th>Status</th><th>Processed</th><th>Created / sent</th><th>Errors</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}><td>{j.jobName}</td><td>{formatDateTime(j.startedAt)}</td><td><span className={`chip ${j.status === "FAILED" ? "t-red" : j.status === "RUNNING" ? "t-blue" : "t-green"}`}>{j.status}</span></td><td>{j.itemsProcessed}</td><td>{j.itemsCreated}</td><td>{j.errorCount}</td></tr>
              ))}
              {jobs.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">No job has run yet. Start the worker: npm run worker</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
