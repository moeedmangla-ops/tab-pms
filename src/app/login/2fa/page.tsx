import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { ensureTotpSecret, pendingUserId, verifyTotp } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SP, one, str } from "@/lib/web";

async function submit(fd: FormData) {
  "use server";
  const r = await verifyTotp(str(fd, "code"));
  if (!r.ok) redirect(`/login/2fa?error=${encodeURIComponent(r.error ?? "Invalid code")}`);
  redirect("/");
}

export default async function TwoFactor({ searchParams }: { searchParams: SP }) {
  const uid = await pendingUserId();
  if (!uid) redirect("/login?error=Sign-in%20expired.%20Start%20again.");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
  const sp = await searchParams;
  const enrol = !u.totpEnabled;
  let qr = "";
  let secret = "";
  if (enrol) {
    const t = await ensureTotpSecret(uid);
    secret = t.secret;
    qr = await QRCode.toDataURL(t.uri, { margin: 1, width: 180 });
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-dark px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="h2 mb-1">{enrol ? "Set up two-factor authentication" : "Two-factor authentication"}</h1>
        <p className="mb-4 text-muted">{enrol ? "Two-factor is mandatory. Scan this code with Microsoft Authenticator (or any TOTP app), then enter the 6-digit code." : "Enter the 6-digit code from your authenticator app."}</p>
        {one(sp.error) && <div className="err mb-3" role="alert">{one(sp.error)}</div>}
        {enrol && (
          <div className="mb-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Two-factor QR code" className="mx-auto" width={180} height={180} />
            <div className="mt-2 break-all font-mono text-[11px] text-muted">{secret}</div>
          </div>
        )}
        <form action={submit} className="space-y-3">
          <input className="inp w-full text-center font-mono text-lg tracking-[0.3em]" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required autoFocus aria-label="Authentication code" />
          <button className="btn btn-primary w-full justify-center">Verify</button>
        </form>
      </div>
    </main>
  );
}
