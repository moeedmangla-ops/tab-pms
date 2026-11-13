import { Lead, LeadSource, ServiceLine } from "@prisma/client";
import { fromDbDate, todayDubai, addDays } from "@/lib/dates";
import { Field, SERVICE_LABEL, SOURCE_LABEL } from "@/components/ui";

export function LeadForm({ action, l, owners, defaultOwner, submit }: { action: (fd: FormData) => Promise<void>; l?: Lead; owners: { id: string; name: string }[]; defaultOwner: string; submit: string }) {
  return (
    <form action={action} className="card grid gap-3 p-4 md:grid-cols-3">
      {l && <input type="hidden" name="id" value={l.id} />}
      <Field label="Contact name *"><input className="inp w-full" name="name" required defaultValue={l?.name} /></Field>
      <Field label="Company"><input className="inp w-full" name="company" defaultValue={l?.company ?? ""} /></Field>
      <Field label="Country"><input className="inp w-full" name="country" defaultValue={l?.country ?? "AE"} /></Field>
      <Field label="Email"><input className="inp w-full" type="email" name="email" defaultValue={l?.email ?? ""} /></Field>
      <Field label="Mobile"><input className="inp w-full" name="mobile" defaultValue={l?.mobile ?? ""} /></Field>
      <Field label="Source *"><select className="sel w-full" name="source" defaultValue={l?.source ?? "REFERRAL"}>{Object.values(LeadSource).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select></Field>
      <Field label="Owner * (mandatory)"><select className="sel w-full" name="ownerId" required defaultValue={l?.ownerId ?? defaultOwner}>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      <Field label="Next-action date * (mandatory)"><input className="inp w-full" type="date" name="nextActionDate" required defaultValue={l ? fromDbDate(l.nextActionDate) : addDays(todayDubai(), 1)} /></Field>
      <Field label="Next action"><input className="inp w-full" name="nextAction" defaultValue={l?.nextAction ?? ""} placeholder="e.g. Call to qualify" /></Field>
      <Field label="Estimated annual fee (AED)"><input className="inp w-full" type="number" min={0} name="estimatedAnnualFee" defaultValue={l?.estimatedAnnualFee ? String(l.estimatedAnnualFee) : ""} /></Field>
      <fieldset className="md:col-span-2"><span className="lbl">Service interest</span>
        <div className="flex flex-wrap gap-3">{Object.values(ServiceLine).map((s) => <label key={s} className="flex items-center gap-1"><input type="checkbox" name="serviceInterest" value={s} defaultChecked={l?.serviceInterest.includes(s)} /> {SERVICE_LABEL[s]}</label>)}</div>
      </fieldset>
      <Field label="Notes" className="md:col-span-3"><textarea className="inp w-full" rows={3} name="notes" defaultValue={l?.notes ?? ""} /></Field>
      <div className="md:col-span-3"><button className="btn btn-primary">{submit}</button></div>
    </form>
  );
}
