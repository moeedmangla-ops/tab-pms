import { redirect } from "next/navigation";
import { verifyPassword, currentUser } from "@/lib/auth";
import { entraEnabled } from "@/lib/connectors/entra";
import { SP, one, str } from "@/lib/web";

async function login(fd: FormData) {
  "use server";
  const r = await verifyPassword(str(fd, "email"), String(fd.get("password") ?? ""));
  if (!r.ok) redirect(`/login?error=${encodeURIComponent(r.error)}`);
  redirect("/login/2fa");
}

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  if (await currentUser()) redirect("/");
  const sp = await searchParams;
  const error = one(sp.error);
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-dark px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="text-xl font-semibold tracking-tight">TAB Consultants</div>
          <div className="text-[12px] text-brand">Where Strategy Drives Measurable Growth</div>
        </div>
        <div className="card p-6">
          <h1 className="h2 mb-4">Sign in to Practice Management</h1>
          {error && <div className="err mb-3" role="alert">{error}</div>}
          {entraEnabled() && (
            <>
              <a href="/api/auth/entra/start" className="btn btn-primary w-full justify-center">Sign in with Microsoft</a>
              <div className="my-4 text-center text-[11px] text-muted">or with email and password (two-factor required)</div>
            </>
          )}
          <form action={login} className="space-y-3">
            <label className="block"><span className="lbl">Email</span><input className="inp w-full" name="email" type="email" autoComplete="username" required /></label>
            <label className="block"><span className="lbl">Password</span><input className="inp w-full" name="password" type="password" autoComplete="current-password" required /></label>
            <button className="btn btn-primary w-full justify-center">Continue</button>
          </form>
        </div>
      </div>
    </main>
  );
}
