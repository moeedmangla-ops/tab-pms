# TAB Consultants — Practice Management & Compliance System

## Build Specification

Revision 2 · 13 Nov 2026 · Section references, roles and open questions corrected (see Change log at the end)

## 0. How to use this document

Do not paste this whole document into one request. A single "build everything" prompt produces a good-looking UI with dead buttons, and it will exhaust a five-hour usage window in one sitting.

Save this file in the project repository as BUILD_SPEC.md. At the start of every session, tell Claude: *Read BUILD_SPEC.md. We are building Phase N only.*

Run it in this order:

1.  **Session 1 — Foundation.** Sections 1 to 5. Ask only for: database schema, migrations, authentication, role-based access, seed data for 20 fake clients, and an empty but navigable shell. Nothing else.

2.  **Session 2 — Phase 1.** Section 6. This is the phase that solves your actual problem. Do not move past it until the Phase 1 acceptance tests in Section 12 pass.

3.  **Session 3 — Phase 2.** Section 7.

4.  **Session 4 — Phase 3.** Section 8.

5.  **Session 5 — Phase 4.** Section 9.

Sections 10 (roles and audit), 11 (non-functional requirements), 12 (definition of done) and 13 (guardrails) apply to every session — keep them in CLAUDE.md so they load automatically. Section 14 lists the external connectors and when each is introduced.

After each phase, stop and use the system with real data for a week before commissioning the next one. A phase you are not using is a phase that was specified wrong.

## 1. Role and objective

Act as a senior full-stack engineer with direct experience building practice-management software for accounting and tax firms. You are responsible for the database, the API, the interface, the background jobs, the tests and the deployment instructions.

This system exists to prevent three specific failures that currently happen at TAB Consultants:

1.  **A statutory filing deadline passes and the return has not been filed.** Nobody was reminded, or the reminder went to someone who was on leave.

2.  **An enquiry arrives and nobody replies.** The lead is never logged, never assigned, and is lost.

3.  **An invoice is issued and nobody chases it.** The receivable ages quietly until someone notices months later.

Every feature is judged against those three. If a feature does not reduce one of them, it belongs in a later phase.

**Non-negotiable build rules**

- Every button, form, filter, calculation and status change must work against the database. No mock arrays, no placeholder handlers, no TODO left in a shipped screen.

- Every number on every dashboard is a live query. If a figure cannot be computed from real records, remove the card rather than hardcode it.

- When something is unclear, choose the professional default, write the assumption into ASSUMPTIONS.md, and keep going. Stop and ask only when the decision is irreversible, or creates a security or compliance risk.

- At the end of each session, list what was built, what was stubbed, and what is not yet wired up. Do not describe a stub as complete.

## 2. Business context

TAB Consultants is a UAE accounting, audit, tax and business advisory firm, headquartered at Shams Free Zone, Sharjah, with offices in Dubai, Kuwait and Pakistan.

**Service lines to model:** VAT registration and return filing; UAE Corporate Tax registration and return filing; bookkeeping and accounting; financial statements and audit; transfer pricing; tax advisory; business setup and corporate services; outsourced CFO.

**Scale:** approximately 1,500 clients at launch (roughly 1,000 audit, 200 bookkeeping, the rest advisory and one-off). Architect for 10,000 clients and 50 internal users without redesign. Queries must stay fast with 200,000+ obligation rows.

**User types:** Managing Partner, Partner, Manager, Senior Accountant, Accountant, Tax Consultant, Audit Staff, Business Development, Administrator, Read-only.

**Locale and calendar — get this right, it drives everything:**

- All times stored in UTC, displayed in Asia/Dubai (GST, UTC+4). Never store local time.

- The UAE working week is Monday to Friday; Saturday and Sunday are the weekend. Reminders must not fire on a non-working day — move them to the previous working day.

- UAE public holidays are configurable in a table, not hardcoded. Some are announced only weeks in advance.

- Clients have different financial year-ends. Do not assume December. Do not assume a VAT period aligns to a calendar quarter.

**Branding**

| Item            | Value                                   |
|-----------------|-----------------------------------------|
| Company         | TAB Consultants                         |
| Tagline         | Where Strategy Drives Measurable Growth |
| Primary         | \#43C6AE                                |
| Secondary       | \#2E333D                                |
| Dark background | \#0C1E31                                |
| Accent          | \#159BB5                                |

Design style: premium professional-services look, executive-level, dense with information rather than decorated. No gradient hero banners, no animated counters, no emoji, no generic AI-dashboard styling. Tables are the primary interface; a partner should be able to scan 50 rows without scrolling horizontally.

## 3. Technology stack

Use this stack unless you have a specific technical reason not to — in which case explain the reason before changing anything.

| Layer          | Choice                                                          | Notes                                                             |
|----------------|-----------------------------------------------------------------|-------------------------------------------------------------------|
| Frontend       | Next.js (App Router) + TypeScript                               | Strict mode on                                                    |
| UI             | Tailwind CSS + shadcn/ui                                        | Themed to the brand colours above                                 |
| Tables         | TanStack Table                                                  | Server-side pagination, sorting, filtering                        |
| Backend        | Next.js route handlers / server actions                         | Keep business logic out of components                             |
| Database       | PostgreSQL 16+                                                  |                                                                   |
| ORM            | Prisma                                                          | Migrations committed to the repo                                  |
| Auth           | Email + password with TOTP two-factor, plus Microsoft Entra SSO | Role-based access control                                         |
| Email          | Microsoft Graph API                                             | The firm runs Microsoft 365                                       |
| Scheduled jobs | A durable queue with retries and a job log                      | Not setInterval, not a serverless cron with no record of what ran |
| Files          | S3-compatible object storage, provider configurable             | Signed URLs only, never public buckets                            |
| Validation     | Zod, shared between client and server                           |                                                                   |
| Charts         | Recharts                                                        |                                                                   |
| Dates          | A timezone-aware library; every calculation in Asia/Dubai       |                                                                   |
| Testing        | Vitest for logic, Playwright for the critical flows             |                                                                   |
| Deployment     | Docker Compose for local, documented path to a cloud host       |                                                                   |

**Rules**

- All secrets in environment variables. Commit a .env.example with every key listed and no values.

- One seed script that creates realistic demo data: 20 clients with varied financial year-ends and VAT frequencies, 12 months of obligations, a few overdue, a few paid.

- Every list endpoint is paginated. Never load 1,500 clients into the browser.

- Soft delete only on client, invoice and obligation records — deleted_at, never a hard DELETE.

## 4. The deadline engine — the core of the system

This is the part the original brief treated as a feature. It is the product. Build it first and build it properly; everything else hangs off it.

**The central abstraction is an obligation.** An obligation is one thing that must be done for one client by one date. Every deadline in the firm is an obligation row, whatever its type:

- A VAT return for a specific tax period

- A Corporate Tax return for a specific financial year

- A trade licence renewal

- An engagement letter renewal

- An audit report due to a free zone authority

- A transfer pricing Local File

- A payment due to the tax authority after a return is filed

One table, one status workflow, one reminder engine, one calendar. Do not build a separate deadline mechanism per service line — that is how a deadline gets forgotten, because it lives in a module nobody opened.

**Deadline rules are data, not code.** Hold them in a deadline_rule table with an effective-from date and a version number. Each rule describes how to derive a due date from a period end. Seed these defaults, clearly marked as administrator-editable:

| Obligation type                  | Default rule                             | Status               |
|----------------------------------|------------------------------------------|----------------------|
| VAT return and payment           | 28 days after the end of the tax period  | Configurable default |
| Corporate Tax return and payment | 9 months after the end of the tax period | Configurable default |
| Trade licence renewal            | On the licence expiry date               | Per client           |
| Engagement letter renewal        | On the contract end date                 | Per client           |

These are defaults to be confirmed by a qualified person, not statutory advice the software asserts. Every generated obligation stores: which rule and which rule version produced it, whether it was auto-calculated or manually overridden, who last changed it, and whether a reviewer has confirmed it.

**Generation.** A scheduled job rolls obligations forward — generate the next 18 months for every active client, re-running nightly and creating only what is missing. Never regenerate or silently alter an obligation that is already submitted, filed or paid. If a client's filing frequency or year-end changes, flag affected future obligations for review rather than rewriting them. If the inputs a rule needs are missing (no financial year-end, no VAT frequency or tax-period anchor, no licence expiry), generate nothing for that obligation type, never guess a December year-end, and list the client on a "Missing data for deadlines" exception report that appears on the managers' dashboard until fixed.

**Working-day adjustment.** If a derived due date falls on a Saturday, Sunday or a UAE public holiday, keep the statutory date as recorded but set the internal target to the previous working day, and make clear in the interface which is which.

**Internal deadlines.** Every obligation carries three dates, not one: the statutory due date, the internal preparation deadline (default 10 working days earlier, configurable per service line), and the review deadline (default 5 working days earlier). The firm misses statutory dates because it has no internal ones.

## 5. Data model

Build these tables in Session 1, before any screen. Add the rest as each phase needs them.

| Table                     | Holds                                                                                                                                                                                                                                           | Key relationships                  |
|---------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------|
| client                    | One row per legal entity. Client code, legal name, trade name, entity type, licence number and authority, licence expiry, emirate, jurisdiction, industry, status, financial year-end                                                                         | Parent of almost everything        |
| client_tax_profile        | VAT TRN, VAT effective date, filing frequency, tax period anchor; CT registration number, CT period, free zone and QFZP status, Small Business Relief flag, tax group                                                                           | One per client                     |
| contact                   | People at the client: name, designation, email, mobile, role flags (primary, accounts, authorised signatory)                                                                                                                                    | Many per client                    |
| service_engagement        | A service the client has bought: service line, fee, billing frequency, contract start and end, assigned partner, manager and preparer                                                                                                           | Many per client                    |
| deadline_rule             | Versioned, effective-dated rules for deriving due dates                                                                                                                                                                                         | Referenced by obligations          |
| obligation                | The core table. Client, type, period start and end, statutory due date, internal prep date, review date, status, assigned preparer, assigned reviewer, rule version used, submission reference, submission date, amount payable, payment status | Many per client                    |
| obligation_status_history | Every status change: from, to, by whom, when, note                                                                                                                                                                                              | Many per obligation                |
| reminder_rule             | Which obligation types trigger which reminders, at what offsets, to whom                                                                                                                                                                        | Configuration                      |
| reminder_log              | Every reminder: obligation, recipient, channel, template, scheduled time, sent time, delivery status, dedupe key                                                                                                                                | Append-only                        |
| lead                      | Enquiry source, contact details, service interest, estimated value, stage, owner, next action date                                                                                                                                              | Converts to client                 |
| communication             | Logged interaction: client or lead, channel, direction, subject, summary, participants, timestamp, linked obligation or invoice                                                                                                                 | Many per client                    |
| task                      | Title, client, related obligation or engagement, assignee, priority, due date, status, dependencies                                                                                                                                             | Standalone or linked               |
| document                  | File metadata, type, client, expiry date, version, uploaded by                                                                                                                                                                                  | Expiring docs generate obligations |
| invoice and invoice_line  | Invoice header and lines, VAT, totals, currency, status                                                                                                                                                                                         | Many per client                    |
| receipt                   | Payment received, allocation across invoices                                                                                                                                                                                                    | Many per invoice                   |
| user, role, permission    | Staff accounts and access                                                                                                                                                                                                                       |                                    |
| audit_log                 | Every create, update and delete on a financial or compliance record                                                                                                                                                                             | Append-only                        |
| holiday | Non-working days per jurisdiction (UAE at launch), configurable | Used by the deadline engine |
| job_run | Every background job run: job name, started, finished, items processed, errors | Operations |
| connector_log | Every call to an external connector: connector, direction, status, error, related record | Operations |
| app_setting | Key/value settings: email pause switch, test-mode address, sender mailbox, inactivity days | Configuration |

**Constraints to enforce in the database, not only in the application:** a client cannot have two obligations of the same type for the same period; a VAT TRN is unique; an invoice number is unique and gapless per series; an obligation cannot move to Submitted without a submission reference.

## 6. Phase 1 — Clients, deadlines and reminders

This phase alone fixes the missed-deadline problem. Build nothing from later phases until it is in daily use.

**Client master**

- Create, edit, archive. Never hard-delete.

- Full-text search across legal name, trade name, client code, VAT TRN, CT number, licence number, contact email and mobile.

- Filters: service line, status, assigned manager, emirate, VAT frequency, financial year-end month.

- Excel and CSV import with a column-mapping step, a dry-run preview, per-row validation errors, and duplicate detection on VAT TRN and licence number. Import 1,500 rows without timing out.

- Export the current filtered view to Excel.

- A client profile page with tabs: Overview, Contacts, Services, Obligations, Documents, Communication, Tasks, Notes, Audit Trail.

- Bulk reassignment of clients between staff.

**Obligation workspace** — the screen the firm lives in

- One unified list of every obligation across every service line, with views: My work, My team's work, Whole firm.

- Default sort: overdue first, then due soonest.

- Filters: type, status, assigned preparer, assigned reviewer, manager, period, due-date range, client.

- Four presentations of the same data: list, kanban by status, month calendar, and a year grid showing each client as a row and each period as a cell.

- Colour coding: red overdue, amber due within 7 days, blue in progress, green completed, grey on hold.

- Inline status change from the list without opening the record.

- Bulk actions: assign, change status, send a document request.

**Status workflow**

One workflow serves all obligation types, with stages switched on per type in settings:

Upcoming → Documents Requested → Documents Received → In Preparation → Pending Internal Review → Pending Client Approval → Ready for Submission → Submitted → Payment Pending → Completed. Plus Overdue (derived, never set by hand) and On Hold (requires a reason).

Every transition records who, when and an optional note. Moving to Submitted requires a submission reference. Moving to Completed requires either payment confirmation or an explicit waiver with a reason.

**Reminders — build this properly or the system is pointless**

- A scheduled job runs hourly, finds obligations needing a reminder, and queues emails.

- Default internal schedule, all configurable per obligation type: 30, 15, 7, 3 and 1 days before the statutory date, on the day, and then every 2 days while overdue until the status is Completed or On Hold.

- Separate reminder tracks with their own templates and recipients: internal preparer, internal reviewer, manager escalation, client document request, client approval request, payment follow-up.

- **Escalation:** if an obligation is still short of Ready for Submission at the internal preparation deadline, notify the manager. If it is still open 3 days before the statutory date, notify the partner. Escalation is what actually prevents the miss.

- **Deduplication is mandatory.** Each reminder writes a unique key of obligation, rule, recipient and scheduled date. A re-run of the job must never send the same reminder twice. Nothing destroys trust in a system like duplicate emails to clients.

- A daily digest at 08:00 GST to each staff member: what is due this week, what is overdue, what is waiting on them.

- A weekly partner summary each Monday: obligations due in the next 14 days, anything overdue, anything unassigned.

- Every reminder is logged with recipient, template, timestamp and delivery status, and is visible on the obligation record.

- A global “pause all outbound email” switch for testing, and a test mode that redirects every message to one address.

## 7. Phase 2 — Leads, communication and tasks

The original brief had no lead module at all. This is where enquiries are currently lost.

**Lead pipeline**

- Capture: name, company, email, mobile, country, source (website form, referral, BNI, LinkedIn, walk-in, free zone referral, existing client), service interest, estimated annual fee, notes.

- A web-form endpoint so the firm's website posts enquiries straight in, plus manual entry and CSV import.

- Stages: New → Contacted → Qualified → Proposal Sent → Negotiation → Won → Lost. A lost lead requires a reason from a configurable list.

- **Every lead has an owner and a next-action date. Both are mandatory.** A lead with no next action, or a next action now in the past, appears in a “needs attention” list on the dashboard and triggers a reminder to its owner.

- A response-time clock: time from creation to first logged contact, reported per owner and per source. This is the number that tells you whether enquiries are being answered.

- Converting a won lead creates the client record, carries over contacts and notes, and prompts for the services and fees to create engagements and obligations.

- Pipeline view by stage with weighted value, and a source report showing conversion rate and average fee by source.

**Communication log**

- Log any interaction against a client or lead: channel (email, phone, WhatsApp, meeting, site visit), direction, participants, subject, summary, date, and an optional link to an obligation or invoice.

- Pull Outlook email automatically through Microsoft Graph: match on contact email address, attach the thread to the client, store subject, participants and timestamp. Store the body only if the firm enables it in settings.

- A unified timeline on each client profile mixing emails, logged calls, status changes, documents received and invoices issued, newest first.

- Flag a client with no interaction in a configurable number of days — default 90 — on the relationship partner's dashboard.

**Tasks**

- Title, description, client, related obligation or engagement, assignee, priority, due date, status, checklist items, attachments, comments.

- Recurring tasks with a schedule.

- Dependencies: a task can block another.

- Automatic escalation to the assignee's manager when a task is overdue by a configurable number of days.

- A personal work queue per user combining their obligations, tasks and leads needing attention into one ordered list. This is the screen most staff should open first each morning.

## 8. Phase 3 — Invoicing and collections

**Invoicing**

- Invoice header and lines: client, invoice date, due date, currency (AED default, multi-currency supported with the rate stored on the invoice), service description and category, quantity, unit price, discount, VAT rate, VAT amount, subtotal, total, payment terms, notes.

- Numbering: a configurable prefix and a gapless sequence per series and per year. A cancelled invoice keeps its number.

- Statuses: Draft → Pending Approval → Issued → Partially Paid → Paid, plus Overdue (derived) and Cancelled (requires a reason and a credit note where already issued).

- Credit notes linked to the original invoice. Never edit an issued invoice — credit and reissue.

- Recurring invoices generated from engagements on a schedule, landing as drafts for review rather than issuing automatically.

- Generate invoices directly from a completed obligation or engagement, so billing follows delivery instead of being remembered separately.

- PDF output on the firm letterhead, with TRN displayed, compliant with UAE tax invoice requirements. Email it from the system and log the send.

**Collections — the part that is currently missing**

- A receivables screen: every unpaid invoice, with an ageing bucket of current, 1–30, 31–60, 61–90 and 90+ days.

- Ageing by client, by partner and by service line.

- **Each overdue invoice has an owner and a next-follow-up date.** The system reminds that owner; it does not wait to be asked.

- Automated client payment reminders on a configurable ladder: a polite note 3 days before the due date, then at 7, 15, 30 and 45 days overdue, each with its own template and escalating tone. The relationship partner is copied from 30 days.

- Record receipts with allocation across invoices, including partial payment and payment on account.

- Log every collection call or message against the invoice, so the next person to chase it can see what was already said.

- A **stop-work flag** on a client when receivables pass a configurable threshold or age, shown prominently on the client profile and on every obligation for that client.

- Collections dashboard: total outstanding, overdue, average days to pay by client, worst offenders, collected this month against invoiced this month.

## 9. Phase 4 — Documents, reporting and settings

**Document management**

- Upload against a client, an obligation, an engagement or an invoice. Store type, version, uploaded by, uploaded at, and an expiry date where one applies.

- Document types: trade licence, certificate of incorporation, MOA, VAT certificate, CT registration certificate, engagement letter, signed financial statements, filed returns, submission acknowledgements, bank letters, other.

- **Expiring documents generate obligations.** A trade licence expiring on a date is a renewal obligation with the same reminder ladder as a tax filing.

- A document-request workflow: select the documents needed for an obligation, send the client a checklist by email, track what has arrived, and chase what has not.

- A missing-documents report per client: what the firm should hold for this client's services and does not.

- Versioning with the previous version retained. Signed URLs with expiry, never public links.

**Reporting and analytics**

Build these as saved, filterable reports exportable to Excel, not as decorative dashboard cards:

- Compliance scorecard: filings due, filed on time, filed late, missed — by month, service line, manager and preparer.

- Workload: open obligations and tasks per staff member against capacity, with a forward view of the next 60 days so you can see a crunch coming.

- Revenue: invoiced and collected by month, by service line, by partner, against the prior year.

- Receivables ageing, as in Phase 3.

- Client profitability if time is tracked, otherwise fee per client against service count.

- Lead conversion by source, with response time.

- Client growth: added, lost, net, with churn reasons.

**Executive dashboard**

One screen for the Managing Partner, every figure a live query, every figure clickable through to the underlying list. Lead with exceptions, not totals: anything overdue, anything unassigned, anything due this week without a preparer, leads with no next action, invoices over 60 days. Totals come second.

**Settings**

- Deadline rules and versions, with an effective-from date and an audit trail of changes.

- Reminder rules: offsets, recipients, templates, channels, on or off per obligation type.

- Email templates with merge fields, editable without a developer.

- Public holidays and working days.

- Service lines and fee defaults.

- Users, roles and permissions.

- VAT rates and invoice series.

- Data import and export tools.

## 10. Roles, permissions and audit

Permissions are checked on the server for every request. A hidden menu item is not access control.

| Role                                 | Clients                  | Obligations         | Invoices               | Collections   | Settings |
|---|---|---|---|---|---|
| Managing Partner                     | All, edit                | All, edit           | All, approve           | All           | All      |
| Partner                              | All, edit                | All, edit           | Own portfolio, approve | Own portfolio | View     |
| Manager                              | Assigned, edit           | Assigned team, edit | Create, not approve    | Assigned      | None     |
| Senior / Accountant / Tax Consultant | Assigned, edit           | Assigned, edit      | Create draft           | None          | None     |
| Audit Staff                          | Assigned, view           | Assigned audit-type obligations, edit | None | None | None |
| Business Development                 | Leads and prospects only | None                | None                   | None          | None     |
| Administrator                        | All, edit                | All, edit           | All                    | All           | All      |
| Read-only                            | All, view                | All, view           | View                   | View          | None     |

**Leads**

| Role | Leads |
|---|---|
| Managing Partner, Administrator | All, edit, reassign |
| Partner | All, view; own leads, edit |
| Business Development | All, edit; conversion to client |
| Manager | Own leads, edit |
| Senior / Accountant / Tax Consultant / Audit Staff | Own leads only (referrals they log) |
| Read-only | All, view |

"Assigned" means the user is the assigned partner, manager or preparer on an active service engagement for that client, or the preparer or reviewer on one of its obligations. "Assigned team" for a Manager means clients where the Manager or anyone reporting to them (user.manager_id) is assigned.

**Audit trail**

- Every create, update and delete on a client, obligation, invoice, receipt, document or deadline rule writes an append-only audit_log row: who, when, table, record, field, old value, new value, IP address.

- The audit log is readable in the interface, filterable by user, record and date range, and exportable.

- No application code path may update or delete an audit row.

- Obligation status history is kept separately as well, so the compliance story of a filing can be read without filtering the whole log.

- Record retention: compliance and financial records are retained for at least 7 years and archived rather than deleted, in line with UAE record-keeping expectations.

## 11. Non-functional requirements

**Security**

- Two-factor authentication mandatory for every user. Users who sign in through Microsoft Entra SSO satisfy this through Entra's own MFA (enforced by a Conditional Access policy the firm controls) and are not asked for a second TOTP code; users who sign in with email and password must enrol TOTP before first use. A local break-glass Administrator account always uses password + TOTP. Session timeout configurable, default 8 hours.

- Passwords hashed with Argon2 or bcrypt. Rate-limit login attempts and lock after repeated failures.

- All traffic over TLS. Database encrypted at rest. Uploaded files encrypted at rest with signed, expiring URLs.

- Field-level protection on identity documents: Emirates ID and passport data visible only to roles that need it, with each view logged.

- Server-side authorisation on every endpoint, with tests that prove a user of one role cannot read another's clients.

- No client data in log output. No secrets in the repository.

**Data and continuity**

- Automated daily database backups with point-in-time recovery, retained 30 days, plus a monthly backup retained a year. Document and test the restore procedure — an untested backup is not a backup.

- A full export of all firm data in open formats on demand, so the firm is never locked in.

- Record the data-hosting region; keep it in a jurisdiction acceptable for UAE client records and state which one.

**Performance**

- Client list and obligation list return in under 500 ms at 10,000 clients and 200,000 obligations. Index accordingly and prove it with a seeded load test.

- All list endpoints paginated server-side. All reports run from indexed queries, not in-memory aggregation.

- The nightly obligation generation job completes for 10,000 clients within its window, is idempotent, and logs what it created.

**Operations**

- Every background job writes a run record: started, finished, items processed, errors. A failed job raises an alert; it does not fail silently. A reminder engine that stops without anyone noticing is worse than no reminder engine.

- Health-check endpoint, structured logging, error tracking.

- Docker Compose for local development with one command to seed and run.

- A written deployment runbook covering environment variables, migrations, first-run setup and rollback.

## 12. Definition of done

A phase is finished when a person can do these things in a browser against a real database. Not when the code exists. Run these yourself and report the result before starting the next phase.

**Session 1 — Foundation**

- [ ] docker compose up followed by one seed command gives a running app with 20 demo clients.

- [ ] Log in as each role; each sees only what Section 10 allows.

- [ ] Migrations run clean on an empty database.

**Phase 1 — Deadlines**

- [ ] Import 1,500 clients from an Excel file, with 3 deliberate duplicates and 5 bad rows caught and reported.

- [ ] A client with a 31 March year-end and quarterly VAT gets correct VAT and Corporate Tax obligations generated for the next 18 months.

- [ ] Change that client's year-end; future obligations are flagged for review and past ones are untouched.

- [ ] Move an obligation through every status; the history shows who and when for each step.

- [ ] Set a due date 7 days out, run the reminder job, and confirm one email arrives. Run the job again — confirm no second email.

- [ ] An obligation past its internal preparation deadline escalates to the manager.

- [ ] The daily digest arrives at 08:00 GST with the right items for that user.

- [ ] A due date falling on a Friday public holiday moves the internal target to the previous working day.

- [ ] A due date falling on a Saturday or Sunday moves the internal target to the previous Friday (or earlier if that Friday is a holiday); the statutory date is unchanged and both are shown.

- [ ] An imported client with no financial year-end gets no Corporate Tax obligations and appears on the "Missing data for deadlines" report.

**Phase 2 — Leads and communication**

- [ ] Submit the website form; the lead appears, assigned, with a next-action date.

- [ ] A lead whose next action is overdue appears in “needs attention” and reminds its owner.

- [ ] Convert a won lead to a client; contacts, notes and services carry across and obligations generate.

- [ ] An Outlook email from a known contact appears on that client's timeline.

**Phase 3 — Invoicing and collections**

- [ ] Create, approve and issue an invoice; the PDF shows the firm's TRN and correct VAT.

- [ ] Invoice numbers are sequential with no gaps after a cancellation.

- [ ] Record a partial payment; status becomes Partially Paid and the ageing updates.

- [ ] An invoice 31 days overdue triggers the right reminder with the partner copied.

- [ ] The receivables ageing total reconciles to the sum of unpaid invoices.

**Phase 4 — Documents and reporting**

- [ ] A trade licence expiring in 60 days produces a renewal obligation with reminders.

- [ ] Send a document request; the client checklist arrives and received items update the obligation.

- [ ] Every executive dashboard figure clicks through to a list whose count matches the figure.

## 13. Guardrails

Things that will make this system fail. Do not do them.

- **Do not hardcode any tax rate, threshold, exemption, filing frequency or deadline rule as a permanent fact.** UAE tax rules change. Everything of that kind lives in a configurable, versioned table with an effective-from date.

- **Do not present a calculated deadline as statutory advice.** Label it as derived from a named rule version, and let a qualified user confirm it. The firm, not the software, is responsible for the filing date.

- Do not build a separate deadline mechanism for each service line. One obligation table.

- Do not hard-delete a client, obligation, invoice or document through any ordinary user action.

- Do not edit an issued invoice. Credit note and reissue.

- Do not assume a calendar quarter, a December year-end, or a Monday-to-Friday public holiday calendar.

- Do not send duplicate reminders. Dedupe on a stable key before every send.

- Do not let a background job fail silently.

- Do not put sample, placeholder or hardcoded numbers on any dashboard.

- Do not build a client-facing portal, a mobile app, time-tracking, document e-signing, FTA API integration or an AI assistant in any of these phases. Each is a sensible later project and each will stall the phase it is added to.

- Do not expand scope mid-phase. Write the idea into BACKLOG.md and carry on.

## 14. Connectors

The firm runs Microsoft 365, so Microsoft 365 is the primary connector. Each connector sits behind an interface in `src/lib/connectors/` with a "disabled" implementation, so the system runs fully without any of them configured.

| Connector | Purpose | Phase | Direction |
|---|---|---|---|
| Microsoft Entra ID (OIDC) | Staff single sign-on | Foundation | Inbound auth |
| Microsoft Graph — Mail.Send | Reminders, digests, document requests, invoice emails, sent from the shared compliance mailbox | Phase 1 | Outbound |
| Microsoft Graph — Mail.Read (shared mailboxes) | Pull client email threads onto the client timeline, matched on contact email | Phase 2 | Inbound |
| Microsoft Graph — Calendars | Optional: push obligation internal deadlines to the assignee's Outlook calendar | Phase 2 | Outbound |
| Website / Zapier / Power Automate webhook | `POST /api/connectors/lead-webhook` with a shared secret; any form tool can post enquiries | Phase 2 | Inbound |
| SharePoint / OneDrive (Graph Files) | Optional document storage provider instead of S3 | Phase 4 | Both |
| Accounting ledger (Xero, QuickBooks or Zoho Books) | Optional: push issued invoices and pull receipts | After Phase 3 | Both |

Every connector call writes a `connector_log` row (connector, direction, status, error) and a failing connector raises a job alert like any background job. Outbound email honours the global pause switch and the test-mode redirect.

## 15. Decisions on the original open questions

These were open in revision 1. The defaults below are applied and recorded in ASSUMPTIONS.md; change them there if the firm decides otherwise.

1.  **Brand colours.** Built as design tokens (`--brand-primary` etc.) in one file, defaulting to the teal / navy palette. A navy-and-gold palette is a one-file change.

2.  **Hosting region.** Default: UAE region (Azure UAE North, since the firm is already on Microsoft 365). EU is the fallback. Record the final choice in the deployment runbook.

3.  **Existing data.** The importer accepts any Excel/CSV and maps columns in the interface, so the current source does not block the build. A downloadable import template lists the Section 5 fields.

4.  **Email identity.** Client reminders go from a shared mailbox (`compliance@`), configurable in settings. Internal reminders and digests go from the same mailbox. Per-user sending is a later option.

5.  **Kuwait and Pakistan offices.** UAE first. The data model carries `jurisdiction` on client, deadline_rule and holiday from day one, so adding Kuwait or Pakistan rules is data entry, not a redesign.

## Change log

Revision 2:

- Section 0: section numbers corrected (Foundation = 1–5, Phase 1 = 6, Phase 2 = 7, Phase 3 = 8, Phase 4 = 9; acceptance tests are Section 12; standing sections are 10–13).
- Section 4: behaviour defined when a rule's inputs are missing.
- Section 10: Audit Staff row added; Leads permission table added; "assigned" and "assigned team" defined.
- Section 11: two-factor requirement reconciled with Microsoft Entra SSO.
- Section 12: weekend due-date test and missing-year-end test added.
- Section 14: connectors added. Section 15: open questions resolved with recorded defaults.
