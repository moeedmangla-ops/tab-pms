import { Client, ClientTaxProfile, EntityType, ClientStatus, FilingFrequency } from "@prisma/client";
import { fromDbDate } from "@/lib/dates";
import { Field } from "@/components/ui";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const d = (v: Date | null | undefined) => (v ? fromDbDate(v) : "");

export function ClientForm({ action, c, t, partners, submit }: { action: (fd: FormData) => Promise<void>; c?: Client; t?: ClientTaxProfile | null; partners: { id: string; name: string }[]; submit: string }) {
  return (
    <form action={action} className="space-y-4">
      {c && <input type="hidden" name="id" value={c.id} />}
      <section className="card grid gap-3 p-4 md:grid-cols-3">
        <h2 className="h2 md:col-span-3">Entity</h2>
        <Field label="Client code *"><input className="inp w-full" name="clientCode" required defaultValue={c?.clientCode} /></Field>
        <Field label="Legal name *" className="md:col-span-2"><input className="inp w-full" name="legalName" required defaultValue={c?.legalName} /></Field>
        <Field label="Trade name"><input className="inp w-full" name="tradeName" defaultValue={c?.tradeName ?? ""} /></Field>
        <Field label="Entity type"><select className="sel w-full" name="entityType" defaultValue={c?.entityType ?? "LLC"}>{Object.values(EntityType).map((e) => <option key={e} value={e}>{e.replace(/_/g, " ").toLowerCase()}</option>)}</select></Field>
        <Field label="Status"><select className="sel w-full" name="status" defaultValue={c?.status ?? "ACTIVE"}>{Object.values(ClientStatus).map((e) => <option key={e} value={e}>{e.replace(/_/g, " ").toLowerCase()}</option>)}</select></Field>
        <Field label="Licence number"><input className="inp w-full" name="licenceNumber" defaultValue={c?.licenceNumber ?? ""} /></Field>
        <Field label="Licensing authority"><input className="inp w-full" name="licenceAuthority" defaultValue={c?.licenceAuthority ?? ""} /></Field>
        <Field label="Licence expiry"><input className="inp w-full" type="date" name="licenceExpiry" defaultValue={d(c?.licenceExpiry)} /></Field>
        <Field label="Emirate"><select className="sel w-full" name="emirate" defaultValue={c?.emirate ?? ""}><option value="">—</option>{["Abu Dhabi","Dubai","Sharjah","Ajman","Umm Al Quwain","Ras Al Khaimah","Fujairah"].map((e) => <option key={e}>{e}</option>)}</select></Field>
        <Field label="Industry"><input className="inp w-full" name="industry" defaultValue={c?.industry ?? ""} /></Field>
        <Field label="Relationship partner"><select className="sel w-full" name="relationshipPartnerId" defaultValue={c?.relationshipPartnerId ?? ""}><option value="">—</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Financial year-end — day"><input className="inp w-full" type="number" min={1} max={31} name="fyEndDay" defaultValue={c?.fyEndDay ?? ""} /></Field>
        <Field label="Financial year-end — month"><select className="sel w-full" name="fyEndMonth" defaultValue={c?.fyEndMonth ?? ""}><option value="">Unknown — no CT deadlines generated</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
      </section>
      <section className="card grid gap-3 p-4 md:grid-cols-3">
        <h2 className="h2 md:col-span-3">Tax profile</h2>
        <Field label="VAT TRN (15 digits)"><input className="inp w-full font-mono" name="vatTrn" pattern="\d{15}" defaultValue={t?.vatTrn ?? ""} /></Field>
        <Field label="VAT filing frequency"><select className="sel w-full" name="vatFrequency" defaultValue={t?.vatFrequency ?? "NOT_REGISTERED"}>{Object.values(FilingFrequency).map((e) => <option key={e} value={e}>{e.replace(/_/g, " ").toLowerCase()}</option>)}</select></Field>
        <Field label="VAT period anchor (first day of any period)"><input className="inp w-full" type="date" name="vatPeriodAnchor" defaultValue={d(t?.vatPeriodAnchor)} /></Field>
        <Field label="VAT effective date"><input className="inp w-full" type="date" name="vatEffectiveDate" defaultValue={d(t?.vatEffectiveDate)} /></Field>
        <Field label="CT registration number"><input className="inp w-full font-mono" name="ctRegistrationNo" defaultValue={t?.ctRegistrationNo ?? ""} /></Field>
        <Field label="First CT period start"><input className="inp w-full" type="date" name="ctFirstPeriodStart" defaultValue={d(t?.ctFirstPeriodStart)} /></Field>
        <div className="flex flex-wrap gap-4 md:col-span-3">
          <label className="flex items-center gap-2"><input type="checkbox" name="ctRegistered" defaultChecked={t?.ctRegistered ?? false} /> Registered for Corporate Tax</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="freeZone" defaultChecked={t?.freeZone ?? false} /> Free zone person</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="qfzpStatus" defaultChecked={t?.qfzpStatus ?? false} /> Qualifying Free Zone Person</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="smallBusinessRelief" defaultChecked={t?.smallBusinessRelief ?? false} /> Small Business Relief</label>
        </div>
      </section>
      <section className="card p-4">
        <Field label="Notes"><textarea className="inp w-full" rows={3} name="notes" defaultValue={c?.notes ?? ""} /></Field>
      </section>
      <button className="btn btn-primary">{submit}</button>
    </form>
  );
}
