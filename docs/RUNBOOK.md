# Deployment runbook

## Components
- **web** — Next.js server (`npm start`), port 3000, behind TLS.
- **worker** — job worker (`npx tsx src/jobs/worker.ts`): obligation generation 01:00, reminders hourly at :05, digests hourly at :10 (sends at 08:00 GST), lead reminders 08:15, Outlook sync every 15 min. All in Asia/Dubai.
- **PostgreSQL 16+** — encrypted at rest. The queue (pg-boss) lives in the `pgboss` schema of the same database.

Run exactly **one** worker. pg-boss schedules are singleton, so a second worker is harmless but unnecessary.

## Hosting region
Default target: **Azure UAE North** (Azure Database for PostgreSQL Flexible Server + Azure Container Apps). Fallback: an EU region. Record the final choice here: `Region: ________  Decided by: ________  Date: ________`.

## Environment variables
See `.env.example`. Required: `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`. Connector variables are in `docs/CONNECTORS.md`. Never commit `.env`.

## First run
```bash
npm ci
npx prisma migrate deploy
SEED_DEMO=false SEED_ADMIN_EMAIL=it@yourfirm.com SEED_ADMIN_PASSWORD='<12+ chars>' npx tsx prisma/seed.ts
npm run build && npm start          # web
npm run worker                      # worker (separate process)
```
Then sign in as the administrator, enrol two-factor, and:
1. Settings → Deadline rules → have a qualified person **confirm** each rule.
2. Settings → Holidays → confirm or move the lunar-date estimates.
3. Settings → Users → add staff and set "reports to" (drives "My team" and escalations).
4. Clients → Import → load the client list (dry run first).
5. Settings → Email → sender mailbox, test-mode address; run send-reminders; check; then un-pause.

## Local development
```bash
docker compose up -d --build
docker compose run --rm setup       # migrations + seed (20 demo clients)
```
App on http://localhost:3000. Demo users `mp@`, `partner.audit@`, `partner.tax@`, `manager.tax@`, `manager.audit@`, `senior@`, `accountant@`, `taxconsultant@`, `audit@`, `bd@`, `readonly@` and `admin@tabconsultants.test`, password `TabDemo!2026`. Each enrols TOTP at first sign-in.

## Migrations
- Create: `npx prisma migrate dev --name <change>` (commit the SQL). Constraints Prisma cannot express (partial unique index, CHECKs, append-only triggers) are hand-written in the migration SQL.
- Apply in production: `npx prisma migrate deploy` before starting the new web/worker version.
- Never edit an applied migration.

## Rollback
1. Stop the worker. 2. Redeploy the previous image. 3. If the release included a migration, restore from the point-in-time backup taken just before deploy (migrations are forward-only). 4. Start the worker. Take a manual backup before every migration-bearing release.

## Backups (BUILD_SPEC Section 11)
- Automated daily backups with point-in-time recovery, 30-day retention (Azure Flexible Server: set backup retention to 30 days; enable geo-redundant backup if the region pair is acceptable).
- Monthly logical backup kept 12 months: `pg_dump --format=custom --file=tab_pms_$(date +%Y%m).dump "$DATABASE_URL"` to a separate storage account with immutability.
- **Test the restore quarterly** and record it below. An untested backup is not a backup.
  ```bash
  createdb tab_pms_restore_test
  pg_restore --no-owner --dbname=tab_pms_restore_test tab_pms_YYYYMM.dump
  psql tab_pms_restore_test -c "select count(*) from client; select count(*) from obligation; select max(at) from audit_log;"
  ```
  | Date | Backup used | Restored row counts match | By |
  |------|-------------|---------------------------|----|

## Monitoring
- `GET /api/health` → 200 when the database is reachable and the reminder job succeeded within 3 hours; 503 otherwise. Point an uptime monitor at it.
- Failed jobs: recorded in Settings → Jobs, shown as a red banner to administrators, and emailed to Administrators and the Managing Partner.
- Logs are structured JSON on stdout. They contain no client data.

## Full data export
`pg_dump` (above) is the open-format full export. Clients export to Excel from the Clients screen; the audit log exports to CSV from Audit trail.
