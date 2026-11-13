import Link from "next/link";
import { ObligationStatus, ObligationType } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listObligations, obligationFilterWhere, ObligationFilters } from "@/lib/services/obligations";
import { STATUS_LABEL, STATUS_ORDER, tone, isOverdue } from "@/lib/engine/workflow";
import { addDays, addMonths, daysInMonth, dayOfWeek, formatDate, fromDbDate, parseYmd, todayDubai, toDbDate, ymd } from "@/lib/dates";
import { Flash, PageHead, Pager, StatusChip, TYPE_LABEL } from "@/components/ui";
import { AutoSubmitSelect, SelectAll } from "@/components/client";
import { SP, one, qs } from "@/lib/web";
import { bulk, inlineStatus } from "./actions";
import { access } from "@/lib/permissions";

export default async function Obligations({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  const sp = await searchParams;
  const today = todayDubai();
  const p = {
    view: one(sp.view) ?? "mine",
    status: one(sp.status) ?? "OPEN",
    type: one(sp.type),
    preparerId: one(sp.preparerId),
    reviewerId: one(sp.reviewerId),
    managerId: one(sp.managerId),
    clientId: one(sp.clientId),
    dueFrom: one(sp.dueFrom),
    dueTo: one(sp.dueTo),
    periodEndFrom: one(sp.periodEndFrom),
    periodEndTo: one(sp.periodEndTo),
    needsReview: one(sp.needsReview),
    unassigned: one(sp.unassigned),
    q: one(sp.q),
    mode: one(sp.mode) ?? "list",
    month: one(sp.month),
    year: one(sp.year),
  };
  const f: ObligationFilters = {
    view: p.view as ObligationFilters["view"],
    status: (p.status === "ALL" ? undefined : p.status) as ObligationFilters["status"],
    type: p.type as ObligationType | undefined,
    preparerId: p.preparerId,
    reviewerId: p.reviewerId,
    managerId: p.managerId,
    clientId: p.clientId,
    dueFrom: p.dueFrom,
    dueTo: p.dueTo,
    periodEndFrom: p.periodEndFrom,
    periodEndTo: p.periodEndTo,
    needsReview: p.needsReview === "1",
    unassigned: p.unassigned === "1",
    q: p.q,
  };
  const page = Number(one(sp.page) ?? 1);
  const users = await prisma.user.findMany({ where: { isActive: true, role: { key: { notIn: ["BUSINESS_DEVELOPMENT", "READ_ONLY"] } } }, select: { id: true, name: true, role: { select: { key: true } } }, orderBy: { name: "asc" } });
  const managers = users.filter((x) => ["MANAGER", "PARTNER", "MANAGING_PARTNER"].includes(x.role.key));
  const canEdit = access(u, "obligations").edit;
  const base = Object.fromEntries(Object.entries(p).filter(([k]) => k !== "page")) as Record<string, string | undefined>;
  const here = `/obligations${qs(base, {})}`;

  return (
    <>
      <PageHead title="Obligations" sub="Every deadline for every client, one list. Overdue first, then due soonest.">
        {(["list", "kanban", "calendar", "year"] as const).map((m) => (
          <Link key={m} href={`/obligations${qs(base, { mode: m })}`} className={`btn ${p.mode === m ? "btn-primary" : ""}`}>{m === "year" ? "Year grid" : m[0].toUpperCase() + m.slice(1)}</Link>
        ))}
      </PageHead>
      <Flash sp={sp} />

      <div className="mb-3 flex flex-wrap gap-1">
        {[["mine", "My work"], ["team", "My team's work"], ["firm", "Whole firm"]].map(([v, l]) => (
          <Link key={v} href={`/obligations${qs(base, { view: v })}`} className={`btn ${p.view === v ? "btn-primary" : ""}`}>{l}</Link>
        ))}
      </div>

      <form className="card mb-3 grid grid-cols-2 gap-2 p-3 md:grid-cols-4 xl:grid-cols-8" method="get">
        <input type="hidden" name="view" value={p.view} />
        <input type="hidden" name="mode" value={p.mode} />
        <label><span className="lbl">Search</span><input className="inp w-full" name="q" defaultValue={p.q} placeholder="Client or title" /></label>
        <label><span className="lbl">Type</span><select className="sel w-full" name="type" defaultValue={p.type ?? ""}><option value="">All types</option>{Object.values(ObligationType).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
        <label><span className="lbl">Status</span><select className="sel w-full" name="status" defaultValue={p.status}><option value="OPEN">All open</option><option value="OVERDUE">Overdue</option><option value="ALL">All incl. closed</option>{[...STATUS_ORDER, "ON_HOLD" as const].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label><span className="lbl">Preparer</span><select className="sel w-full" name="preparerId" defaultValue={p.preparerId ?? ""}><option value="">Anyone</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label><span className="lbl">Reviewer</span><select className="sel w-full" name="reviewerId" defaultValue={p.reviewerId ?? ""}><option value="">Anyone</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label><span className="lbl">Manager</span><select className="sel w-full" name="managerId" defaultValue={p.managerId ?? ""}><option value="">Any</option>{managers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label><span className="lbl">Due from</span><input className="inp w-full" type="date" name="dueFrom" defaultValue={p.dueFrom} /></label>
        <label><span className="lbl">Due to</span><input className="inp w-full" type="date" name="dueTo" defaultValue={p.dueTo} /></label>
        <label><span className="lbl">Period end from</span><input className="inp w-full" type="date" name="periodEndFrom" defaultValue={p.periodEndFrom} /></label>
        <label><span className="lbl">Period end to</span><input className="inp w-full" type="date" name="periodEndTo" defaultValue={p.periodEndTo} /></label>
        <label className="flex items-end gap-2"><input type="checkbox" name="unassigned" value="1" defaultChecked={p.unassigned === "1"} /> <span>Unassigned only</span></label>
        <label className="flex items-end gap-2"><input type="checkbox" name="needsReview" value="1" defaultChecked={p.needsReview === "1"} /> <span>Dates need review</span></label>
        <div className="col-span-2 flex items-end gap-2 md:col-span-4 xl:col-span-2">
          <button className="btn btn-primary">Apply</button>
          <Link className="btn" href={`/obligations?view=${p.view}&mode=${p.mode}`}>Reset</Link>
        </div>
      </form>

      <div className="mb-2 flex flex-wrap gap-3 text-[11.5px] text-muted">
        <span>* internal target moved off a weekend or holiday</span>
        <span><span className="chip t-red">Red</span> overdue</span>
        <span><span className="chip t-amber">Amber</span> due within 7 days</span>
        <span><span className="chip t-blue">Blue</span> in progress</span>
        <span><span className="chip t-green">Green</span> completed</span>
        <span><span className="chip t-grey">Grey</span> on hold</span>
      </div>

      {p.mode === "list" && <ListView u={u} f={f} page={page} today={today} base={base} here={here} users={users} canEdit={canEdit} />}
      {p.mode === "kanban" && <KanbanView u={u} f={f} today={today} />}
      {p.mode === "calendar" && <CalendarView u={u} f={f} today={today} month={p.month} base={base} />}
      {p.mode === "year" && <YearGrid u={u} f={f} today={today} year={p.year} base={base} />}
    </>
  );
}

type U = Awaited<ReturnType<typeof requireUser>>;

async function ListView({ u, f, page, today, base, here, users, canEdit }: { u: U; f: ObligationFilters; page: number; today: string; base: Record<string, string | undefined>; here: string; users: { id: string; name: string }[]; canEdit: boolean }) {
  const r = await listObligations(u, f, page, 50);
  return (
    <>
    {canEdit && r.rows.map((o) => (
      <form key={o.id} id={`st-${o.id}`} action={inlineStatus} className="hidden">
        <input type="hidden" name="id" value={o.id} />
        <input type="hidden" name="back" value={here} />
      </form>
    ))}
    <form action={bulk} className="card overflow-hidden">
      <input type="hidden" name="back" value={here} />
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-2">
          <span className="font-semibold">Bulk:</span>
          <select className="sel" name="op" defaultValue="">
            <option value="">Choose action…</option>
            <option value="assignPreparer">Assign preparer</option>
            <option value="assignReviewer">Assign reviewer</option>
            <option value="status">Change status</option>
            <option value="docRequest">Send document request to client</option>
          </select>
          <select className="sel" name="userId" defaultValue=""><option value="">(person)</option>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select className="sel" name="to" defaultValue=""><option value="">(status)</option>{STATUS_ORDER.filter((s) => !["SUBMITTED", "PAYMENT_PENDING", "COMPLETED"].includes(s)).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          <button className="btn">Apply to selected</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              {canEdit && <th className="w-6"><SelectAll name="ids" /></th>}
              <th>Client</th><th>Obligation · period end</th><th>Statutory</th><th>Target</th><th>Prep · review</th><th>Preparer · reviewer</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((o) => {
              const t = tone(o, today);
              return (
                <tr key={o.id} className={`bar-${t}`}>
                  {canEdit && <td><input type="checkbox" name="ids" value={o.id} aria-label={`Select ${o.client.legalName}`} /></td>}
                  <td className="max-w-[230px] truncate" title={o.client.legalName}><Link href={`/clients/${o.client.id}`}>{o.client.legalName}</Link>{o.client.stopWork && <span className="chip t-red ml-1">STOP</span>}</td>
                  <td className="whitespace-nowrap" title={`Period ${formatDate(o.periodStart)} – ${formatDate(o.periodEnd)}`}><Link href={`/obligations/${o.id}`}>{TYPE_LABEL[o.type]}</Link> <span className="text-muted">· {formatDate(o.periodEnd)}</span>{o.needsReview && <span className="chip t-amber ml-1">Review</span>}</td>
                  <td className="whitespace-nowrap tabular-nums">{formatDate(o.statutoryDueDate)}</td>
                  <td className="whitespace-nowrap tabular-nums" title={fromDbDate(o.internalTargetDate) !== fromDbDate(o.statutoryDueDate) ? "Statutory date falls on a weekend or holiday; moved to the previous working day" : undefined}>{formatDate(o.internalTargetDate)}{fromDbDate(o.internalTargetDate) !== fromDbDate(o.statutoryDueDate) && "*"}</td>
                  <td className="whitespace-nowrap tabular-nums text-muted">{formatDate(o.prepDeadline).slice(0, 6)} · {formatDate(o.reviewDeadline).slice(0, 6)}</td>
                  <td className="max-w-[190px] truncate">{o.preparer?.name ?? <span className="chip t-red">Unassigned</span>} <span className="text-muted">· {o.reviewer?.name ?? "—"}</span></td>
                  <td>
                    {canEdit ? (
                      <InlineStatus id={o.id} status={o.status} back={here} t={t} overdue={isOverdue(o, today)} />
                    ) : (
                      <StatusChip status={o.status} tone={t} overdue={isOverdue(o, today)} />
                    )}
                  </td>
                </tr>
              );
            })}
            {r.rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-muted">No obligations match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager total={r.total} page={r.page} pageSize={r.pageSize} href={(n) => `/obligations${qs(base, { page: String(n) })}`} />
    </form>
    </>
  );
}

/** The select belongs to a hidden per-row form (via the `form` attribute) because forms cannot nest. */
function InlineStatus({ id, status, t, overdue }: { id: string; status: ObligationStatus; back: string; t: string; overdue: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {overdue && <span className={`chip t-${t}`}>Overdue</span>}
      <AutoSubmitSelect className={`sel h-[26px] w-[150px] text-[12px] t-${t}`} name="to" defaultValue={status} form={`st-${id}`} aria-label="Change status">
        {[...STATUS_ORDER, "ON_HOLD" as const].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </AutoSubmitSelect>
    </span>
  );
}

async function KanbanView({ u, f, today }: { u: U; f: ObligationFilters; today: string }) {
  const where = obligationFilterWhere(u, { ...f, status: f.status === "OPEN" || f.status === "OVERDUE" ? f.status : undefined });
  const rows = await prisma.obligation.findMany({ where, include: { client: { select: { legalName: true } }, preparer: { select: { name: true } } }, orderBy: { statutoryDueDate: "asc" }, take: 600 });
  const cols = [...STATUS_ORDER, "ON_HOLD" as const].filter((s) => rows.some((r) => r.status === s) || !["PAYMENT_PENDING", "COMPLETED"].includes(s));
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {cols.map((s) => {
        const items = rows.filter((r) => r.status === s);
        return (
          <div key={s} className="w-64 shrink-0">
            <div className="mb-2 flex justify-between px-1 text-[12px] font-semibold text-muted"><span>{STATUS_LABEL[s]}</span><span>{items.length}</span></div>
            <div className="space-y-2">
              {items.slice(0, 60).map((o) => (
                <Link key={o.id} href={`/obligations/${o.id}`} className={`card block p-2 hover:border-brand bar-${tone(o, today)}`}>
                  <div className="truncate font-medium">{o.client.legalName}</div>
                  <div className="text-[11.5px] text-muted">{TYPE_LABEL[o.type]} · due {formatDate(o.statutoryDueDate)}</div>
                  <div className="text-[11.5px]">{o.preparer?.name ?? <span className="text-[var(--red)]">Unassigned</span>}</div>
                </Link>
              ))}
              {items.length > 60 && <div className="text-center text-[11.5px] text-muted">+{items.length - 60} more — narrow the filters</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function CalendarView({ u, f, today, month, base }: { u: U; f: ObligationFilters; today: string; month?: string; base: Record<string, string | undefined> }) {
  const m = month ?? today.slice(0, 7);
  const { y, m: mm } = parseYmd(`${m}-01`);
  const first = ymd(y, mm, 1);
  const last = ymd(y, mm, daysInMonth(y, mm));
  const rows = await prisma.obligation.findMany({
    where: { AND: [obligationFilterWhere(u, { ...f, dueFrom: undefined, dueTo: undefined }), { statutoryDueDate: { gte: toDbDate(first), lte: toDbDate(last) } }] },
    include: { client: { select: { legalName: true } } },
    orderBy: { statutoryDueDate: "asc" },
  });
  const lead = (dayOfWeek(first) + 6) % 7; // Monday-first grid
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth(y, mm) }, (_, i) => ymd(y, mm, i + 1))];
  while (cells.length % 7) cells.push(null);
  const prev = addMonths(first, -1).slice(0, 7);
  const next = addMonths(first, 1).slice(0, 7);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <Link className="btn" href={`/obligations${qs(base, { month: prev })}`}>← {prev}</Link>
        <h2 className="h2">{formatDate(first).slice(3)} · by statutory due date</h2>
        <Link className="btn" href={`/obligations${qs(base, { month: next })}`}>{next} →</Link>
      </div>
      <div className="grid grid-cols-7 border-b border-line bg-bg text-center text-[11.5px] font-semibold text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const items = d ? rows.filter((r) => fromDbDate(r.statutoryDueDate) === d) : [];
          const weekend = i % 7 >= 5;
          return (
            <div key={i} className={`min-h-[96px] border-b border-r border-line p-1 ${weekend ? "bg-bg" : ""} ${d === today ? "outline outline-2 -outline-offset-2 outline-brand" : ""}`}>
              {d && <div className="text-right text-[11px] text-muted">{Number(d.slice(8))}</div>}
              {items.slice(0, 4).map((o) => (
                <Link key={o.id} href={`/obligations/${o.id}`} className={`mb-0.5 block truncate rounded px-1 text-[11px] chip t-${tone(o, today)}`} title={`${o.client.legalName} — ${TYPE_LABEL[o.type]}`}>
                  {TYPE_LABEL[o.type].split(" ")[0]} · {o.client.legalName}
                </Link>
              ))}
              {items.length > 4 && <Link href={`/obligations${qs(base, { mode: "list", dueFrom: d!, dueTo: d! })}`} className="text-[11px] text-brand-accent">+{items.length - 4} more</Link>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function YearGrid({ u, f, today, year, base }: { u: U; f: ObligationFilters; today: string; year?: string; base: Record<string, string | undefined> }) {
  const y = Number(year ?? today.slice(0, 4));
  const from = ymd(y, 1, 1);
  const to = ymd(y, 12, 31);
  const rows = await prisma.obligation.findMany({
    where: { AND: [obligationFilterWhere(u, { ...f, status: f.status === "OPEN" ? undefined : f.status, dueFrom: undefined, dueTo: undefined }), { statutoryDueDate: { gte: toDbDate(from), lte: toDbDate(to) } }] },
    include: { client: { select: { id: true, legalName: true } } },
    orderBy: [{ client: { legalName: "asc" } }, { statutoryDueDate: "asc" }],
    take: 3000,
  });
  const clients = [...new Map(rows.map((r) => [r.client.id, r.client])).values()];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <Link className="btn" href={`/obligations${qs(base, { year: String(y - 1) })}`}>← {y - 1}</Link>
        <h2 className="h2">{y} · each client a row, each period a cell (by statutory due month)</h2>
        <Link className="btn" href={`/obligations${qs(base, { year: String(y + 1) })}`}>{y + 1} →</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Client</th>{months.map((m) => <th key={m} className="text-center">{["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]}</th>)}</tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td className="max-w-[220px] truncate"><Link href={`/clients/${c.id}`}>{c.legalName}</Link></td>
                {months.map((m) => {
                  const cell = rows.filter((r) => r.client.id === c.id && Number(fromDbDate(r.statutoryDueDate).slice(5, 7)) === m);
                  return (
                    <td key={m} className="text-center">
                      <div className="flex flex-wrap justify-center gap-0.5">
                        {cell.map((o) => (
                          <Link key={o.id} href={`/obligations/${o.id}`} className={`chip t-${tone(o, today)}`} title={`${TYPE_LABEL[o.type]} — due ${formatDate(o.statutoryDueDate)} — ${STATUS_LABEL[o.status]}`}>
                            {o.type === "VAT_RETURN" ? "VAT" : o.type === "CT_RETURN" ? "CT" : o.type === "TRADE_LICENCE_RENEWAL" ? "LIC" : o.type === "ENGAGEMENT_RENEWAL" ? "ENG" : "•"}
                          </Link>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {clients.length === 0 && <tr><td colSpan={13} className="py-10 text-center text-muted">No obligations due in {y} for these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

void addDays;
