import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes, createHash } from "node:crypto";
import { authorizeUrl, entraEnabled } from "@/lib/connectors/entra";

export async function GET(req: Request) {
  if (!entraEnabled()) return NextResponse.redirect(new URL("/login?error=Microsoft%20sign-in%20is%20not%20configured", req.url));
  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  (await cookies()).set("tab_oidc", JSON.stringify({ state, verifier }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false" });
  return NextResponse.redirect(authorizeUrl(state, challenge));
}
