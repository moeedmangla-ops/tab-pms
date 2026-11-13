import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireUser, clientIp } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { IMPORT_FIELDS, Mapping, Parsed, autoMap, commitImport, dryRun, parseFile } from "@/lib/services/import";
import { Flash, PageHead } from "@/components/ui";
import { SP, one, errorMessage } from "@/lib/web";

async function upload(fd: FormData) {
  "use server";
  const u = await requireUser();
  requirePermission(u, "clients", "edit");
  const f = fd.get("file") as File | null;
  if (!f || f.size === 0) redirect("/clients/import?error=Choose%20a%20file");
  let parsed: Parsed;
  try {
    parsed = await parseFile(f.name, Buffer.from(await f.arrayBuffer()));
  } catch (e) {
    redirect(`/clients/import?error=${encodeURIComponent("Could not read the file: " + (e instanceof Error ? e.message : ""))}`);
  }
  if (!parsed.rows.length) redirect("/clients/import?error=The%20file%20has%20no%20data%20rows");
  const token = randomUUID();
  await prisma.appSetting.create({ data: { key: `import.${u.id}.${token}`, value: JSON.stringify(parsed) } });
  const m = autoMap(parsed.headers);
  redirect(`/clients/import?token=${token}&${new URLSearchParams(m as Record<string, string>)}`);
}

async function commit(fd: FormData) {
  "use server";
  const u = await requireUser();
  const token = String(fd.get("token"));
  const key = `import.${u.id}.${token}`;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) redirect("/clients/import?error=Import%20session%20expired.%20Upload%20again.");
  const mapping: Mapping = {};
  for (const f of IMPORT_FIELDS) { const v = String(fd.get(f.key) ?? ""); if (v) mapping[f.key] = v; }
  let msg = "";
  try {
    const r = await commitImport(u, JSON.parse(row.value) as Parsed, mapping, await clientIp());
    msg = `Imported ${r.imported} client(s); ${r.rejected} row(s) rejected; ${r.obligationsCreated} obligation(s) generated.`;
    await prisma.appSetting.delete({ where: { key } });
  } catch (e) {
    redirect(`/clients/import?token=${token}&error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/clients?ok=${encodeURIComponent(msg)}`);
}

export default async function ImportPage({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  requirePermission(u, "clients", "edit");
  const sp = await searchParams;
  const token = one(sp.token);
  if (!token) {
    return (
      <>
        <PageHead title="Import clients" sub="Excel (.xlsx) or CSV. You map the columns and see a dry run before anything is saved." />
        <Flash sp={sp} />
        <form action={upload} className="card max-w-xl space-y-3 p-4">
          <input type="file" name="file" accept=".xlsx,.csv" required aria-label="File" />
          <p className="text-muted">Recognised fields: {IMPORT_FIELDS.map((f) => f.label).join(" · ")}. Dates as YYYY-MM-DD or DD/MM/YYYY. Duplicates are detected on VAT TRN, licence number and client code — in the file and against existing clients.</p>
          <button className="btn btn-primary">Upload and map columns</button>
        </form>
      </>
    );
  }
  const row = await prisma.appSetting.findUnique({ where: { key: `import.${u.id}.${token}` } });
  if (!row) redirect("/clients/import?error=Import%20session%20expired.%20Upload%20again.");
  const parsed = JSON.parse(row.value) as Parsed;
  const mapping: Mapping = {};
  for (const f of IMPORT_FIELDS) { const v = one(sp[f.key]); if (v) mapping[f.key] = v; }
  const dr = await dryRun(parsed, mapping);
  const problems = dr.results.filter((r) => !r.ok);
  return (
    <>
      <PageHead title="Import clients — map and check" sub={`${parsed.rows.length} data row(s) read. Nothing is saved until you import.`}>
        <Link className="btn" href="/clients/import">Start again</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-3">
        <form method="get" className="card space-y-2 p-4" id="mapping">
          <h2 className="h2">Column mapping</h2>
          <input type="hidden" name="token" value={token} />
          {IMPORT_FIELDS.map((f) => (
            <label key={f.key} className="grid grid-cols-2 items-center gap-2">
              <span className="text-[12px]">{f.label}{"required" in f && f.required ? " *" : ""}</span>
              <select className="sel" name={f.key} defaultValue={mapping[f.key] ?? ""}>
                <option value="">— not imported —</option>
                {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
          ))}
          <button className="btn">Re-run dry run</button>
        </form>
        <section className="lg:col-span-2">
          <div className="mb-3 grid grid-cols-3 gap-3">
            <div className="card p-3"><div className="lbl">Valid — will import</div><div className="text-2xl font-semibold text-[var(--green)]">{dr.valid}</div></div>
            <div className="card p-3"><div className="lbl">Invalid rows</div><div className="text-2xl font-semibold text-[var(--red)]">{dr.invalid}</div></div>
            <div className="card p-3"><div className="lbl">Duplicates</div><div className="text-2xl font-semibold text-[var(--amber)]">{dr.duplicates}</div></div>
          </div>
          <form action={commit} className="mb-3">
            <input type="hidden" name="token" value={token} />
            {IMPORT_FIELDS.map((f) => <input key={f.key} type="hidden" name={f.key} value={mapping[f.key] ?? ""} />)}
            <button className="btn btn-primary" disabled={dr.valid === 0}>Import {dr.valid} valid row(s)</button>
          </form>
          <div className="card overflow-hidden">
            <h2 className="h2 border-b border-line px-3 py-2">Rows that will not be imported</h2>
            <div className="max-h-[520px] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Row</th><th>Problem</th></tr></thead>
                <tbody>
                  {problems.map((r) => (
                    <tr key={r.row}><td className="tabular-nums">{r.row}</td><td>{r.duplicate && <span className="chip t-amber mr-1">Duplicate</span>}{r.duplicate}{r.errors.length > 0 && <span className="text-[var(--red)]"> {r.errors.join("; ")}</span>}</td></tr>
                  ))}
                  {problems.length === 0 && <tr><td colSpan={2} className="py-6 text-center text-muted">Every row is valid.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
