import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceLine } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canEditLead, leadWhere } from "@/lib/permissions";
import { STAGE_ORDER } from "@/lib/services/leads";
import { addDays, formatDate, formatDateTime, todayDubai } from "@/lib/dates";
import { Flash, LEAD_STAGE_LABEL, PageHead, SERVICE_LABEL } from "@/components/ui";
import { SP } from "@/lib/web";
import { LeadForm } from "../LeadForm";
import { contact, convert, stage, update } from "../actions";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser();
  const { id } = await params;
  const l = await prisma.lead.findFirst({ where: { AND: [{ id, deletedAt: null }, leadWhere(u)] }, include: { owner: true, communications: { orderBy: { occurredAt: "desc" } }, convertedClient: { select: { id: true, legalName: true } } } });
  if (!l) notFound();
  const canEdit = canEditLead(u, l.ownerId);
  const [owners, reasons, staff] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, role: { key: { not: "READ_ONLY" } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.lostReason.findMany({ orderBy: { label: "asc" } }),
    prisma.user.findMany({ where: { isActive: true, role: { key: { notIn: ["BUSINESS_DEVELOPMENT", "READ_ONLY"] } } }, select: { id: true, name: true, role: { select: { key: true } } }, orderBy: { name: "asc" } }),
  ]);
  const responseH = l.firstContactAt ? (l.firstContactAt.getTime() - l.createdAt.getTime()) / 3_600_000 : null;
  const open = !["WON", "LOST"].includes(l.stage);
  return (
    <>
      <PageHead title={l.company ?? l.name} sub={<>{l.name} · {LEAD_STAGE_LABEL[l.stage]} · owner {l.owner.name} · created {formatDateTime(l.createdAt)} · first contact {responseH === null ? <span className="chip t-red">not yet</span> : `after ${responseH < 48 ? `${responseH.toFixed(1)} h` : `${(responseH / 24).toFixed(1)} days`}`}</>}>
        {l.convertedClient && <Link className="btn" href={`/clients/${l.convertedClient.id}`}>Open client</Link>}
      </PageHead>
      <Flash sp={await searchParams} />
      {canEdit ? <LeadForm action={update} l={l} owners={owners} defaultOwner={l.ownerId} submit="Save lead" /> : <div className="card p-4">You can view this lead but not edit it.</div>}
      {canEdit && open && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <form action={contact} className="card space-y-2 p-4">
            <h2 className="h2">Log contact</h2>
            <input type="hidden" name="id" value={l.id} />
            <select className="sel w-full" name="channel" aria-label="Channel"><option value="PHONE">Phone</option><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option><option value="MEETING">Meeting</option></select>
            <input className="inp w-full" name="subject" required placeholder="Subject *" aria-label="Subject" />
            <textarea className="inp w-full" name="summary" rows={3} placeholder="What was said" aria-label="Summary" />
            <label className="block"><span className="lbl">Next-action date *</span><input className="inp w-full" type="date" name="nextActionDate" required defaultValue={addDays(todayDubai(), 3)} /></label>
            <input className="inp w-full" name="nextAction" placeholder="Next action" aria-label="Next action" />
            <button className="btn btn-primary">Log contact</button>
          </form>
          <form action={stage} className="card space-y-2 p-4">
            <h2 className="h2">Move stage</h2>
            <input type="hidden" name="id" value={l.id} />
            <select className="sel w-full" name="stage" defaultValue={l.stage} aria-label="Stage">{STAGE_ORDER.filter((s) => s !== "WON").map((s) => <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>)}</select>
            <select className="sel w-full" name="lostReason" defaultValue="" aria-label="Lost reason"><option value="">Lost reason (required for Lost)</option>{reasons.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}</select>
            <button className="btn">Update stage</button>
          </form>
          <form action={convert} className="card space-y-2 p-4">
            <h2 className="h2">Won — convert to client</h2>
            <input type="hidden" name="id" value={l.id} />
            <input className="inp w-full" name="clientCode" required placeholder="New client code *" aria-label="Client code" />
            <input className="inp w-full" name="legalName" required defaultValue={l.company ?? l.name} aria-label="Legal name" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-3 gap-1">
                <select className="sel" name="serviceLine" defaultValue={l.serviceInterest[i] ?? ""} aria-label={`Service ${i + 1}`}><option value="">Service…</option>{Object.values(ServiceLine).map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}</select>
                <input className="inp" name="fee" type="number" min={0} placeholder="Fee" aria-label={`Fee ${i + 1}`} />
                <select className="sel" name="billingFrequency" aria-label={`Billing ${i + 1}`}><option value="ANNUAL">Annual</option><option value="QUARTERLY">Quarterly</option><option value="MONTHLY">Monthly</option><option value="ONE_OFF">One-off</option></select>
              </div>
            ))}
            <select className="sel w-full" name="partnerId" aria-label="Partner"><option value="">Partner…</option>{staff.filter((s) => ["PARTNER", "MANAGING_PARTNER"].includes(s.role.key)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <select className="sel w-full" name="managerId" aria-label="Manager"><option value="">Manager…</option>{staff.filter((s) => s.role.key === "MANAGER").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <select className="sel w-full" name="preparerId" aria-label="Preparer"><option value="">Preparer…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <button className="btn btn-primary">Convert to client</button>
          </form>
        </div>
      )}
      <section className="card mt-4">
        <h2 className="h2 border-b border-line px-3 py-2">Interactions</h2>
        <ol className="divide-y divide-[var(--line)]">
          {l.communications.map((c) => (
            <li key={c.id} className="flex gap-3 px-4 py-2"><span className="w-36 shrink-0 text-[11.5px] text-muted">{formatDateTime(c.occurredAt)}</span><span className="chip t-grey h-fit">{c.channel.toLowerCase()}</span><div><div className="font-medium">{c.subject}</div><div className="text-[12px] text-muted">{c.summary}</div></div></li>
          ))}
          {l.communications.length === 0 && <li className="px-4 py-6 text-center text-muted">No contact logged yet. Next action due {formatDate(l.nextActionDate)}.</li>}
        </ol>
      </section>
    </>
  );
}
