# CLAUDE.md — standing rules for every session

Read `BUILD_SPEC.md` first. Build only the phase named for the session. Sections 10–13 of the spec always apply; the essentials:

## Non-negotiables
- Every button, form, filter and status change works against the database. No mock arrays, no placeholder handlers, no TODO in a shipped screen.
- Every dashboard number is a live query that clicks through to a list with the same count. If it cannot be computed, remove the card.
- Unclear → choose the professional default, write it in `ASSUMPTIONS.md`, carry on. Stop and ask only for irreversible, security or compliance decisions.
- End every session with what was built, what was stubbed and what is not wired (update `SESSION_REPORT.md`). Never call a stub complete.
- New ideas mid-phase go in `BACKLOG.md`, not in the code.

## Architecture
- Business logic lives in `src/lib/services/*` and `src/lib/engine/*`, never in components. Pages call services; services call `requirePermission` and the row-level `*Where(actor)` filters in `src/lib/permissions.ts`.
- One obligation table, one workflow (`src/lib/engine/workflow.ts`), one reminder engine (`src/lib/engine/reminders.ts`). Never add a per-service-line deadline mechanism.
- Deadline rules, holidays, reminder rules, templates and VAT rates are data (versioned / effective-dated tables). Never hardcode a tax rate, threshold, frequency or deadline.
- Dates: due dates are `DATE` in Asia/Dubai, handled as `YMD` strings via `src/lib/dates.ts`. Timestamps are UTC `timestamptz`. Weekend = Saturday + Sunday.
- Every outbound email goes through `deliver()` in `src/lib/mailer.ts` (pause switch, test-mode redirect). Every reminder claims a dedupe key first (`claimDedupe`).
- Every background job runs through `runJob()` in `src/jobs/runner.ts` (job_run record, admin alert on failure).
- External systems are connectors in `src/lib/connectors/*`, each disabled cleanly when not configured, each logging to `connector_log`.
- Soft delete only for client, obligation, invoice, document (DB triggers block hard DELETE). `audit_log` and `obligation_status_history` are append-only (DB triggers).
- Every list endpoint is paginated server-side.

## Guardrails (Section 13)
No hardcoded tax facts · no calculated deadline presented as statutory advice · no hard deletes · no editing issued invoices · no assumed calendar quarter / December year-end · no duplicate reminders · no silent job failure · no placeholder numbers · no client portal, mobile app, time-tracking, e-signing, FTA API or AI assistant in phases 1–4.

## Checks before finishing
`npm run typecheck && npm test` · `npm run build` · `npm run test:acceptance` (mutates the DB — use a disposable one) · `npm run test:e2e` against a running server.
