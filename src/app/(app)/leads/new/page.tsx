import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { Flash, PageHead } from "@/components/ui";
import { SP } from "@/lib/web";
import { LeadForm } from "../LeadForm";
import { create } from "../actions";

export default async function NewLead({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  requirePermission(u, "leads", "edit");
  const owners = await prisma.user.findMany({ where: { isActive: true, role: { key: { not: "READ_ONLY" } } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (<><PageHead title="New lead" sub="Every lead has an owner and a next-action date." /><Flash sp={await searchParams} /><LeadForm action={create} owners={owners} defaultOwner={u.id} submit="Create lead" /></>);
}
