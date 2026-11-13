/**
 * Connector: Microsoft Entra ID single sign-on (OIDC authorisation-code flow + PKCE).
 * Disabled unless ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET are set.
 * Only users who already exist (matched on email or Entra object id) may sign in;
 * SSO never creates accounts.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { logConnector } from "./log";

export function entraEnabled() {
  return Boolean(process.env.ENTRA_TENANT_ID && process.env.ENTRA_CLIENT_ID && process.env.ENTRA_CLIENT_SECRET);
}

const base = () => `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}`;
const redirectUri = () => `${process.env.APP_URL}/api/auth/entra/callback`;

export function authorizeUrl(state: string, codeChallenge: string) {
  const p = new URLSearchParams({
    client_id: process.env.ENTRA_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: "openid profile email",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${base()}/oauth2/v2.0/authorize?${p}`;
}

export async function exchangeCode(code: string, verifier: string): Promise<{ oid: string; email: string }> {
  const res = await fetch(`${base()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ENTRA_CLIENT_ID!,
      client_secret: process.env.ENTRA_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    await logConnector("entra-sso", "INBOUND", "ERROR", `token exchange ${res.status}`);
    throw new Error("Microsoft sign-in failed.");
  }
  const { id_token } = (await res.json()) as { id_token: string };
  const jwks = createRemoteJWKSet(new URL(`${base()}/discovery/v2.0/keys`));
  const { payload } = await jwtVerify(id_token, jwks, { audience: process.env.ENTRA_CLIENT_ID, issuer: `${base()}/v2.0` });
  await logConnector("entra-sso", "INBOUND", "OK", "sign-in");
  return { oid: String(payload.oid), email: String(payload.preferred_username ?? payload.email ?? "").toLowerCase() };
}
