import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { getClientForActor } from "@/lib/services/clients";
import { Flash, PageHead } from "@/components/ui";
import { SP } from "@/lib/web";
import { ClientForm } from "../../ClientForm";
import { update } from "../../actions";

export default async function EditClient({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser();
  requirePermission(u, "clients", "edit");
  const { id } = await params;
  const c = await getClientForActor(u, id);
  const t = await prisma.clientTaxProfile.findUnique({ where: { clientId: id } });
  const partners = await prisma.user.findMany({ where: { isActive: true, role: { key: { in: ["PARTNER", "MANAGING_PARTNER"] } } }, select: { id: true, name: true } });
  return (
    <>
      <PageHead title={`Edit — ${c.legalName}`} sub="Changing the year-end or VAT frequency flags future obligations for review; filed and past ones are never changed." />
      <Flash sp={await searchParams} />
      <ClientForm action={update} c={c} t={t} partners={partners} submit="Save changes" />
    </>
  );
}
