import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { clientWhere } from "@/lib/permissions";
import { missingDataReport } from "@/lib/engine/generate";
import { PageHead } from "@/components/ui";
import { prisma } from "@/lib/db";

export default async function MissingData() {
  const u = await requireUser();
  const visible = new Set((await prisma.client.findMany({ where: clientWhere(u), select: { id: true } })).map((c) => c.id));
  const rows = (await missingDataReport()).filter((r) => visible.has(r.clientId));
  return (
    <>
      <PageHead title="Missing data for deadlines" sub="No deadlines are generated for these items until the data is fixed. The system never guesses a year-end." />
      <section className="card overflow-hidden">
        <table className="tbl">
          <thead><tr><th>Client</th><th>Code</th><th>Problem</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}><td>{r.legalName}</td><td className="font-mono">{r.clientCode}</td><td>{r.issue}</td><td><Link href={`/clients/${r.clientId}/edit`}>Fix</Link></td></tr>)}
            {rows.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted">Every active client has the data its deadlines need.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
