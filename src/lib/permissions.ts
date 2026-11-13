/**
 * Role → permission matrix (BUILD_SPEC Section 10). This is the single source;
 * the seed copies it into the role/permission tables. Every server action and
 * route handler calls `requirePermission` — hiding a menu item is not access control.
 */
import { Prisma, RoleKey } from "@prisma/client";

export type Scope = "all" | "team" | "assigned" | "own" | "none";
export type Area = "clients" | "obligations" | "invoices" | "collections" | "settings" | "leads" | "audit";
export type Access = { scope: Scope; edit: boolean; approve?: boolean };

const A = (scope: Scope, edit: boolean, approve = false): Access => ({ scope, edit, approve });
const NONE = A("none", false);

export const MATRIX: Record<RoleKey, Record<Area, Access>> = {
  MANAGING_PARTNER: { clients: A("all", true), obligations: A("all", true), invoices: A("all", true, true), collections: A("all", true), settings: A("all", true), leads: A("all", true), audit: A("all", false) },
  PARTNER: { clients: A("all", true), obligations: A("all", true), invoices: A("own", true, true), collections: A("own", true), settings: A("all", false), leads: A("all", false), audit: A("all", false) },
  MANAGER: { clients: A("assigned", true), obligations: A("team", true), invoices: A("assigned", true), collections: A("assigned", true), settings: NONE, leads: A("own", true), audit: NONE },
  SENIOR_ACCOUNTANT: { clients: A("assigned", true), obligations: A("assigned", true), invoices: A("assigned", true), collections: NONE, settings: NONE, leads: A("own", true), audit: NONE },
  ACCOUNTANT: { clients: A("assigned", true), obligations: A("assigned", true), invoices: A("assigned", true), collections: NONE, settings: NONE, leads: A("own", true), audit: NONE },
  TAX_CONSULTANT: { clients: A("assigned", true), obligations: A("assigned", true), invoices: A("assigned", true), collections: NONE, settings: NONE, leads: A("own", true), audit: NONE },
  AUDIT_STAFF: { clients: A("assigned", false), obligations: A("assigned", true), invoices: NONE, collections: NONE, settings: NONE, leads: A("own", true), audit: NONE },
  BUSINESS_DEVELOPMENT: { clients: NONE, obligations: NONE, invoices: NONE, collections: NONE, settings: NONE, leads: A("all", true), audit: NONE },
  ADMINISTRATOR: { clients: A("all", true), obligations: A("all", true), invoices: A("all", true), collections: A("all", true), settings: A("all", true), leads: A("all", true), audit: A("all", false) },
  READ_ONLY: { clients: A("all", false), obligations: A("all", false), invoices: A("all", false), collections: A("all", false), settings: NONE, leads: A("all", false), audit: NONE },
};

export const ROLE_LABEL: Record<RoleKey, string> = {
  MANAGING_PARTNER: "Managing Partner",
  PARTNER: "Partner",
  MANAGER: "Manager",
  SENIOR_ACCOUNTANT: "Senior Accountant",
  ACCOUNTANT: "Accountant",
  TAX_CONSULTANT: "Tax Consultant",
  AUDIT_STAFF: "Audit Staff",
  BUSINESS_DEVELOPMENT: "Business Development",
  ADMINISTRATOR: "Administrator",
  READ_ONLY: "Read-only",
};

export const AUDIT_OBLIGATION_TYPES = ["AUDIT_REPORT"] as const;

export type Actor = { id: string; role: RoleKey; teamIds: string[] };

export class ForbiddenError extends Error {
  readonly name = "ForbiddenError";
  constructor(msg = "You do not have permission for this action.") {
    super(msg);
  }
}

/** Name-based checks survive module duplication in bundled server code (instanceof does not). */
export const isForbidden = (e: unknown): e is ForbiddenError => !!e && typeof e === "object" && (e as Error).name === "ForbiddenError";

export function access(actor: Actor, area: Area): Access {
  return MATRIX[actor.role][area];
}

export function requirePermission(actor: Actor, area: Area, mode: "view" | "edit" | "approve" = "view"): Access {
  const a = access(actor, area);
  if (a.scope === "none") throw new ForbiddenError();
  if (mode === "edit" && !a.edit) throw new ForbiddenError();
  if (mode === "approve" && !a.approve) throw new ForbiddenError();
  return a;
}

/** Users whose assignments count for this actor ("assigned" = self; "team" = self + reports). */
function people(actor: Actor, scope: Scope): string[] {
  return scope === "team" ? [actor.id, ...actor.teamIds] : [actor.id];
}

/** Row filter for clients the actor may see. */
export function clientWhere(actor: Actor): Prisma.ClientWhereInput {
  const a = requirePermission(actor, "clients");
  if (a.scope === "all") return {};
  const ids = people(actor, a.scope);
  return {
    OR: [
      { relationshipPartnerId: { in: ids } },
      { engagements: { some: { isActive: true, OR: [{ partnerId: { in: ids } }, { managerId: { in: ids } }, { preparerId: { in: ids } }] } } },
      { obligations: { some: { deletedAt: null, OR: [{ preparerId: { in: ids } }, { reviewerId: { in: ids } }] } } },
    ],
  };
}

/** Row filter for obligations the actor may see. */
export function obligationWhere(actor: Actor): Prisma.ObligationWhereInput {
  const a = requirePermission(actor, "obligations");
  if (a.scope === "all") return {};
  const ids = people(actor, a.scope);
  const base: Prisma.ObligationWhereInput = {
    OR: [
      { preparerId: { in: ids } },
      { reviewerId: { in: ids } },
      { engagement: { OR: [{ managerId: { in: ids } }, { partnerId: { in: ids } }] } },
    ],
  };
  if (actor.role === "AUDIT_STAFF") return { AND: [base, { type: { in: [...AUDIT_OBLIGATION_TYPES] } }] };
  return base;
}

export function leadWhere(actor: Actor): Prisma.LeadWhereInput {
  const a = requirePermission(actor, "leads");
  return a.scope === "all" ? {} : { ownerId: actor.id };
}

export function canEditLead(actor: Actor, ownerId: string): boolean {
  const role = actor.role;
  if (role === "MANAGING_PARTNER" || role === "ADMINISTRATOR" || role === "BUSINESS_DEVELOPMENT") return true;
  if (role === "READ_ONLY") return false;
  return ownerId === actor.id;
}

export const SENSITIVE_DOC_ROLES: RoleKey[] = ["MANAGING_PARTNER", "PARTNER", "ADMINISTRATOR", "MANAGER"];
