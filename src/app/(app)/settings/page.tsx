import Link from "next/link";
import { ObligationType, RoleKey } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { access, requirePermission, ROLE_LABEL } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { graphEnabled } from "@/lib/connectors/graph";
import { entraEnabled } from "@/lib/connectors/entra";
import { formatDate, formatDateTime, fromDbDate } from "@/lib/dates";
import { Flash, PageHead, TYPE_LABEL } from "@/components/ui";
import { SP, one } from "@/lib/web";
import { JOBS } from "@/jobs/runner";
import { addHoliday, addUser, confirmHoliday, confirmRule, newRuleVersion, removeHoliday, runNow, saveEmail, saveReminderRule, saveTemplate, updateUser } from "./actions";

const TABS = [["email", "Email"], ["connectors", "Connectors"], ["rules", "Deadline rules"], ["reminders", "Reminder rules"], ["templates", "Email templates"], ["holidays", "Holidays"], ["users", "Users and roles"], ["jobs", "Jobs"]] as const;

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  requirePermission(u, "settings");
  const canEdit = access(u, "settings").edit;
  const sp = await searchParams;
  const tab = one(sp.tab) ?? "email";
  return (
    <>
      <PageHead title="Settings" sub={canEdit ? "Changes are audited." : "View only for your role."} />
      <Flash sp={sp} />
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map(([k, l]) => <Link key={k} href={`/settings?tab=${k}`} className={`-mb-px border-b-2 px-3 py-2 ${tab === k ? "border-brand font-semibold" : "border-transparent text-muted"}`}>{l}</Link>)}
      </nav>
      <fieldset disabled={!canEdit}>
        {tab === "email" && <Email />}
        {tab === "connectors" && <Connectors />}
        {tab === "rules" && <Rules />}
        {tab === "reminders" && <Reminders />}
        {tab === "templates" && <Templates />}
        {tab === "holidays" && <Holidays />}
        {tab === "users" && <Users />}
        {tab === "jobs" && <Jobs />}
      </fieldset>
    </>
  );
}

async function Email() {
  const s = await getSettings();
  return (
    <form action={saveEmail} className="card max-w-2xl space-y-3 p-4">
      <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="paused" defaultChecked={s["email.paused"] === "true"} /> Pause ALL outbound email</label>
      <p className="text-muted">While paused, reminders are still worked out and logged as &quot;skipped paused&quot;, but nothing is sent. Those reminders are not re-sent when you un-pause.</p>
      <label className="block"><span className="lbl">Test mode — redirect every email to this one address (leave blank to send for real)</span><input className="inp w-full" type="email" name="testModeAddress" defaultValue={s["email.testModeAddress"]} /></label>
      <label className="block"><span className="lbl">Sender mailbox (Microsoft 365 shared mailbox)</span><input className="inp w-full" type="email" name="senderMailbox" defaultValue={s["email.senderMailbox"]} placeholder="compliance@yourfirm.com" /></label>
      <label className="flex items-center gap-2"><input type="checkbox" name="storeBodies" defaultChecked={s["email.storeBodies"] === "true"} /> Store email body previews on the client timeline (Outlook sync)</label>
      <div className="grid grid-cols-3 gap-3">
        <label className="block"><span className="lbl">Daily digest hour (GST)</span><input className="inp w-full" type="number" min={6} max={11} name="digestHour" defaultValue={s["digest.hourGst"]} /></label>
        <label className="block"><span className="lbl">Flag clients inactive after (days)</span><input className="inp w-full" type="number" min={7} name="inactivityDays" defaultValue={s["client.inactivityDays"]} /></label>
        <label className="block"><span className="lbl">Firm TRN</span><input className="inp w-full font-mono" name="firmTrn" defaultValue={s["firm.trn"]} /></label>
      </div>
      <button className="btn btn-primary">Save</button>
    </form>
  );
}

async function Connectors() {
  const logs = await prisma.connectorLog.findMany({ orderBy: { at: "desc" }, take: 50 });
  const rows: [string, boolean, string][] = [
    ["Microsoft Graph — send mail (reminders, digests)", graphEnabled(), "GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET + sender mailbox in Email settings"],
    ["Microsoft Graph — Outlook → client timeline", graphEnabled() && !!process.env.GRAPH_SYNC_MAILBOXES, "GRAPH_SYNC_MAILBOXES (comma-separated shared mailboxes)"],
    ["Microsoft Entra ID — single sign-on", entraEnabled(), "ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, APP_URL"],
    ["Website / Zapier / Power Automate → leads", !!process.env.LEAD_WEBHOOK_SECRET, "LEAD_WEBHOOK_SECRET; POST to /api/connectors/lead-webhook"],
  ];
  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <table className="tbl">
          <thead><tr><th>Connector</th><th>Status</th><th>Configured by (environment variables)</th></tr></thead>
          <tbody>{rows.map(([n, ok, how]) => <tr key={n}><td>{n}</td><td><span className={`chip ${ok ? "t-green" : "t-grey"}`}>{ok ? "Configured" : "Not configured"}</span></td><td className="text-muted">{how}</td></tr>)}</tbody>
        </table>
      </section>
      <p className="text-muted">Connector secrets live in the server environment, never in the database. See docs/CONNECTORS.md for the Microsoft 365 app registration steps.</p>
      <section className="card overflow-hidden">
        <h2 className="h2 border-b border-line px-3 py-2">Recent connector activity</h2>
        <table className="tbl">
          <thead><tr><th>When</th><th>Connector</th><th>Direction</th><th>Status</th><th>Detail</th></tr></thead>
          <tbody>
            {logs.map((l) => <tr key={l.id}><td className="whitespace-nowrap">{formatDateTime(l.at)}</td><td>{l.connector}</td><td>{l.direction.toLowerCase()}</td><td><span className={`chip ${l.status === "OK" ? "t-green" : l.status === "ERROR" ? "t-red" : "t-grey"}`}>{l.status}</span></td><td className="max-w-[420px] truncate" title={l.detail ?? ""}>{l.detail}</td></tr>)}
            {logs.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">No connector activity yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

async function Rules() {
  const rules = await prisma.deadlineRule.findMany({ orderBy: [{ obligationType: "asc" }, { version: "desc" }] });
  const usage = await prisma.obligation.groupBy({ by: ["ruleId"], _count: true });
  const used = new Map(usage.map((x) => [x.ruleId, x._count]));
  return (
    <div className="space-y-4">
      <p className="err">These rules are configurable defaults, not statutory advice. Each must be confirmed by a qualified person. Every obligation records the rule version that produced it.</p>
      <section className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Code</th><th>Ver.</th><th>Type</th><th>Rule</th><th>Basis</th><th>Offset</th><th>Prep / review (working days)</th><th>Effective</th><th>Obligations</th><th>Confirmed</th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="font-mono">{r.code}</td><td>{r.version}</td><td>{TYPE_LABEL[r.obligationType]}</td><td>{r.name}</td><td>{r.basis.replace(/_/g, " ").toLowerCase()}</td>
                <td>{r.offsetMonths ? `${r.offsetMonths} mo ` : ""}{r.offsetDays ? `${r.offsetDays} d` : r.offsetMonths ? "" : "0"}</td><td>{r.prepLeadWorkingDays} / {r.reviewLeadWorkingDays}</td>
                <td className="whitespace-nowrap">{formatDate(r.effectiveFrom)} – {r.effectiveTo ? formatDate(r.effectiveTo) : "open"}</td><td>{used.get(r.id) ?? 0}</td>
                <td>{r.isConfirmed ? <span className="chip t-green">{formatDateTime(r.confirmedAt)}</span> : <form action={confirmRule}><input type="hidden" name="id" value={r.id} /><button className="btn">Confirm</button></form>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <form action={newRuleVersion} className="card grid max-w-4xl gap-2 p-4 md:grid-cols-4">
        <h2 className="h2 md:col-span-4">New rule version</h2>
        <label><span className="lbl">Rule code (existing = new version)</span><input className="inp w-full font-mono" name="code" list="rule-codes" required /></label>
        <datalist id="rule-codes">{[...new Set(rules.map((r) => r.code))].map((c) => <option key={c} value={c} />)}</datalist>
        <label><span className="lbl">Obligation type</span><select className="sel w-full" name="obligationType">{Object.values(ObligationType).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
        <label className="md:col-span-2"><span className="lbl">Name</span><input className="inp w-full" name="name" /></label>
        <label><span className="lbl">Basis</span><select className="sel w-full" name="basis"><option value="DAYS_AFTER_PERIOD_END">Days after period end</option><option value="MONTHS_AFTER_PERIOD_END">Months after period end</option><option value="ON_SOURCE_DATE">On source date</option></select></label>
        <label><span className="lbl">Offset months</span><input className="inp w-full" type="number" name="offsetMonths" defaultValue={0} /></label>
        <label><span className="lbl">Offset days</span><input className="inp w-full" type="number" name="offsetDays" defaultValue={0} /></label>
        <label><span className="lbl">Effective from</span><input className="inp w-full" type="date" name="effectiveFrom" required /></label>
        <label><span className="lbl">Prep lead (working days)</span><input className="inp w-full" type="number" name="prep" defaultValue={10} /></label>
        <label><span className="lbl">Review lead (working days)</span><input className="inp w-full" type="number" name="review" defaultValue={5} /></label>
        <label className="md:col-span-2"><span className="lbl">Notes / source</span><input className="inp w-full" name="notes" /></label>
        <div className="md:col-span-4"><button className="btn btn-primary">Save new version</button></div>
      </form>
    </div>
  );
}

async function Reminders() {
  const rules = await prisma.reminderRule.findMany({ orderBy: { name: "asc" } });
  return (
    <section className="card overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>Rule</th><th>Type</th><th>Track</th><th>Trigger</th><th>Offsets (days before) / repeat</th><th>Template</th><th>Active</th><th /></tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td><td>{r.obligationType ? TYPE_LABEL[r.obligationType] : "All"}</td><td>{r.track.replace(/_/g, " ").toLowerCase()}</td><td>{r.trigger.replace(/_/g, " ").toLowerCase()}</td>
              <td colSpan={4}>
                <form action={saveReminderRule} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input className="inp w-36" name="offsets" defaultValue={r.offsetsDays.join(", ")} aria-label="Offsets" />
                  {r.trigger === "OVERDUE_REPEAT" && <input className="inp w-16" name="repeat" type="number" min={1} defaultValue={r.repeatEveryDays ?? 2} aria-label="Repeat every" />}
                  <Link href={`/settings?tab=templates#${r.templateKey}`} className="text-brand-accent">{r.templateKey}</Link>
                  <label className="flex items-center gap-1"><input type="checkbox" name="isActive" defaultChecked={r.isActive} /> active</label>
                  <button className="btn">Save</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

async function Templates() {
  const ts = await prisma.emailTemplate.findMany({ orderBy: { key: "asc" } });
  return (
    <div className="space-y-3">
      <p className="text-muted">Merge fields: {"{{recipient_name}} {{client_name}} {{client_code}} {{obligation_title}} {{status}} {{statutory_due_date}} {{internal_target_date}} {{prep_deadline}} {{reminder_reason}} {{link}}"}</p>
      {ts.map((t) => (
        <form key={t.key} id={t.key} action={saveTemplate} className="card space-y-2 p-4">
          <input type="hidden" name="key" value={t.key} />
          <h2 className="h2">{t.name} <span className="font-mono text-[11px] text-muted">{t.key}</span></h2>
          <input className="inp w-full" name="subject" defaultValue={t.subject} aria-label="Subject" />
          <textarea className="inp w-full font-mono text-[12px]" rows={7} name="body" defaultValue={t.body} aria-label="Body" />
          <button className="btn">Save template</button>
        </form>
      ))}
    </div>
  );
}

async function Holidays() {
  const hs = await prisma.holiday.findMany({ orderBy: { date: "asc" } });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card overflow-hidden lg:col-span-2">
        <table className="tbl">
          <thead><tr><th>Date</th><th>Day</th><th>Name</th><th>Status</th><th /></tr></thead>
          <tbody>
            {hs.map((h) => (
              <tr key={h.id}>
                <td>{formatDate(h.date)}</td><td>{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(fromDbDate(h.date) + "T00:00:00Z").getUTCDay()]}</td><td>{h.name}</td>
                <td>{h.isConfirmed ? <span className="chip t-green">Confirmed</span> : <form action={confirmHoliday} className="inline"><input type="hidden" name="id" value={h.id} /><span className="chip t-amber mr-1">Estimate</span><button className="text-brand-accent hover:underline">Confirm</button></form>}</td>
                <td><form action={removeHoliday}><input type="hidden" name="id" value={h.id} /><button className="text-[var(--red)] hover:underline">Remove</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <form action={addHoliday} className="card h-fit space-y-2 p-4">
        <h2 className="h2">Add holiday</h2>
        <input className="inp w-full" type="date" name="date" required aria-label="Date" />
        <input className="inp w-full" name="name" required placeholder="Name" aria-label="Name" />
        <label className="flex items-center gap-2"><input type="checkbox" name="isConfirmed" defaultChecked /> Officially announced</label>
        <button className="btn btn-primary">Add</button>
        <p className="text-[11.5px] text-muted">Weekend: Saturday and Sunday. Lunar holidays are seeded as estimates — confirm or move them when announced.</p>
      </form>
    </div>
  );
}

async function Users() {
  const users = await prisma.user.findMany({ include: { role: true, manager: { select: { name: true } } }, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  const managers = users.filter((x) => ["MANAGER", "PARTNER", "MANAGING_PARTNER"].includes(x.role.key));
  return (
    <div className="space-y-4">
      <section className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>2FA</th><th>Last sign-in</th><th>Role · reports to · leave · active</th></tr></thead>
          <tbody>
            {users.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td><td>{x.email}</td><td>{x.totpEnabled ? <span className="chip t-green">On</span> : x.entraObjectId ? <span className="chip t-blue">Entra</span> : <span className="chip t-amber">Not enrolled</span>}</td><td>{formatDateTime(x.lastLoginAt)}</td>
                <td>
                  <form action={updateUser} className="flex flex-wrap items-center gap-1">
                    <input type="hidden" name="id" value={x.id} />
                    <select className="sel" name="role" defaultValue={x.role.key} aria-label="Role">{Object.values(RoleKey).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                    <select className="sel" name="managerId" defaultValue={x.managerId ?? ""} aria-label="Reports to"><option value="">No manager</option>{managers.filter((m) => m.id !== x.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                    <input className="inp w-32" type="date" name="leaveFrom" defaultValue={x.onLeaveFrom ? fromDbDate(x.onLeaveFrom) : ""} aria-label="Leave from" />
                    <input className="inp w-32" type="date" name="leaveTo" defaultValue={x.onLeaveTo ? fromDbDate(x.onLeaveTo) : ""} aria-label="Leave to" />
                    <label className="flex items-center gap-1"><input type="checkbox" name="isActive" defaultChecked={x.isActive} /> active</label>
                    <label className="flex items-center gap-1"><input type="checkbox" name="reset2fa" /> reset 2FA</label>
                    <button className="btn">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <form action={addUser} className="card grid max-w-4xl gap-2 p-4 md:grid-cols-5">
        <h2 className="h2 md:col-span-5">Add user</h2>
        <input className="inp" name="name" required placeholder="Full name" aria-label="Name" />
        <input className="inp" name="email" type="email" required placeholder="Work email" aria-label="Email" />
        <select className="sel" name="role" aria-label="Role">{Object.values(RoleKey).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        <select className="sel" name="managerId" aria-label="Reports to"><option value="">Reports to…</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <input className="inp" name="password" type="password" placeholder="Initial password (12+), or blank for SSO" aria-label="Password" />
        <div className="md:col-span-5"><button className="btn btn-primary">Add user</button></div>
      </form>
      <p className="text-muted">While a staff member is on leave, their reminders go to their manager instead.</p>
    </div>
  );
}

async function Jobs() {
  const runs = await prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 60 });
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="h2 mb-2">Run a job now</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(JOBS).map(([k, j]) => (
            <form key={k} action={runNow}><input type="hidden" name="job" value={k} /><button className="btn" title={`Schedule: ${j.cron} (Asia/Dubai)`}>{k}</button></form>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-muted">Re-running is safe: generation and reminders are idempotent.</p>
      </section>
      <section className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Job</th><th>Started</th><th>Finished</th><th>Status</th><th>Processed</th><th>Created / sent</th><th>Errors</th><th>Detail</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}><td>{r.jobName}</td><td className="whitespace-nowrap">{formatDateTime(r.startedAt)}</td><td className="whitespace-nowrap">{formatDateTime(r.finishedAt)}</td><td><span className={`chip ${r.status === "FAILED" ? "t-red" : r.status === "RUNNING" ? "t-blue" : "t-green"}`}>{r.status}</span></td><td>{r.itemsProcessed}</td><td>{r.itemsCreated}</td><td>{r.errorCount}</td><td className="max-w-[360px] truncate font-mono text-[11px]" title={JSON.stringify(r.detail)}>{JSON.stringify(r.detail)}</td></tr>
            ))}
            {runs.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-muted">No runs yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
