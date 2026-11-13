# Connectors

TAB runs Microsoft 365, so Microsoft 365 is the primary connector. Every connector is optional: with none configured the system runs fully and Settings → Connectors shows "Not configured". Every call is recorded in `connector_log` (Settings → Connectors → Recent activity). Secrets live only in server environment variables.

| Connector | What it does | Code | Env vars |
|---|---|---|---|
| Microsoft Graph — Mail.Send | Sends reminders, escalations, digests, document requests from the shared mailbox | `src/lib/connectors/graph.ts`, `src/lib/mailer.ts` | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` + Settings → Email → Sender mailbox |
| Microsoft Graph — Mail.Read | Every 15 min, reads shared mailboxes and attaches emails to the client timeline by matching contact emails | `src/lib/connectors/mail-sync.ts` | `GRAPH_SYNC_MAILBOXES` |
| Microsoft Entra ID SSO | "Sign in with Microsoft" for existing staff accounts | `src/lib/connectors/entra.ts`, `src/app/api/auth/entra/*` | `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `APP_URL` |
| Lead webhook | Website forms, Zapier, Power Automate post enquiries straight in as assigned leads | `src/app/api/connectors/lead-webhook/route.ts` | `LEAD_WEBHOOK_SECRET` |

## 1. Microsoft 365 — sending and reading mail (app registration)

Done once by a Microsoft 365 global administrator (Entra admin centre):

1. **App registrations → New registration** — name `TAB PMS – Mail`, single tenant, no redirect URI.
2. **Certificates & secrets → New client secret** — copy the value into `GRAPH_CLIENT_SECRET`. Record its expiry date in the runbook; an expired secret stops all reminders (the job alerts administrators when that happens).
3. **API permissions → Microsoft Graph → Application permissions** — add `Mail.Send` (and `Mail.Read` if you want the Outlook timeline). Click **Grant admin consent**.
4. **Restrict the app to the compliance mailbox only** (strongly recommended — otherwise application permissions cover every mailbox in the tenant). In Exchange Online PowerShell:
   ```powershell
   New-DistributionGroup -Name "PMS-Mailboxes" -Type Security -Members compliance@tabconsultantsllc.com
   New-ApplicationAccessPolicy -AppId <GRAPH_CLIENT_ID> -PolicyScopeGroupId PMS-Mailboxes -AccessRight RestrictAccess -Description "PMS may only use the compliance mailbox"
   Test-ApplicationAccessPolicy -AppId <GRAPH_CLIENT_ID> -Identity compliance@tabconsultantsllc.com
   ```
5. Set `GRAPH_TENANT_ID` (Directory/tenant ID) and `GRAPH_CLIENT_ID` (Application/client ID).
6. In the app: **Settings → Email** → Sender mailbox `compliance@…`. Keep **Pause all outbound email** on, set **Test mode** to your own address, run **Settings → Jobs → send-reminders**, and check what arrives. Then clear test mode and un-pause.

For the Outlook timeline add the shared mailboxes to `GRAPH_SYNC_MAILBOXES` (comma-separated) and add them to the `PMS-Mailboxes` group. Only subject, participants and time are stored unless Settings → Email → "Store email body previews" is on.

## 2. Microsoft Entra ID — single sign-on

1. **App registrations → New registration** — name `TAB PMS – Sign-in`, single tenant, redirect URI (Web) `https://<APP_URL>/api/auth/entra/callback`.
2. New client secret → `ENTRA_CLIENT_SECRET`. Tenant and client IDs → `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`.
3. Delegated permissions `openid`, `profile`, `email` (default).
4. **Conditional Access**: require MFA for this app. The PMS relies on Entra's MFA for SSO users (BUILD_SPEC Section 11).
5. Staff accounts must already exist in Settings → Users with the same email; SSO never creates accounts. Keep the break-glass administrator on password + TOTP.

## 3. Website / Zapier / Power Automate → leads

```bash
curl -X POST "$APP_URL/api/connectors/lead-webhook" \
  -H "content-type: application/json" -H "x-webhook-secret: $LEAD_WEBHOOK_SECRET" \
  -d '{"name":"Jane Doe","company":"Doe Trading LLC","email":"jane@example.com","phone":"+971500000000","service":"VAT, Corporate Tax","message":"Need VAT registration"}'
```
Returns `201 {"ok":true,"id":"…"}`. The lead is assigned (Business Development, fewest open leads) with next action "First contact" on the next working day. In Zapier use "Webhooks by Zapier → POST"; in Power Automate use the HTTP action. Rate limited to 30 requests per minute per IP.

## Claude connectors used while building

The Microsoft 365 connector in Claude was used to confirm the firm's tenant domain. The CRM Connector (HubSpot / Zoho / Dynamics sync) needs re-authentication and was not used; if the firm later wants this system's leads mirrored into HubSpot or Dynamics 365, that is a backlog item, not a dependency.
