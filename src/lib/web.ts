import "server-only";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { isForbidden } from "./permissions";
import { isValidation } from "./services/obligations";

export type SP = Promise<Record<string, string | string[] | undefined>>;

export function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "" ? undefined : s;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  if (isValidation(e) || isForbidden(e)) return e.message;
  if (e && typeof e === "object" && (e as Error).name === "ZodError") return (e as ZodError).issues.map((i) => i.message).join("; ");
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return "A record with that value already exists.";
    return `Database rejected the change (${e.code}).`;
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError && /check constraint/i.test(e.message)) return "The database rejected this change: a required field for that status is missing.";
  console.error(JSON.stringify({ level: "error", event: "action_failed", message: e instanceof Error ? e.message : String(e) }));
  return "Something went wrong. The error has been logged.";
}

function withParam(url: string, k: string, v: string) {
  const u = new URL(url, "http://x");
  u.searchParams.delete("error");
  u.searchParams.delete("ok");
  u.searchParams.set(k, v);
  return u.pathname + u.search;
}

/** Run a mutation from a server action; on failure, return to `back` with ?error=. */
export async function act(back: string, fn: () => Promise<unknown>, okMessage?: string, next?: string): Promise<never> {
  let err: string | null = null;
  try {
    await fn();
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    err = errorMessage(e);
  }
  if (err) redirect(withParam(back, "error", err));
  redirect(okMessage ? withParam(next ?? back, "ok", okMessage) : (next ?? back));
}

export function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}

export function qs(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
