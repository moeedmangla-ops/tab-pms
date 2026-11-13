import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/connectors/entra";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get("tab_oidc")?.value;
  jar.delete("tab_oidc");
  const fail = (m: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(m)}`, req.url));
  if (!raw) return fail("Microsoft sign-in expired. Try again.");
  const { state, verifier } = JSON.parse(raw) as { state: string; verifier: string };
  if (url.searchParams.get("state") !== state || !url.searchParams.get("code")) return fail("Microsoft sign-in was not completed.");
  try {
    const { oid, email } = await exchangeCode(url.searchParams.get("code")!, verifier);
    const u = await prisma.user.findFirst({ where: { isActive: true, OR: [{ entraObjectId: oid }, { email }] } });
    if (!u) return fail("Your Microsoft account is not set up in this system. Ask an administrator.");
    if (!u.entraObjectId) await prisma.user.update({ where: { id: u.id }, data: { entraObjectId: oid } });
    await createSession(u.id);
    return NextResponse.redirect(new URL("/", req.url));
  } catch {
    return fail("Microsoft sign-in failed.");
  }
}
