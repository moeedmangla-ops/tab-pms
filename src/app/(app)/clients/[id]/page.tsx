import Link from "next/link";
import { ServiceLine } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { access } from "@/lib/permissions";
import { getClientForActor } from "@/lib/services/clients";
import { STATUS_LABEL, tone, isOverdue } from "@/lib/engine/workflow";
import { formatDate, formatDateTime, todayDubai } from "@/lib/dates";
import { Flash, PageHead, SERVICE_LABEL, StatusChip, TYPE_LABEL, aed, Empty } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { SP, one } from "@/lib/web";
import { addContact, addEngagement, addTask, archive, endEngagement, logCommunication, removeContact, saveNotes, setStopWork, setTaskStatus } from "../actions";

const TABS = ["overview", "contacts", "services", "obligations", "documents", "communication", "tasks", "notes", "audit"] as const;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default async function ClientProfile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const tab = (one(sp.tab) ?? "overview") as (typeof TABS)[number];
  const c = await getClientForActor(u, id);
  const canEdit = access(u, "clients").edit;
  const today = todayDubai();
  const [tax, partner, counts] = await Promise.all([
    prisma.clientTaxProfile.findUnique({ where: { clientId: id } }),
    c.relationshipPartnerId ? prisma.user.findUnique({ where: { id: c.relationshipPartnerId }, select: { name: true } }) : null,
    prisma.obligation.groupBy({ by: ["status"], where: { clientId: id, deletedAt: null }, _count: true }),
  ]);
  const staff = canEdit ? await prisma.user.findMany({ where: { isActive: true, role: { key: { notIn: ["BUSINESS_DEVELOPMENT", "READ_ONLY"] } } }, select: { id: true, name: true, role: { select: { key: true } } }, orderBy: { name: "asc" } }) : [];

  return (
    <>
      <PageHead title={c.legalName} sub={<><span className="font-mono">{c.clientCode}</span> · {c.tradeName ?? "—"} · {c.status.toLowerCase()}</>}>
        {canEdit && <Link className="btn" href={`/clients/${id}/edit`}>Edit</Link>}
        {canEdit && c.status !== "ARCHIVED" && (
          <form action={archive}><input type="hidden" name="id" value={id} /><ConfirmButton className="btn btn-danger" message="Archive this client? It is kept with its full history and can be reactivated.">Archive</ConfirmButton></form>
        )}
      </PageHead>
      <Flash sp={sp} />
      {c.stopWork && <div className="err mb-3"><strong>STOP WORK</strong> — {c.stopWorkReason}</div>}

      <nav className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <Link key={t} href={`/clients/${id}?tab=${t}`} className={`-mb-px border-b-2 px-3 py-2 ${tab === t ? "border-brand font-semibold" : "border-transparent text-muted hover:text-ink"}`}>
            {t === "audit" ? "Audit Trail" : t[0].toUpperCase() + t.slice(1)}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-4 md:grid-cols-3">
          <section className="card p-4">
            <h2 className="h2 mb-2">Entity</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">Entity type</dt><dd>{c.entityType.replace(/_/g, " ").toLowerCase()}</dd>
              <dt className="text-muted">Licence</dt><dd>{c.licenceNumber ?? "—"} {c.licenceAuthority ? `· ${c.licenceAuthority}` : ""}</dd>
              <dt className="text-muted">Licence expiry</dt><dd>{formatDate(c.licenceExpiry)}</dd>
              <dt className="text-muted">Emirate</dt><dd>{c.emirate ?? "—"}</dd>
              <dt className="text-muted">Industry</dt><dd>{c.industry ?? "—"}</dd>
              <dt className="text-muted">Year-end</dt><dd>{c.fyEndMonth ? `${c.fyEndDay} ${MONTHS[c.fyEndMonth - 1]}` : <span className="chip t-amber">Missing — no CT deadlines</span>}</dd>
              <dt className="text-muted">Partner</dt><dd>{partner?.name ?? "—"}</dd>
            </dl>
          </section>
          <section className="card p-4">
            <h2 className="h2 mb-2">Tax profile</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">VAT TRN</dt><dd className="font-mono">{tax?.vatTrn ?? "—"}</dd>
              <dt className="text-muted">VAT frequency</dt><dd>{tax?.vatFrequency.replace("_", " ").toLowerCase() ?? "—"}</dd>
              <dt className="text-muted">VAT period anchor</dt><dd>{formatDate(tax?.vatPeriodAnchor)}</dd>
              <dt className="text-muted">CT number</dt><dd className="font-mono">{tax?.ctRegistrationNo ?? "—"}</dd>
              <dt className="text-muted">CT registered</dt><dd>{tax?.ctRegistered ? "Yes" : "No"}</dd>
              <dt className="text-muted">Free zone / QFZP</dt><dd>{tax?.freeZone ? "Yes" : "No"} / {tax?.qfzpStatus ? "Yes" : "No"}</dd>
              <dt className="text-muted">Small Business Relief</dt><dd>{tax?.smallBusinessRelief ? "Yes" : "No"}</dd>
            </dl>
          </section>
          <section className="card p-4">
            <h2 className="h2 mb-2">Obligations</h2>
            <ul className="space-y-1">
              {counts.map((g) => <li key={g.status} className="flex justify-between"><span>{STATUS_LABEL[g.status]}</span><span className="tabular-nums">{g._count}</span></li>)}
              {counts.length === 0 && <li className="text-muted">None generated.</li>}
            </ul>
            {access(u, "collections").edit && (
              <form action={setStopWork} className="mt-4 space-y-2 border-t border-line pt-3">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="on" value={c.stopWork ? "0" : "1"} />
                {!c.stopWork && <input className="inp w-full" name="reason" placeholder="Stop-work reason" aria-label="Stop-work reason" />}
                <button className="btn">{c.stopWork ? "Clear stop-work flag" : "Set stop-work flag"}</button>
              </form>
            )}
          </section>
        </div>
      )}

      {tab === "contacts" && <Contacts id={id} canEdit={canEdit} />}
      {tab === "services" && <Services id={id} canEdit={canEdit} staff={staff} />}
      {tab === "obligations" && <Obligations id={id} today={today} />}
      {tab === "documents" && (
        <section className="card"><Empty>Document storage is Phase 4 (BUILD_SPEC Section 9). Not built yet.</Empty></section>
      )}
      {tab === "communication" && <Timeline id={id} canEdit={canEdit} />}
      {tab === "tasks" && <Tasks id={id} canEdit={canEdit} staff={staff} uid={u.id} />}
      {tab === "notes" && (
        <form action={saveNotes} className="card space-y-2 p-4">
          <input type="hidden" name="id" value={id} />
          <textarea className="inp w-full" rows={10} name="notes" defaultValue={c.notes ?? ""} readOnly={!canEdit} aria-label="Notes" />
          {canEdit && <button className="btn btn-primary">Save notes</button>}
        </form>
      )}
      {tab === "audit" && <Audit id={id} />}
    </>
  );
}

async function Contacts({ id, canEdit }: { id: string; canEdit: boolean }) {
  const rows = await prisma.contact.findMany({ where: { clientId: id, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card overflow-hidden lg:col-span-2">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Designation</th><th>Email</th><th>Mobile</th><th>Roles</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td><td>{r.designation ?? "—"}</td><td>{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : "—"}</td><td>{r.mobile ?? "—"}</td>
                <td className="space-x-1">{r.isPrimary && <span className="chip t-blue">Primary</span>}{r.isAccounts && <span className="chip t-grey">Accounts</span>}{r.isAuthorisedSignatory && <span className="chip t-grey">Signatory</span>}</td>
                {canEdit && <td><form action={removeContact}><input type="hidden" name="clientId" value={id} /><input type="hidden" name="id" value={r.id} /><button className="text-[var(--red)] hover:underline">Remove</button></form></td>}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">No contacts.</td></tr>}
          </tbody>
        </table>
      </section>
      {canEdit && (
        <form action={addContact} className="card space-y-2 p-4">
          <h2 className="h2">Add contact</h2>
          <input type="hidden" name="clientId" value={id} />
          <input className="inp w-full" name="name" placeholder="Name *" required aria-label="Name" />
          <input className="inp w-full" name="designation" placeholder="Designation" aria-label="Designation" />
          <input className="inp w-full" name="email" type="email" placeholder="Email" aria-label="Email" />
          <input className="inp w-full" name="mobile" placeholder="Mobile" aria-label="Mobile" />
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1"><input type="checkbox" name="isPrimary" /> Primary</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="isAccounts" /> Accounts</label>
            <label className="flex items-center gap-1"><input type="checkbox" name="isAuthorisedSignatory" /> Authorised signatory</label>
          </div>
          <button className="btn btn-primary">Add contact</button>
        </form>
      )}
    </div>
  );
}

async function Services({ id, canEdit, staff }: { id: string; canEdit: boolean; staff: { id: string; name: string; role: { key: string } }[] }) {
  const rows = await prisma.serviceEngagement.findMany({ where: { clientId: id }, include: { partner: true, manager: true, preparer: true }, orderBy: [{ isActive: "desc" }, { serviceLine: "asc" }] });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card overflow-hidden lg:col-span-2">
        <table className="tbl">
          <thead><tr><th>Service</th><th>Fee</th><th>Billing</th><th>Contract</th><th>Partner</th><th>Manager</th><th>Preparer</th><th>Status</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>{SERVICE_LABEL[e.serviceLine]}</td><td className="tabular-nums">{aed(e.fee)}</td><td>{e.billingFrequency.toLowerCase().replace("_", "-")}</td>
                <td className="whitespace-nowrap">{formatDate(e.contractStart)} – {e.contractEnd ? formatDate(e.contractEnd) : "open"}</td>
                <td>{e.partner?.name ?? "—"}</td><td>{e.manager?.name ?? "—"}</td><td>{e.preparer?.name ?? "—"}</td>
                <td>{e.isActive ? <span className="chip t-green">Active</span> : <span className="chip t-grey">Ended</span>}</td>
                {canEdit && <td>{e.isActive && <form action={endEngagement}><input type="hidden" name="clientId" value={id} /><input type="hidden" name="id" value={e.id} /><button className="text-[var(--red)] hover:underline">End</button></form>}</td>}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-muted">No services. Add one so obligations have a preparer and reviewer.</td></tr>}
          </tbody>
        </table>
      </section>
      {canEdit && (
        <form action={addEngagement} className="card space-y-2 p-4">
          <h2 className="h2">Add service</h2>
          <input type="hidden" name="clientId" value={id} />
          <select className="sel w-full" name="serviceLine" required aria-label="Service line">{Object.values(ServiceLine).map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}</select>
          <div className="grid grid-cols-2 gap-2">
            <input className="inp" name="fee" type="number" min={0} step="0.01" placeholder="Fee (AED)" required aria-label="Fee" />
            <select className="sel" name="billingFrequency" aria-label="Billing frequency"><option value="ANNUAL">Annual</option><option value="QUARTERLY">Quarterly</option><option value="MONTHLY">Monthly</option><option value="ONE_OFF">One-off</option></select>
            <label><span className="lbl">Contract start</span><input className="inp w-full" name="contractStart" type="date" required /></label>
            <label><span className="lbl">Contract end</span><input className="inp w-full" name="contractEnd" type="date" /></label>
          </div>
          <select className="sel w-full" name="partnerId" aria-label="Partner"><option value="">Partner…</option>{staff.filter((s) => ["PARTNER", "MANAGING_PARTNER"].includes(s.role.key)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="sel w-full" name="managerId" aria-label="Manager"><option value="">Manager…</option>{staff.filter((s) => ["MANAGER", "PARTNER", "MANAGING_PARTNER"].includes(s.role.key)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="sel w-full" name="preparerId" aria-label="Preparer"><option value="">Preparer…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button className="btn btn-primary">Add service</button>
        </form>
      )}
    </div>
  );
}

async function Obligations({ id, today }: { id: string; today: string }) {
  const rows = await prisma.obligation.findMany({ where: { clientId: id, deletedAt: null }, include: { preparer: { select: { name: true } } }, orderBy: { statutoryDueDate: "asc" } });
  return (
    <section className="card overflow-hidden">
      <table className="tbl">
        <thead><tr><th>Obligation</th><th>Period</th><th>Statutory</th><th>Internal target</th><th>Preparer</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className={`bar-${tone(o, today)}`}>
              <td><Link href={`/obligations/${o.id}`}>{TYPE_LABEL[o.type]}</Link>{o.needsReview && <span className="chip t-amber ml-1">Review dates</span>}</td>
              <td className="whitespace-nowrap text-muted">{formatDate(o.periodStart)} – {formatDate(o.periodEnd)}</td>
              <td className="tabular-nums">{formatDate(o.statutoryDueDate)}</td><td className="tabular-nums">{formatDate(o.internalTargetDate)}</td>
              <td>{o.preparer?.name ?? <span className="chip t-red">Unassigned</span>}</td>
              <td><StatusChip status={o.status} tone={tone(o, today)} overdue={isOverdue(o, today)} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">No obligations. Check the year-end, VAT and licence details.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

async function Timeline({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [comms, history, reminders] = await Promise.all([
    prisma.communication.findMany({ where: { clientId: id }, orderBy: { occurredAt: "desc" }, take: 200 }),
    prisma.obligationStatusHistory.findMany({ where: { obligation: { clientId: id } }, include: { obligation: { select: { type: true, periodEnd: true } }, changedBy: { select: { name: true } } }, orderBy: { changedAt: "desc" }, take: 200 }),
    prisma.reminderLog.findMany({ where: { obligation: { clientId: id }, track: { in: ["CLIENT_DOCUMENT_REQUEST", "CLIENT_APPROVAL_REQUEST", "PAYMENT_FOLLOW_UP"] } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const items = [
    ...comms.map((c) => ({ at: c.occurredAt, kind: c.channel.toLowerCase().replace("_", " "), title: c.subject, body: `${c.direction.toLowerCase()} · ${c.participants.join(", ")}${c.summary ? ` — ${c.summary}` : ""}` })),
    ...history.map((h) => ({ at: h.changedAt, kind: "status", title: `${TYPE_LABEL[h.obligation.type]} (${formatDate(h.obligation.periodEnd)}) → ${STATUS_LABEL[h.toStatus]}`, body: `${h.changedBy?.name ?? "System"}${h.note ? ` — ${h.note}` : ""}` })),
    ...reminders.map((r) => ({ at: r.sentAt ?? r.createdAt, kind: "reminder", title: r.subject, body: `to ${r.recipientEmail} · ${r.status.toLowerCase()}` })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card lg:col-span-2">
        <ol className="divide-y divide-[var(--line)]">
          {items.map((i, n) => (
            <li key={n} className="flex gap-3 px-4 py-2">
              <span className="w-36 shrink-0 text-[11.5px] text-muted">{formatDateTime(i.at)}</span>
              <span className="chip t-grey h-fit">{i.kind}</span>
              <div><div className="font-medium">{i.title}</div><div className="text-[12px] text-muted">{i.body}</div></div>
            </li>
          ))}
          {items.length === 0 && <li><Empty>No interactions yet. Outlook emails appear here automatically once the Microsoft 365 connector is configured.</Empty></li>}
        </ol>
      </section>
      {canEdit && (
        <form action={logCommunication} className="card space-y-2 p-4">
          <h2 className="h2">Log an interaction</h2>
          <input type="hidden" name="clientId" value={id} />
          <div className="grid grid-cols-2 gap-2">
            <select className="sel" name="channel" aria-label="Channel"><option value="PHONE">Phone</option><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option><option value="MEETING">Meeting</option><option value="SITE_VISIT">Site visit</option></select>
            <select className="sel" name="direction" aria-label="Direction"><option value="OUTBOUND">Outbound</option><option value="INBOUND">Inbound</option><option value="INTERNAL">Internal</option></select>
            <input className="inp" type="date" name="date" required defaultValue={todayDubai()} aria-label="Date" />
            <input className="inp" type="time" name="time" defaultValue="09:00" aria-label="Time" />
          </div>
          <input className="inp w-full" name="subject" placeholder="Subject *" required aria-label="Subject" />
          <input className="inp w-full" name="participants" placeholder="Participants (comma-separated)" aria-label="Participants" />
          <textarea className="inp w-full" name="summary" rows={4} placeholder="Summary" aria-label="Summary" />
          <button className="btn btn-primary">Log</button>
        </form>
      )}
    </div>
  );
}

async function Tasks({ id, canEdit, staff, uid }: { id: string; canEdit: boolean; staff: { id: string; name: string }[]; uid: string }) {
  const rows = await prisma.task.findMany({ where: { clientId: id }, include: { assignee: { select: { name: true } } }, orderBy: [{ status: "asc" }, { dueDate: "asc" }] });
  const back = `/clients/${id}?tab=tasks`;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card overflow-hidden lg:col-span-2">
        <table className="tbl">
          <thead><tr><th>Task</th><th>Assignee</th><th>Priority</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>{t.title}{t.description && <div className="text-[11.5px] text-muted">{t.description}</div>}</td><td>{t.assignee?.name ?? "—"}</td><td>{t.priority.toLowerCase()}</td><td>{formatDate(t.dueDate)}</td>
                <td>
                  {(canEdit || t.assigneeId === uid) && t.status !== "DONE" ? (
                    <form action={setTaskStatus} className="flex gap-1"><input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="status" value="DONE" /><span className="chip t-blue">{t.status.toLowerCase().replace("_", " ")}</span><button className="text-brand-accent hover:underline">Mark done</button></form>
                  ) : <span className={`chip ${t.status === "DONE" ? "t-green" : "t-blue"}`}>{t.status.toLowerCase()}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">No tasks.</td></tr>}
          </tbody>
        </table>
      </section>
      {canEdit && (
        <form action={addTask} className="card space-y-2 p-4">
          <h2 className="h2">Add task</h2>
          <input type="hidden" name="clientId" value={id} />
          <input className="inp w-full" name="title" placeholder="Title *" required aria-label="Title" />
          <textarea className="inp w-full" name="description" rows={3} placeholder="Description" aria-label="Description" />
          <select className="sel w-full" name="assigneeId" defaultValue={uid} aria-label="Assignee">{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <div className="grid grid-cols-2 gap-2">
            <input className="inp" type="date" name="dueDate" aria-label="Due date" />
            <select className="sel" name="priority" defaultValue="NORMAL" aria-label="Priority"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select>
          </div>
          <button className="btn btn-primary">Add task</button>
        </form>
      )}
    </div>
  );
}

async function Audit({ id }: { id: string }) {
  const obIds = (await prisma.obligation.findMany({ where: { clientId: id }, select: { id: true } })).map((o) => o.id);
  const rows = await prisma.auditLog.findMany({ where: { OR: [{ tableName: "client", recordId: id }, { tableName: "obligation", recordId: { in: obIds } }] }, orderBy: { at: "desc" }, take: 300 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter(Boolean) as string[])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <section className="card overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Field</th><th>Old</th><th>New</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.id)}>
              <td className="whitespace-nowrap">{formatDateTime(r.at)}</td><td>{r.userId ? users.get(r.userId) : "System"}</td><td>{r.action.toLowerCase()}</td><td>{r.tableName}</td><td>{r.field ?? "—"}</td>
              <td className="max-w-[200px] truncate text-muted" title={r.oldValue ?? ""}>{r.oldValue ?? "—"}</td><td className="max-w-[200px] truncate" title={r.newValue ?? ""}>{r.newValue ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">No audit entries.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
