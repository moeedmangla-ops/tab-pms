# Assumptions

Professional defaults chosen where the spec was silent. Change any of these by editing the code or settings noted.

| # | Area | Assumption | Where to change |
|---|------|------------|-----------------|
| 1 | Brand | Teal/navy palette from the spec (#43C6AE, #2E333D, #0C1E31, #159BB5). Navy-and-gold is a one-file change. | `src/app/globals.css` `:root` tokens |
| 2 | Hosting | UAE region (Azure UAE North) as the default target, since the firm already uses Microsoft 365. Not yet decided by the firm. | `docs/RUNBOOK.md` |
| 3 | Email identity | Client reminders and staff digests are sent from one shared mailbox (e.g. compliance@). | Settings → Email → Sender mailbox |
| 4 | Jurisdictions | UAE only at launch. `jurisdiction` exists on client, deadline_rule and holiday so Kuwait/Pakistan are data, not code. | Deadline rules / holidays per jurisdiction |
| 5 | Dates | Due dates are calendar dates (Postgres `DATE`) in Asia/Dubai; all timestamps are UTC `timestamptz`. | `src/lib/dates.ts` |
| 6 | Generation window | Obligations whose **statutory due date** is from 6 months ago to 18 months ahead. Periods are scanned 24 months back so long-lead obligations (CT, 9 months) are not missed. | `src/lib/engine/generate.ts` |
| 7 | Missing inputs | No financial year-end / VAT anchor / licence expiry → nothing generated for that type, client listed on "Missing data for deadlines". The system never guesses. | — |
| 8 | VAT periods | Rolled from a per-client "period anchor" (first day of any one period), so non-calendar quarters work. | Client → Tax profile |
| 9 | Seeded rules | VAT: 28 days after period end. CT: 9 months after period end. Licence/engagement: on expiry/end date. All marked **unconfirmed** until a qualified person confirms them in Settings → Deadline rules. | Settings → Deadline rules |
| 10 | Holidays | 2026–2027 UAE holidays seeded; lunar dates are marked "estimate" until announced. | Settings → Holidays |
| 11 | Internal deadlines | Prep = 10 working days before the internal target; review = 5 working days before. Stored per rule version. | Deadline rule version |
| 12 | Reminder catch-up | If the hourly job misses a run (outage), "N days before" reminders are caught up for 3 days, then skipped. | `CATCH_UP` in `reminders.ts` |
| 13 | Pause behaviour | While email is paused, reminders are logged as "skipped paused" and are **not** re-sent later. | Settings → Email |
| 14 | Staff on leave | Reminders for someone on leave go to their manager (or the engagement manager). | Settings → Users (leave dates) |
| 15 | Unassigned obligations | Preparer reminders for an unassigned obligation go to the engagement manager. | `recipientsFor()` |
| 16 | Escalation | Manager escalation once at the prep deadline; partner escalation once at 3 working days before statutory if not yet Submitted. | Settings → Reminder rules |
| 17 | Client reminders | Client document requests are seeded at 21/14 days (VAT) and 90/60/30 days (CT) before the statutory date. Email starts **paused** so nothing goes to clients until an administrator turns it on. | Settings → Reminder rules, Email |
| 18 | Lead routing | Website-form leads go to the Business Development user with the fewest open leads (else the Managing Partner); next action = next working day. | `autoOwner()` in `services/leads.ts` |
| 19 | Lead weights | Pipeline weighting: New 10%, Contacted 20%, Qualified 40%, Proposal 60%, Negotiation 80%. | `STAGE_WEIGHT` in `services/leads.ts` |
| 20 | Sessions | 8-hour sessions, server-side session table (revocable). Lockout: 5 failures → 15 minutes. | `SESSION_TIMEOUT_HOURS`, `auth.ts` |
| 21 | SSO and 2FA | Entra SSO users rely on Entra MFA (enforce with Conditional Access). Password users must enrol TOTP. SSO never creates accounts. | — |
| 22 | Queue | pg-boss (Postgres-backed durable queue) — no Redis needed. Schedules in Asia/Dubai. | `src/jobs/worker.ts` |
| 23 | Import | Dates accepted as YYYY-MM-DD or DD/MM/YYYY (UAE convention); year-end as DD/MM, "31 Mar" or a full date. | `services/import.ts` |
| 24 | Audit Staff | Can view assigned clients and edit only audit-type obligations. | `MATRIX` in `permissions.ts` |
