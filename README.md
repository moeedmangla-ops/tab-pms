# TAB Consultants — Practice Management & Compliance System

A practice-management system and CRM for an accounting, audit and tax firm. It is built around one idea: **every deadline is an obligation row**. That covers VAT returns, Corporate Tax returns, licence renewals and engagement renewals, all in one table, with one workflow, one reminder engine and one calendar.

It exists to stop three failures:
1. **A filing deadline is missed.** Obligations are generated automatically from versioned rules. Internal prep and review deadlines come before the statutory date, and escalations go to the manager and partner.
2. **An enquiry is never answered.** Every lead must have an owner and a next-action date. Overdue leads go on a "needs attention" list and trigger reminders, and the system reports response time.
3. **An invoice is never chased.** That is Phase 3: the schema is in place, the screens are not built yet.

See `BUILD_SPEC.md` (revision 2, with the corrections), `SESSION_REPORT.md` (what is built, stubbed and not wired), `ASSUMPTIONS.md`, `docs/CONNECTORS.md` and `docs/RUNBOOK.md`.

## Quick start (local)
```bash
cp .env.example .env              # fill DATABASE_URL, SESSION_SECRET (openssl rand -hex 32), APP_URL, MAIL_TRANSPORT=console
npm ci
npx prisma migrate deploy
npm run db:seed                   # 20 demo clients, 11 demo users, UAE holidays, rules, templates
npm run build && npm start        # http://localhost:3000
npm run worker                    # background jobs (separate terminal)
```
Or with Docker: `docker compose up -d --build && docker compose run --rm setup`.

Sign in as `mp@tabconsultants.test` / `TabDemo!2026` (Managing Partner). Every user enrols two-factor at first sign-in. Other demo roles: `partner.audit@`, `partner.tax@`, `manager.tax@`, `manager.audit@`, `senior@`, `accountant@`, `taxconsultant@`, `audit@`, `bd@`, `readonly@`, `admin@`.

Outbound email starts **paused**. Turn it on in Settings → Email after setting a test-mode address.

## Tests
```bash
npm run typecheck && npm test     # unit tests
npm run test:acceptance           # Phase 1 acceptance tests (writes to the DB: use a disposable one)
npm run test:e2e                  # browser tests against a running server
npm run test:load                 # tops up to 10,000 clients and times every list query
```

## Stack
Next.js 15 (App Router, TypeScript strict) · Tailwind 4 · PostgreSQL 16 · Prisma 6 · pg-boss (durable jobs) · Zod · otplib (TOTP) · jose · ExcelJS · Vitest · Playwright · Microsoft Graph and Entra ID connectors.

## Layout
```
prisma/            schema, migrations (incl. hand-written constraints and triggers), seed
src/lib/engine/    deadline engine: periods, generation, workflow, reminders, calendar
src/lib/services/  clients, obligations, leads, import, document requests
src/lib/connectors Microsoft Graph mail, Outlook sync, Entra SSO, connector log
src/jobs/          job runner (run records and alerts) and pg-boss worker
src/app/           screens and API routes
scripts/           acceptance and load tests
```
