import Link from "next/link";
import { ObligationStatus } from "@prisma/client";
import { STATUS_LABEL, Tone } from "@/lib/engine/workflow";

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const e = typeof sp.error === "string" ? sp.error : undefined;
  const o = typeof sp.ok === "string" ? sp.ok : undefined;
  if (!e && !o) return null;
  return <div className={`${e ? "err" : "ok"} mb-3`} role={e ? "alert" : "status"}>{e ?? o}</div>;
}

export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="h1">{title}</h1>
        {sub && <div className="mt-0.5 text-muted">{sub}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function StatusChip({ status, tone, overdue }: { status: ObligationStatus; tone: Tone; overdue?: boolean }) {
  return (
    <span className={`chip t-${tone}`}>
      {overdue ? "Overdue · " : ""}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Pager({ total, page, pageSize, href }: { total: number; page: number; pageSize: number; href: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  return (
    <div className="flex items-center justify-between border-t border-line px-3 py-2 text-muted">
      <span>
        {from}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
      </span>
      <span className="flex gap-2">
        {page > 1 ? <Link className="btn" href={href(page - 1)}>Previous</Link> : <span className="btn opacity-40">Previous</span>}
        <span className="self-center">Page {page} of {pages}</span>
        {page < pages ? <Link className="btn" href={href(page + 1)}>Next</Link> : <span className="btn opacity-40">Next</span>}
      </span>
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="lbl">{label}</span>
      {children}
    </label>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-muted">{children}</div>;
}

export function Stat({ label, value, href, tone }: { label: string; value: number | string; href: string; tone?: Tone }) {
  return (
    <Link href={href} className={`card block px-4 py-3 hover:border-brand bar-${tone ?? "none"}`}>
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "red" ? "text-[var(--red)]" : tone === "amber" ? "text-[var(--amber)]" : ""}`}>{value}</div>
    </Link>
  );
}

export const SERVICE_LABEL: Record<string, string> = {
  VAT: "VAT",
  CORPORATE_TAX: "Corporate Tax",
  BOOKKEEPING: "Bookkeeping",
  AUDIT: "Audit",
  TRANSFER_PRICING: "Transfer Pricing",
  TAX_ADVISORY: "Tax Advisory",
  BUSINESS_SETUP: "Business Setup",
  OUTSOURCED_CFO: "Outsourced CFO",
};

export const TYPE_LABEL: Record<string, string> = {
  VAT_RETURN: "VAT return",
  CT_RETURN: "CT return",
  TRADE_LICENCE_RENEWAL: "Licence renewal",
  ENGAGEMENT_RENEWAL: "Engagement renewal",
  AUDIT_REPORT: "Audit report",
  TP_LOCAL_FILE: "TP Local File",
  TAX_PAYMENT: "Tax payment",
  DOCUMENT_EXPIRY: "Document renewal",
  OTHER: "Other",
};

export const LEAD_STAGE_LABEL: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  PROPOSAL_SENT: "Proposal Sent",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

export const SOURCE_LABEL: Record<string, string> = {
  WEBSITE_FORM: "Website form",
  REFERRAL: "Referral",
  BNI: "BNI",
  LINKEDIN: "LinkedIn",
  WALK_IN: "Walk-in",
  FREE_ZONE_REFERRAL: "Free zone referral",
  EXISTING_CLIENT: "Existing client",
  OTHER: "Other",
};

export function aed(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return `AED ${Number(v).toLocaleString("en-AE", { maximumFractionDigits: 0 })}`;
}
