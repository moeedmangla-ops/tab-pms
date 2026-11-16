/**
 * Authentication: email + password + mandatory TOTP, or Microsoft Entra SSO
 * (Entra enforces MFA; see BUILD_SPEC Section 11). Server-side sessions in the
 * `session` table; the cookie holds only a signed session id.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { prisma } from "./db";
import { Actor } from "./permissions";
import { RoleKey } from "@prisma/client";

const COOKIE = "tab_session";
const PENDING = "tab_2fa_pending";
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars).");
  return new TextEncoder().encode(s);
}

export function sessionHours(): number {
  return Number(process.env.SESSION_TIMEOUT_HOURS ?? 8);
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? null;
}

async function sign(payload: Record<string, unknown>, minutes: number) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${minutes}m`).sign(secret());
}

export async function createSession(userId: string) {
  const expiresAt = new Date(Date.now() + sessionHours() * 3600_000);
  const s = await prisma.session.create({ data: { userId, expiresAt, ip: await clientIp() } });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
  const jar = await cookies();
  jar.set(COOKIE, await sign({ sid: s.id }, sessionHours() * 60), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    expires: expiresAt,
  });
  jar.delete(PENDING);
}

export async function destroySession() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) {
    try {
      const { payload } = await jwtVerify(t, secret());
      await prisma.session.update({ where: { id: String(payload.sid) }, data: { revokedAt: new Date() } });
    } catch {
      /* already invalid */
    }
  }
  jar.delete(COOKIE);
}

export type SessionUser = Actor & { name: string; email: string; roleName: string };

export async function currentUser(): Promise<SessionUser | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, secret());
    const s = await prisma.session.findUnique({
      where: { id: String(payload.sid) },
      include: { user: { include: { role: true, reports: { select: { id: true } } } } },
    });
    if (!s || s.revokedAt || s.expiresAt < new Date() || !s.user.isActive) return null;
    return {
      id: s.user.id,
      name: s.user.name,
      email: s.user.email,
      role: s.user.role.key,
      roleName: s.user.role.name,
      teamIds: s.user.reports.map((r) => r.id),
    };
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export type LoginResult = { ok: true; next: "totp" | "enrol" } | { ok: false; error: string };

/** Step 1: password. Never reveals whether the email exists. */
export async function verifyPassword(email: string, password: string): Promise<LoginResult> {
  const generic = { ok: false as const, error: "Email or password is incorrect." };
  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!u || !u.isActive || !u.passwordHash) {
    await bcrypt.compare(password, "$2a$12$000000000000000000000uGWDREBu6Fz5Vf5OUQSaUoV8xJ5lGJ2K"); // timing equaliser
    return generic;
  }
  if (u.lockedUntil && u.lockedUntil > new Date()) return { ok: false, error: "Account temporarily locked after repeated failures. Try again later." };
  if (!(await bcrypt.compare(password, u.passwordHash))) {
    const failed = u.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: u.id },
      data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    return generic;
  }
  (await cookies()).set(PENDING, await sign({ uid: u.id }, 10), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false" });
  return { ok: true, next: u.totpEnabled ? "totp" : "enrol" };
}

export async function pendingUserId(): Promise<string | null> {
  const t = (await cookies()).get(PENDING)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, secret());
    return String(payload.uid);
  } catch {
    return null;
  }
}

/** Step 2: TOTP code (or enrolment confirmation). */
export async function verifyTotp(code: string): Promise<{ ok: boolean; error?: string }> {
  const uid = await pendingUserId();
  if (!uid) return { ok: false, error: "Sign-in expired. Start again." };
  const u = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
  if (!u.totpSecret) return { ok: false, error: "Two-factor is not set up." };
  if (!authenticator.verify({ token: code.replace(/\s/g, ""), secret: u.totpSecret })) {
    const failed = u.failedLoginCount + 1;
    await prisma.user.update({ where: { id: u.id }, data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
    return { ok: false, error: "Code is incorrect." };
  }
  if (!u.totpEnabled) await prisma.user.update({ where: { id: u.id }, data: { totpEnabled: true } });
  await createSession(u.id);
  return { ok: true };
}

export async function ensureTotpSecret(uid: string): Promise<{ secret: string; uri: string }> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
  let s = u.totpSecret;
  if (!s || u.totpEnabled === false) {
    s = s ?? authenticator.generateSecret();
    await prisma.user.update({ where: { id: uid }, data: { totpSecret: s } });
  }
  return { secret: s, uri: authenticator.keyuri(u.email, "TAB Consultants PMS", s) };
}

export function hashPassword(p: string) {
  return bcrypt.hash(p, 12);
}

export type { RoleKey };
