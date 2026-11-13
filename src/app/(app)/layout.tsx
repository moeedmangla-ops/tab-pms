import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { access } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const can = (a: Parameters<typeof access>[1]) => access(u, a).scope !== "none";
  const [paused, testAddr, failedJobs] = await Promise.all([
    getSetting("email.paused"),
    getSetting("email.testModeAddress"),
    prisma.jobRun.count({ where: { status: "FAILED", startedAt: { gte: new Date(Date.now() - 86_400_000) } } }),
  ]);
  const nav: [string, string, boolean][] = [
    ["/", "Dashboard", true],
    ["/work", "My work", can("obligations") || can("leads")],
    ["/obligations", "Obligations", can("obligations")],
    ["/clients", "Clients", can("clients")],
    ["/leads", "Leads", can("leads")],
    ["/reports/missing-data", "Missing data", can("clients")],
    ["/settings", "Settings", can("settings")],
    ["/audit", "Audit trail", can("audit")],
  ];
  return (
    <div className="flex min-h-screen overflow-x-clip">
      <aside className="hidden w-52 shrink-0 flex-col bg-brand-dark text-white md:flex">
        <div className="px-4 pb-4 pt-5">
          <div className="text-[15px] font-semibold tracking-tight">TAB Consultants</div>
          <div className="text-[11px] text-brand">Practice Management</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {nav.filter(([, , ok]) => ok).map(([href, label]) => (
            <Link key={href} href={href} className="block rounded px-3 py-1.5 text-[13px] text-white/85 hover:bg-white/10 hover:text-white">
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-3 text-[12px]">
          <div className="font-medium">{u.name}</div>
          <div className="text-white/60">{u.roleName}</div>
          <form action="/api/auth/logout" method="post" className="mt-2">
            <button className="text-brand hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2 md:hidden">
          <span className="font-semibold">TAB Consultants</span>
          <details className="relative">
            <summary className="btn">Menu</summary>
            <nav className="absolute right-0 z-10 mt-1 w-48 rounded border border-line bg-surface p-1 shadow">
              {nav.filter(([, , ok]) => ok).map(([href, label]) => (
                <Link key={href} href={href} className="block rounded px-3 py-1.5 hover:bg-bg">{label}</Link>
              ))}
            </nav>
          </details>
        </header>
        {(paused === "true" || testAddr || failedJobs > 0) && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line bg-[var(--amber-bg)] px-4 py-1.5 text-[12px] text-[var(--amber)]">
            {paused === "true" && <span>Outbound email is PAUSED — reminders are logged but not sent.</span>}
            {testAddr && <span>Test mode: every email is redirected to {testAddr}.</span>}
            {failedJobs > 0 && <span className="text-[var(--red)]">{failedJobs} background job run(s) failed in the last 24 hours.</span>}
            {can("settings") && <Link href="/settings" className="underline">Settings</Link>}
          </div>
        )}
        <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}
