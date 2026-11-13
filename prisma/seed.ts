/**
 * Seed: configuration + realistic demo data (20 clients, varied year-ends and VAT frequencies).
 * Runs only on an empty database (hard deletes are blocked by triggers by design).
 *   npm run db:seed              → config + demo data
 *   SEED_DEMO=false npm run db:seed → configuration only (for production first run)
 */
import { PrismaClient, ObligationStatus, RoleKey, ServiceLine, FilingFrequency, ObligationType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { MATRIX, ROLE_LABEL } from "../src/lib/permissions";
import { generateObligations } from "../src/lib/engine/generate";
import { addDays, addMonths, fromDbDate, toDbDate, todayDubai, ymd } from "../src/lib/dates";
import { STATUS_ORDER } from "../src/lib/engine/workflow";

const prisma = new PrismaClient();
const DEMO = process.env.SEED_DEMO !== "false";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "TabDemo!2026";

async function config() {
  // Roles and permissions from the matrix
  for (const key of Object.keys(MATRIX) as RoleKey[]) {
    const role = await prisma.role.upsert({ where: { key }, update: { name: ROLE_LABEL[key] }, create: { key, name: ROLE_LABEL[key] } });
    for (const [area, a] of Object.entries(MATRIX[key])) {
      if (a.scope === "none") continue;
      const pk = `${area}:${a.approve ? "approve" : a.edit ? "edit" : "view"}:${a.scope}`;
      const p = await prisma.permission.upsert({ where: { key: pk }, update: {}, create: { key: pk, description: `${area} — ${a.approve ? "approve" : a.edit ? "edit" : "view"} (${a.scope})` } });
      await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } }, update: {}, create: { roleId: role.id, permissionId: p.id } });
    }
  }

  // UAE public holidays. Lunar dates are estimates (isConfirmed=false) until announced — edit in Settings → Holidays.
  const hol: [string, string, boolean][] = [
    ["2026-01-01", "New Year's Day", true],
    ["2026-03-19", "Eid al-Fitr (est.)", false], ["2026-03-20", "Eid al-Fitr (est.)", false], ["2026-03-21", "Eid al-Fitr (est.)", false],
    ["2026-05-26", "Arafat Day (est.)", false], ["2026-05-27", "Eid al-Adha (est.)", false], ["2026-05-28", "Eid al-Adha (est.)", false], ["2026-05-29", "Eid al-Adha (est.)", false],
    ["2026-06-16", "Islamic New Year (est.)", false],
    ["2026-08-25", "Prophet's Birthday (est.)", false],
    ["2026-12-01", "Commemoration Day", true], ["2026-12-02", "National Day", true], ["2026-12-03", "National Day", true],
    ["2027-01-01", "New Year's Day", true],
    ["2027-03-09", "Eid al-Fitr (est.)", false], ["2027-03-10", "Eid al-Fitr (est.)", false], ["2027-03-11", "Eid al-Fitr (est.)", false],
    ["2027-05-15", "Arafat Day (est.)", false], ["2027-05-16", "Eid al-Adha (est.)", false], ["2027-05-17", "Eid al-Adha (est.)", false], ["2027-05-18", "Eid al-Adha (est.)", false],
    ["2027-06-06", "Islamic New Year (est.)", false],
    ["2027-08-14", "Prophet's Birthday (est.)", false],
    ["2027-12-01", "Commemoration Day", true], ["2027-12-02", "National Day", true], ["2027-12-03", "National Day", true],
  ];
  for (const [d, name, ok] of hol) await prisma.holiday.upsert({ where: { jurisdiction_date: { jurisdiction: "AE", date: toDbDate(d) } }, update: {}, create: { date: toDbDate(d), name, isConfirmed: ok } });

  // Deadline rules — configurable defaults, NOT statutory advice. Must be confirmed by a qualified person.
  const rules = [
    { code: "AE_VAT_RETURN", obligationType: "VAT_RETURN", name: "VAT return and payment — 28 days after tax period end", basis: "DAYS_AFTER_PERIOD_END", offsetDays: 28, offsetMonths: 0, effectiveFrom: "2018-01-01" },
    { code: "AE_CT_RETURN", obligationType: "CT_RETURN", name: "Corporate Tax return and payment — 9 months after tax period end", basis: "MONTHS_AFTER_PERIOD_END", offsetDays: 0, offsetMonths: 9, effectiveFrom: "2023-06-01" },
    { code: "AE_TRADE_LICENCE", obligationType: "TRADE_LICENCE_RENEWAL", name: "Trade licence renewal — on licence expiry date", basis: "ON_SOURCE_DATE", offsetDays: 0, offsetMonths: 0, effectiveFrom: "2000-01-01" },
    { code: "AE_ENGAGEMENT", obligationType: "ENGAGEMENT_RENEWAL", name: "Engagement letter renewal — on contract end date", basis: "ON_SOURCE_DATE", offsetDays: 0, offsetMonths: 0, effectiveFrom: "2000-01-01" },
  ] as const;
  for (const r of rules)
    await prisma.deadlineRule.upsert({
      where: { code_version: { code: r.code, version: 1 } },
      update: {},
      create: { ...r, version: 1, effectiveFrom: toDbDate(r.effectiveFrom), notes: "Seeded default. Administrator-editable. Confirm with a qualified tax professional before relying on it." },
    });

  // Status stages per type (all on by default; renewals skip client approval and payment)
  const all = STATUS_ORDER;
  const renewal: ObligationStatus[] = ["UPCOMING", "DOCUMENTS_REQUESTED", "DOCUMENTS_RECEIVED", "IN_PREPARATION", "READY_FOR_SUBMISSION", "SUBMITTED", "COMPLETED"];
  for (const t of Object.values(ObligationType)) {
    const enabled = ["TRADE_LICENCE_RENEWAL", "ENGAGEMENT_RENEWAL", "DOCUMENT_EXPIRY"].includes(t) ? renewal : all;
    await prisma.obligationTypeSetting.upsert({ where: { type: t }, update: {}, create: { type: t, enabledStatuses: enabled } });
  }

  // Reminder rules
  if ((await prisma.reminderRule.count()) === 0) {
    await prisma.reminderRule.createMany({
      data: [
        { name: "Preparer — before statutory date", track: "INTERNAL_PREPARER", trigger: "BEFORE_STATUTORY", offsetsDays: [30, 15, 7, 3, 1, 0], templateKey: "preparer_before" },
        { name: "Preparer — overdue, every 2 days", track: "INTERNAL_PREPARER", trigger: "OVERDUE_REPEAT", offsetsDays: [], repeatEveryDays: 2, templateKey: "preparer_overdue" },
        { name: "Reviewer — before statutory date", track: "INTERNAL_REVIEWER", trigger: "BEFORE_STATUTORY", offsetsDays: [7, 3, 1], templateKey: "reviewer_before" },
        { name: "Manager escalation — at internal prep deadline", track: "MANAGER_ESCALATION", trigger: "AT_PREP_DEADLINE", offsetsDays: [], templateKey: "escalation_manager" },
        { name: "Partner escalation — open 3 days before statutory", track: "PARTNER_ESCALATION", trigger: "BEFORE_STATUTORY_OPEN", offsetsDays: [3], templateKey: "escalation_partner" },
        { name: "Client — document request (VAT)", obligationType: "VAT_RETURN", track: "CLIENT_DOCUMENT_REQUEST", trigger: "BEFORE_STATUTORY", offsetsDays: [21, 14], templateKey: "client_documents" },
        { name: "Client — document request (CT)", obligationType: "CT_RETURN", track: "CLIENT_DOCUMENT_REQUEST", trigger: "BEFORE_STATUTORY", offsetsDays: [90, 60, 30], templateKey: "client_documents" },
        { name: "Client — approval request", track: "CLIENT_APPROVAL_REQUEST", trigger: "BEFORE_STATUTORY", offsetsDays: [5, 3, 1], templateKey: "client_approval" },
        { name: "Client — tax payment follow-up", track: "PAYMENT_FOLLOW_UP", trigger: "BEFORE_STATUTORY", offsetsDays: [3, 1, 0], templateKey: "client_payment" },
      ],
    });
  }

  const T = (key: string, name: string, subject: string, body: string) => prisma.emailTemplate.upsert({ where: { key }, update: {}, create: { key, name, subject, body } });
  await T("preparer_before", "Preparer reminder", "{{client_name}}: {{obligation_title}} — {{reminder_reason}}", "Dear {{recipient_name}},\n\n{{obligation_title}} for {{client_name}} ({{client_code}}) is {{reminder_reason}}.\n\nStatutory due date: {{statutory_due_date}}\nInternal target: {{internal_target_date}}\nInternal preparation deadline: {{prep_deadline}}\nCurrent status: {{status}}\n\nOpen: {{link}}\n\nTAB Consultants — Practice Management");
  await T("preparer_overdue", "Preparer overdue", "OVERDUE — {{client_name}}: {{obligation_title}}", "Dear {{recipient_name}},\n\n{{obligation_title}} for {{client_name}} is {{reminder_reason}}. The statutory due date was {{statutory_due_date}}.\nCurrent status: {{status}}\n\nUpdate the status or put it on hold with a reason: {{link}}");
  await T("reviewer_before", "Reviewer reminder", "Review needed — {{client_name}}: {{obligation_title}}", "Dear {{recipient_name}},\n\nYou are the reviewer for {{obligation_title}} ({{client_name}}), {{reminder_reason}}.\nStatutory due date: {{statutory_due_date}}. Status: {{status}}.\n\n{{link}}");
  await T("escalation_manager", "Manager escalation", "ESCALATION — {{client_name}}: {{obligation_title}} past internal deadline", "Dear {{recipient_name}},\n\n{{obligation_title}} for {{client_name}} is {{reminder_reason}} ({{prep_deadline}}) and is not yet Ready for Submission.\nStatus: {{status}}. Statutory due date: {{statutory_due_date}}.\n\n{{link}}");
  await T("escalation_partner", "Partner escalation", "PARTNER ESCALATION — {{client_name}}: {{obligation_title}}", "Dear {{recipient_name}},\n\n{{obligation_title}} for {{client_name}} is {{reminder_reason}} and has not been submitted.\nStatus: {{status}}.\n\n{{link}}");
  await T("client_documents", "Client document request", "Documents needed: {{obligation_title}}", "Dear {{recipient_name}},\n\nTo prepare your {{obligation_title}}, due to the authority on {{statutory_due_date}}, please send us your records for the period at your earliest convenience.\n\nKind regards,\nTAB Consultants");
  await T("client_approval", "Client approval request", "Approval needed: {{obligation_title}}", "Dear {{recipient_name}},\n\nYour {{obligation_title}} is ready for your approval. It must be filed by {{statutory_due_date}}. Please review and confirm.\n\nKind regards,\nTAB Consultants");
  await T("client_payment", "Client tax payment reminder", "Tax payment due: {{obligation_title}}", "Dear {{recipient_name}},\n\nThe tax payable for {{obligation_title}} is due by {{statutory_due_date}}. Please arrange payment and send us confirmation.\n\nKind regards,\nTAB Consultants");

  for (const label of ["Price", "Chose competitor", "No response", "Not a fit for our services", "Timing — revisit later", "Other"]) await prisma.lostReason.upsert({ where: { label }, update: {}, create: { label } });
  await prisma.vatRate.upsert({ where: { code_effectiveFrom: { code: "STANDARD", effectiveFrom: toDbDate("2018-01-01") } }, update: {}, create: { code: "STANDARD", rate: 5, effectiveFrom: toDbDate("2018-01-01") } });
  await prisma.vatRate.upsert({ where: { code_effectiveFrom: { code: "ZERO", effectiveFrom: toDbDate("2018-01-01") } }, update: {}, create: { code: "ZERO", rate: 0, effectiveFrom: toDbDate("2018-01-01") } });

  // Break-glass administrator (password + TOTP enrolment on first sign-in)
  const admin = await prisma.role.findUniqueOrThrow({ where: { key: "ADMINISTRATOR" } });
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@tabconsultants.test").toLowerCase();
  await prisma.user.upsert({ where: { email: adminEmail }, update: {}, create: { email: adminEmail, name: "System Administrator", roleId: admin.id, passwordHash: await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? DEMO_PASSWORD, 12) } });
}

// ───────────────────────── Demo data ─────────────────────────

const pick = <T,>(a: T[], i: number) => a[i % a.length];

async function demo() {
  if ((await prisma.client.count()) > 0) {
    console.log("Clients already exist — demo data skipped.");
    return;
  }
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const role = async (k: RoleKey) => (await prisma.role.findUniqueOrThrow({ where: { key: k } })).id;
  const mk = async (email: string, name: string, k: RoleKey, managerId?: string) =>
    prisma.user.create({ data: { email: `${email}@tabconsultants.test`, name, roleId: await role(k), passwordHash: hash, managerId } });

  const mp = await mk("mp", "Tariq Al Bakri", "MANAGING_PARTNER");
  const p1 = await mk("partner.audit", "Sara Haddad", "PARTNER");
  const p2 = await mk("partner.tax", "Imran Qureshi", "PARTNER");
  const m1 = await mk("manager.tax", "Nadia Farouk", "MANAGER");
  const m2 = await mk("manager.audit", "Omar Siddiqui", "MANAGER");
  const sa = await mk("senior", "Priya Nair", "SENIOR_ACCOUNTANT", m1.id);
  const ac = await mk("accountant", "Hassan Raza", "ACCOUNTANT", m1.id);
  const tc = await mk("taxconsultant", "Lina Mansour", "TAX_CONSULTANT", m1.id);
  const au = await mk("audit", "Ahmed Yousuf", "AUDIT_STAFF", m2.id);
  const bd = await mk("bd", "Rania Khalil", "BUSINESS_DEVELOPMENT");
  await mk("readonly", "Audit Observer", "READ_ONLY");
  void mp;

  const today = todayDubai();
  const names = [
    "Al Noor Trading LLC", "Gulf Horizon General Trading LLC", "Desert Bloom Restaurants LLC", "Marina Tech Solutions FZ-LLC", "Sharjah Packaging Industries LLC",
    "Falcon Logistics FZE", "Emirates Precision Engineering LLC", "Oasis Healthcare Clinic LLC", "Blue Pearl Real Estate Brokers LLC", "Creek Side Textiles LLC",
    "Saffron Spice Importers LLC", "Jumeirah Interiors LLC", "Coral Bay Marine Services LLC", "Al Qasba Event Management LLC", "Northern Star Consultancy FZE",
    "Palm Grove Auto Spare Parts LLC", "Hatta Water Solutions LLC", "Silicon Oasis Electronics FZCO", "Al Majaz Education Services LLC", "Golden Dune Building Contracting LLC",
  ];
  const emirates = ["Dubai", "Sharjah", "Abu Dhabi", "Sharjah", "Ajman", "Dubai", "Ras Al Khaimah"];
  // varied year-ends: 31 Dec, 31 Mar, 30 Jun, 30 Sep, and one with none recorded
  const fyEnds: ([number, number] | null)[] = [[12, 31], [3, 31], [6, 30], [12, 31], [9, 30], [3, 31], [12, 31], [6, 30], null, [12, 31]];
  const vat: FilingFrequency[] = ["QUARTERLY", "QUARTERLY", "MONTHLY", "QUARTERLY", "NOT_REGISTERED", "QUARTERLY", "MONTHLY", "QUARTERLY", "QUARTERLY", "ANNUAL"];
  // VAT anchors deliberately NOT calendar quarters for some clients
  const anchors = ["2024-01-01", "2024-02-01", "2024-01-01", "2024-03-01", "2024-01-01", "2024-04-01", "2024-01-01", "2024-02-01", "2024-01-01", "2024-01-01"];
  const staff = [sa, ac, tc];

  for (let i = 0; i < 20; i++) {
    const fy = pick(fyEnds, i);
    const freq = pick(vat, i);
    const code = `TAB-${String(1001 + i)}`;
    const licExp = addDays(today, [45, 200, 12, 330, 75, 400, 25, 160, 95, 280][i % 10]);
    const isAudit = i % 3 === 0;
    const preparer = isAudit ? au : pick(staff, i);
    const manager = isAudit ? m2 : m1;
    const partner = isAudit ? p1 : p2;
    const trn = freq !== "NOT_REGISTERED" ? `100${String(400000000000 + i * 7919)}` : null;
    const name = names[i];
    const c = await prisma.client.create({
      data: {
        clientCode: code,
        legalName: name,
        tradeName: name.replace(/ (LLC|FZE|FZ-LLC|FZCO)$/, ""),
        entityType: name.includes("FZ") ? "FREE_ZONE_COMPANY" : "LLC",
        licenceNumber: `CN-${3100000 + i * 137}`,
        licenceAuthority: name.includes("FZ") ? "Shams Free Zone" : "Department of Economy and Tourism",
        licenceExpiry: toDbDate(licExp),
        emirate: pick(emirates, i),
        industry: ["Trading", "Hospitality", "Technology", "Manufacturing", "Logistics", "Healthcare", "Real estate", "Construction"][i % 8],
        status: "ACTIVE",
        fyEndMonth: fy?.[0] ?? null,
        fyEndDay: fy?.[1] ?? null,
        relationshipPartnerId: partner.id,
        searchText: "",
        taxProfile: {
          create: {
            vatTrn: trn,
            vatFrequency: freq,
            vatPeriodAnchor: freq !== "NOT_REGISTERED" ? toDbDate(pick(anchors, i)) : null,
            vatEffectiveDate: freq !== "NOT_REGISTERED" ? toDbDate("2023-01-01") : null,
            ctRegistered: true,
            ctRegistrationNo: `CT${String(20000000 + i * 3571)}`,
            ctFirstPeriodStart: toDbDate("2024-01-01"),
            freeZone: name.includes("FZ"),
            qfzpStatus: name.includes("FZ") && i % 2 === 0,
            smallBusinessRelief: i % 7 === 3,
          },
        },
        contacts: {
          create: [
            { name: ["Khalid", "Fatima", "Rahul", "Maryam", "Yousef"][i % 5] + " " + ["Hamdan", "Saleh", "Menon", "Ali", "Nasser"][i % 5], designation: "Director", email: `director${i + 1}@client${i + 1}.example`, mobile: `+97150${String(1000000 + i * 4321).slice(0, 7)}`, isPrimary: true, isAuthorisedSignatory: true },
            { name: "Accounts Team", designation: "Accountant", email: `accounts@client${i + 1}.example`, isAccounts: true },
          ],
        },
        engagements: {
          create: [
            ...(freq !== "NOT_REGISTERED" ? [{ serviceLine: "VAT" as ServiceLine, fee: 6000 + i * 250, billingFrequency: "QUARTERLY" as const, contractStart: toDbDate("2025-01-01"), contractEnd: toDbDate(addDays(today, 20 + i * 15)), partnerId: partner.id, managerId: manager.id, preparerId: preparer.id }] : []),
            { serviceLine: "CORPORATE_TAX" as ServiceLine, fee: 9000 + i * 400, billingFrequency: "ANNUAL" as const, contractStart: toDbDate("2025-01-01"), partnerId: p2.id, managerId: m1.id, preparerId: tc.id },
            ...(isAudit ? [{ serviceLine: "AUDIT" as ServiceLine, fee: 25000 + i * 1000, billingFrequency: "ANNUAL" as const, contractStart: toDbDate("2025-01-01"), partnerId: p1.id, managerId: m2.id, preparerId: au.id }] : []),
            ...(i % 4 === 1 ? [{ serviceLine: "BOOKKEEPING" as ServiceLine, fee: 3000, billingFrequency: "MONTHLY" as const, contractStart: toDbDate("2025-06-01"), partnerId: partner.id, managerId: manager.id, preparerId: ac.id }] : []),
          ],
        },
      },
      include: { contacts: true, taxProfile: true },
    });
    await prisma.client.update({
      where: { id: c.id },
      data: { searchText: [c.legalName, c.tradeName, c.clientCode, c.taxProfile?.vatTrn, c.taxProfile?.ctRegistrationNo, c.licenceNumber, ...c.contacts.flatMap((x) => [x.email, x.mobile])].filter(Boolean).join(" ").toLowerCase() },
    });
  }

  const gen = await generateObligations();
  console.log(`Generated ${gen.created} obligations; ${gen.missing.length} missing-data exceptions.`);

  // Give past obligations a realistic history: most completed and paid, a few overdue, some in progress.
  const obs = await prisma.obligation.findMany({ orderBy: { statutoryDueDate: "asc" } });
  let k = 0;
  for (const o of obs) {
    const due = fromDbDate(o.statutoryDueDate);
    let path: ObligationStatus[] = [];
    if (due < today) {
      k++;
      path = k % 9 === 0 ? ["DOCUMENTS_REQUESTED", "IN_PREPARATION"] : k % 13 === 0 ? ["DOCUMENTS_REQUESTED"] : ["DOCUMENTS_REQUESTED", "DOCUMENTS_RECEIVED", "IN_PREPARATION", "PENDING_INTERNAL_REVIEW", "READY_FOR_SUBMISSION", "SUBMITTED", "COMPLETED"];
    } else if (due <= addDays(today, 21)) {
      path = [["DOCUMENTS_REQUESTED"], ["DOCUMENTS_REQUESTED", "DOCUMENTS_RECEIVED", "IN_PREPARATION"], ["DOCUMENTS_REQUESTED", "DOCUMENTS_RECEIVED", "IN_PREPARATION", "PENDING_INTERNAL_REVIEW"]][k++ % 3] as ObligationStatus[];
    }
    const setting = await prisma.obligationTypeSetting.findUnique({ where: { type: o.type } });
    path = path.filter((s) => setting?.enabledStatuses.includes(s));
    let from: ObligationStatus = o.status;
    let at = new Date(`${addDays(due, -25)}T06:00:00Z`);
    for (const to of path) {
      at = new Date(at.getTime() + 2 * 86_400_000);
      const isSub = to === "SUBMITTED";
      await prisma.obligation.update({
        where: { id: o.id },
        data: {
          status: to,
          ...(isSub ? { submissionReference: `FTA-${o.type === "VAT_RETURN" ? "VAT" : "REF"}-${100000 + k * 37}`, submissionDate: at } : {}),
          ...(to === "COMPLETED" && o.paymentStatus === "UNPAID" ? { paymentStatus: "PAID" } : {}),
          lastChangedById: o.preparerId,
        },
      });
      await prisma.obligationStatusHistory.create({ data: { obligationId: o.id, fromStatus: from, toStatus: to, changedById: o.preparerId, changedAt: at, note: "Seeded demo history" } });
      from = to;
    }
  }
  // One deliberately unassigned obligation due this week
  const nextWeek = await prisma.obligation.findFirst({ where: { statutoryDueDate: { gte: toDbDate(today), lte: toDbDate(addDays(today, 7)) }, status: "UPCOMING" } });
  if (nextWeek) await prisma.obligation.update({ where: { id: nextWeek.id }, data: { preparerId: null } });

  // Leads
  const leadRows = [
    { name: "Mohammed Al Shamsi", company: "Shamsi Perfumes Trading", source: "WEBSITE_FORM", serviceInterest: ["VAT", "BOOKKEEPING"], estimatedAnnualFee: 18000, stage: "NEW", nextActionDate: addDays(today, -2) },
    { name: "Elena Petrova", company: "Petrova Design Studio FZE", source: "REFERRAL", serviceInterest: ["BUSINESS_SETUP", "CORPORATE_TAX"], estimatedAnnualFee: 22000, stage: "CONTACTED", nextActionDate: addDays(today, 3) },
    { name: "Ravi Shankar", company: "Shankar Steel Fabrication LLC", source: "BNI", serviceInterest: ["AUDIT"], estimatedAnnualFee: 45000, stage: "PROPOSAL_SENT", nextActionDate: addDays(today, 1) },
    { name: "Aisha Rahman", company: "Rahman Family Holdings", source: "LINKEDIN", serviceInterest: ["TAX_ADVISORY", "TRANSFER_PRICING"], estimatedAnnualFee: 60000, stage: "NEGOTIATION", nextActionDate: addDays(today, -5) },
    { name: "John Carter", company: "Carter Marine Supplies", source: "FREE_ZONE_REFERRAL", serviceInterest: ["VAT"], estimatedAnnualFee: 8000, stage: "QUALIFIED", nextActionDate: addDays(today, 7) },
  ] as const;
  for (const l of leadRows)
    await prisma.lead.create({
      data: { ...l, serviceInterest: [...l.serviceInterest], ownerId: bd.id, nextActionDate: toDbDate(l.nextActionDate), firstContactAt: l.stage === "NEW" ? null : new Date(Date.now() - 5 * 86_400_000), country: "AE", email: `${l.name.split(" ")[0].toLowerCase()}@lead.example` },
    });
  void addMonths; void ymd;
}

async function main() {
  await config();
  if (DEMO) await demo();
  console.log(`Seed complete. Demo password for every *@tabconsultants.test user: ${DEMO ? DEMO_PASSWORD : "(no demo users)"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
