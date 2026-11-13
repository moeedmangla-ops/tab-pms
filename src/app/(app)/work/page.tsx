import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { access } from "@/lib/permissions";
import { CLOSED, FILED, STATUS_LABEL, tone } from "@/lib/engine/workflow";
import { addDays, formatDate, fromDbDate, toDbDate, todayDubai } from "@/lib/dates";
import { PageHead, TYPE_LABEL, LEAD_STAGE_LABEL } from "@/components/ui";

type Item = { date: string; kind: string; title: string; sub: string; href: string; t: string };

/** One ordered list: my obligations, tasks and leads that need attention. The first screen each morning. */
export default async function MyWork() {
  const u = await requireUser();
  const today = todayDubai();
  const horizon = toDbDate(addDays(today, 21));
  const items: Item[] = [];
  if (access(u, "obligations").scope !== "none") {
    const obs = await prisma.obligation.findMany({
      where: { deletedAt: null, status: { notIn: [...FILED, ...CLOSED] }, OR: [{ preparerId: u.id }, { reviewerId: u.id }], statutoryDueDate: { lte: horizon } },
      include: { client: { select: { legalName: true } } },
    });
    for (const o of obs) {
      const role = o.reviewerId === u.id && o.status === "PENDING_INTERNAL_REVIEW" ? "Review" : o.preparerId === u.id ? "Prepare" : "Review";
      const key = role === "Prepare" ? fromDbDate(o.prepDeadline) : fromDbDate(o.reviewDeadline);
      items.push({ date: key < fromDbDate(o.statutoryDueDate) ? key : fromDbDate(o.statutoryDueDate), kind: role, title: `${o.client.legalName} — ${TYPE_LABEL[o.type]}`, sub: `${STATUS_LABEL[o.status]} · statutory ${formatDate(o.statutoryDueDate)} · your deadline ${formatDate(key)}`, href: `/obligations/${o.id}`, t: tone(o, today) });
    }
  }
  const tasks = await prisma.task.findMany({ where: { assigneeId: u.id, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } }, include: { client: { select: { id: true, legalName: true } } } });
  for (const t of tasks) items.push({ date: t.dueDate ? fromDbDate(t.dueDate) : "9999-12-31", kind: "Task", title: t.title, sub: `${t.client?.legalName ?? ""} · ${t.priority.toLowerCase()} · due ${formatDate(t.dueDate)}`, href: t.client ? `/clients/${t.client.id}?tab=tasks` : "/work", t: t.dueDate && fromDbDate(t.dueDate) < today ? "red" : "blue" });
  if (access(u, "leads").scope !== "none") {
    const leads = await prisma.lead.findMany({ where: { ownerId: u.id, deletedAt: null, stage: { notIn: ["WON", "LOST"] }, nextActionDate: { lte: toDbDate(addDays(today, 3)) } } });
    for (const l of leads) items.push({ date: fromDbDate(l.nextActionDate), kind: "Lead", title: l.company ?? l.name, sub: `${LEAD_STAGE_LABEL[l.stage]} · ${l.nextAction ?? "next action"} · ${formatDate(l.nextActionDate)}`, href: `/leads/${l.id}`, t: fromDbDate(l.nextActionDate) < today ? "red" : "amber" });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <PageHead title="My work" sub={`Your obligations, tasks and leads in date order · ${formatDate(today)}`} />
      <section className="card">
        <ol className="divide-y divide-[var(--line)]">
          {items.map((i, n) => (
            <li key={n} className={`flex items-center gap-3 px-4 py-2 bar-${i.t}`}>
              <span className="w-24 shrink-0 tabular-nums text-muted">{i.date === "9999-12-31" ? "No date" : formatDate(i.date)}</span>
              <span className={`chip t-${i.t} w-16 text-center`}>{i.kind}</span>
              <div className="min-w-0"><Link href={i.href} className="font-medium text-brand-accent hover:underline">{i.title}</Link><div className="truncate text-[12px] text-muted">{i.sub}</div></div>
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-10 text-center text-muted">Nothing waiting on you in the next three weeks.</li>}
        </ol>
      </section>
    </>
  );
}
