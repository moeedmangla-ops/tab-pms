import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { Flash, PageHead } from "@/components/ui";
import { SP } from "@/lib/web";
import { ClientForm } from "../ClientForm";
import { createAndOpen } from "../actions";

export default async function NewClient({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  requirePermission(u, "clients", "edit");
  const partners = await prisma.user.findMany({ where: { isActive: true, role: { key: { in: ["PARTNER", "MANAGING_PARTNER"] } } }, select: { id: true, name: true } });
  return (
    <>
      <PageHead title="New client" sub="Obligations are generated as soon as the client is saved." />
      <Flash sp={await searchParams} />
      <ClientForm action={createAndOpen} partners={partners} submit="Create client" />
    </>
  );
}
