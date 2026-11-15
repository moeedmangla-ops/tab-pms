# Session report — 15 Nov 2026 (updated)

**15 Nov:** container restarted; database, web app and worker brought back up. Health `ok` once the reminder job ran. Browser suite 29/29 against the live app. Operating guide added (`docs/operating-guide.html`). Microsoft 365: the user's own account is connected to Claude (Mail.Send, Mail.Read.Shared, People.Read confirmed; tenant `tabconsultantsllc.com`); no `compliance@` shared mailbox surfaced in a people search; the application-level Graph app registration is still an admin step.

## 13 Nov

Scope delivered: **Foundation + Phase 1 (clients, deadlines, reminders)** in full, plus the **CRM core of Phase 2** (lead pipeline, communication log and timeline, Outlook sync connector, basic tasks, personal work queue), with Microsoft 365 as the connector layer. Phases 3 and 4 are schema-only.

## Verified
| Check | Result |
|---|---|
| Unit tests (`npm test`) — calendar, periods, due dates, workflow, reminders, permissions, CSV | 25/25 pass |
| Phase 1 acceptance (`npm run test:acceptance`, BUILD_SPEC §12) against Postgres | 26/26 pass |
| Browser end-to-end (`npm run test:e2e`) — login with 2FA, every view, inline status, exports, role isolation, phone width | 29/29 pass |
| Load test at 12,600 clients / 203,188 obligations — every list query | median 3–175 ms (limit 500 ms) |
| Nightly generation at 12,600 clients | 54 s, idempotent re-run creates 0 |
| `npm run typecheck`, `npm run build` | clean |

Acceptance items from §12 covered by the script: import of 1,500 rows with 3 duplicates and 5 bad rows caught; 31 March year-end + quarterly VAT generates correct VAT and CT obligations for 18 months; year-end change flags future obligations and leaves past/filed ones untouched; every status step recorded with who and when; reminder 7 days out sends once, re-run sends nothing; prep-deadline escalation reaches the manager; 08:00 GST digest; Friday public holiday moves the internal target to Thursday; database refuses Submitted without a reference; audit log cannot be deleted.

## Built
- Database: every Section 5 table, plus `job_run`, `connector_log`, `app_setting`, `obligation_type_setting`. DB-level constraints: unique live obligation per client/type/period, unique VAT TRN, unique invoice number, Submitted requires a reference, Completed requires payment or waiver, On Hold / Lost / Cancelled require reasons, append-only audit log and status history, hard DELETE blocked on client/obligation/invoice/document.
- Auth: email + password with mandatory TOTP enrolment, lockout after 5 failures, revocable server sessions (8 h), Microsoft Entra SSO.
- Permissions: Section 10 matrix (incl. Audit Staff and Leads) enforced on the server with row-level filters; tested per role.
- Deadline engine: versioned effective-dated rules, VAT periods from a per-client anchor, any year-end, statutory vs internal target vs prep vs review dates, UAE weekend + holiday table, missing-data exceptions, review flagging on year-end/frequency change, manual override with reason, reviewer confirmation.
- Obligation workspace: My work / My team / Whole firm; list, kanban, month calendar, year grid; all filters; colour coding; inline status; bulk assign / status / client document request.
- Reminders: preparer, reviewer, manager escalation, partner escalation, client documents / approval / payment tracks; overdue every 2 days; dedupe key claimed before every send; leave cover; 08:00 GST digest; Monday partner summary; global pause; test-mode redirect; full log on each obligation.
- Clients: create / edit / archive, search across name/code/TRN/CT/licence/contact email/mobile, all filters, Excel/CSV import (mapping, dry run, per-row errors, duplicates), Excel export of the filtered view, nine-tab profile, bulk reassignment, stop-work flag.
- CRM (Phase 2 core): lead pipeline with mandatory owner and next-action date, "needs attention", owner reminders, response-time clock, weighted pipeline, source report, conversion to client with services → obligations, website/Zapier/Power Automate webhook, communication log, unified client timeline, Outlook → timeline sync, tasks on the client, "My work" queue.
- Operations: durable pg-boss queue, job run records, failure alerts, `/api/health`, settings for rules / reminders / templates / holidays / users / email / jobs / connectors, audit trail screen with CSV export.

## Stubbed or partial — not complete
- **Documents tab** shows a "Phase 4, not built" notice. No file storage yet, so the identity-document field protection has nothing to protect.
- **Tasks**: create / assign / complete only. No recurrence generator, dependency UI, checklist / attachment / comment UI, or overdue-task escalation job (schema supports them).
- **Client inactivity flag** (90 days): the setting exists; the dashboard card does not.
- **Digest and partner-summary text** is built in code, not an editable template (the obligation reminder templates are editable).
- **Webhook rate limit** is per process (in memory).

## Not wired / not verified here
- **Microsoft Graph mail send and Outlook sync, and Entra SSO**: written to the documented Graph/OIDC APIs but **not run against your tenant** (no app registration or credentials in this environment). Tests used the console mail transport. Follow `docs/CONNECTORS.md`, then run send-reminders in test mode.
- **Docker image and Compose**: written but not built here (no Docker daemon in this environment). Tested with a local PostgreSQL 16 instead.
- **Phase 3 (invoicing, collections)** and **Phase 4 (documents, reporting, executive dashboard)**: tables exist, no screens or jobs.
- **Backups / restore, error tracking service**: documented in `docs/RUNBOOK.md`, not configured.
- **Lead stage list and weights** are fixed in code (configurable later — see BACKLOG.md).
