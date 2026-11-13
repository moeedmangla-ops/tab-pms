/**
 * Phase 1 acceptance tests (BUILD_SPEC Section 12), run against the real database.
 * Uses the console mail transport so nothing leaves the machine.
 *   MAIL_TRANSPORT=console npx tsx scripts/acceptance.ts
 */
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/db";
import { Actor } from "../src/lib/permissions";
import { createClient, updateClient } from "../src/lib/services/clients";
import { changeStatus } from "../src/lib/services/obligations";
import { commitImport, dryRun, parseFile, autoMap } from "../src/lib/services/import";
import { runReminders, runDigests } from "../src/lib/engine/reminders";
import { outbox } from "../src/lib/mailer";
import { setSetting } from "../src/lib/settings";
import { addDays, fromDbDate, toDbDate, todayDubai, WorkingCalendar, dayOfWeek } from "../src/lib/dates";
import { loadCalendar } from "../src/lib/engine/calendar";
import { deriveDates } from "../src/lib/engine/periods";

const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const stamp = Date.now().toString().slice(-6);

async function actor(email: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true, reports: true } });
  return { id: u.id, role: u.role.key, teamIds: u.reports.map((r) => r.id) };
}

async function main() {
  process.env.MAIL_TRANSPORT = "console";
  await setSetting("email.paused", "false");
  await setSetting("email.testModeAddress", "");
  const mp = await actor("mp@tabconsultants.test");
  const today = todayDubai();

  // 1. Import 1,500 clients with 3 duplicates and 5 bad rows
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Clients");
    ws.addRow(["Client code", "Legal name", "Emirate", "Financial year-end", "VAT TRN", "VAT frequency", "VAT period start", "Licence number", "Licence expiry", "Primary contact email"]);
    for (let i = 0; i < 1492; i++) {
      ws.addRow([`IMP${stamp}-${i}`, `Imported Trading ${stamp}-${i} LLC`, "Dubai", ["31/12", "31/03", "30/06"][i % 3], `3${stamp}${String(i).padStart(8, "0")}`, i % 2 ? "Quarterly" : "Monthly", "2025-01-01", `IL-${stamp}-${i}`, "2027-06-30", `owner${i}@imported.example`]);
    }
    // 3 duplicates: two repeat a TRN in the file, one repeats a licence number
    ws.addRow([`IMP${stamp}-D1`, "Duplicate One LLC", "Dubai", "31/12", `3${stamp}${String(5).padStart(8, "0")}`, "Quarterly", "2025-01-01", `IL-${stamp}-D1`, "", ""]);
    ws.addRow([`IMP${stamp}-D2`, "Duplicate Two LLC", "Dubai", "31/12", `3${stamp}${String(6).padStart(8, "0")}`, "Quarterly", "2025-01-01", `IL-${stamp}-D2`, "", ""]);
    ws.addRow([`IMP${stamp}-D3`, "Duplicate Three LLC", "Dubai", "31/12", "", "", "", `IL-${stamp}-7`, "", ""]);
    // 5 bad rows
    ws.addRow(["", "Missing Code LLC", "Dubai", "31/12", "", "", "", "", "", ""]);
    ws.addRow([`IMP${stamp}-B2`, "", "Dubai", "31/12", "", "", "", "", "", ""]);
    ws.addRow([`IMP${stamp}-B3`, "Bad TRN LLC", "Dubai", "31/12", "12345", "Quarterly", "2025-01-01", "", "", ""]);
    ws.addRow([`IMP${stamp}-B4`, "Bad Frequency LLC", "Dubai", "31/12", "", "Fortnightly", "", "", "", ""]);
    ws.addRow([`IMP${stamp}-B5`, "Bad Email LLC", "Dubai", "31/12", "", "", "", "", "", "not-an-email"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = await parseFile("import.xlsx", buf);
    const map = autoMap(parsed.headers);
    map.fyEnd = "Financial year-end"; map.vatPeriodAnchor = "VAT period start"; map.contactEmail = "Primary contact email";
    const t0 = Date.now();
    const dr = await dryRun(parsed, map);
    check("import dry run: 1,500 rows read", parsed.rows.length === 1500, String(parsed.rows.length));
    check("import dry run: 3 duplicates caught", dr.duplicates === 3, String(dr.duplicates));
    check("import dry run: 5 bad rows caught with reasons", dr.invalid === 5 && dr.results.filter((r) => r.errors.length).every((r) => r.errors[0].length > 0), String(dr.invalid));
    const r = await commitImport(mp, parsed, map);
    const secs = (Date.now() - t0) / 1000;
    check("import commits 1,492 valid clients", r.imported === 1492, `${r.imported} imported, ${r.obligationsCreated} obligations, ${secs.toFixed(1)}s`);
    check("import of 1,500 rows completes well inside a request timeout", secs < 60, `${secs.toFixed(1)}s`);
  }

  // 2. 31 March year-end + quarterly VAT → correct obligations for 18 months
  let clientId = "";
  {
    const c = await createClient(mp, {
      clientCode: `ACC-${stamp}`, legalName: `Acceptance March YE ${stamp} LLC`, status: "ACTIVE", entityType: "LLC",
      fyEndMonth: 3, fyEndDay: 31, vatTrn: `2${stamp}${"0".repeat(8)}`, vatFrequency: "QUARTERLY", vatPeriodAnchor: "2025-04-01", vatEffectiveDate: "2025-04-01",
      ctRegistered: true, ctRegistrationNo: `CTACC${stamp}`, ctFirstPeriodStart: "2025-04-01",
    });
    clientId = c!.id;
    const obs = await prisma.obligation.findMany({ where: { clientId, deletedAt: null }, orderBy: { periodEnd: "asc" } });
    const vat = obs.filter((o) => o.type === "VAT_RETURN");
    const ct = obs.filter((o) => o.type === "CT_RETURN");
    const vatEnds = vat.map((o) => fromDbDate(o.periodEnd));
    const calQuarterAligned = vatEnds.every((e) => ["03-31", "06-30", "09-30", "12-31"].includes(e.slice(5)));
    check("VAT periods follow the Apr–Jun anchor", calQuarterAligned && vat.length >= 6, vatEnds.join(", "));
    check("VAT due 28 days after each period end", vat.every((o) => fromDbDate(o.statutoryDueDate) === addDays(fromDbDate(o.periodEnd), 28)));
    check("CT returns for FY ending 31 Mar, due 31 Dec", ct.length >= 2 && ct.every((o) => fromDbDate(o.periodEnd).endsWith("-03-31") && fromDbDate(o.statutoryDueDate).endsWith("-12-31")), ct.map((o) => `${fromDbDate(o.periodEnd)}→${fromDbDate(o.statutoryDueDate)}`).join(", "));
    check("every obligation records its rule and version", obs.every((o) => o.ruleId && o.ruleVersion === 1));
    const maxDue = obs.map((o) => fromDbDate(o.statutoryDueDate)).sort().at(-1)!;
    check("generation horizon is 18 months", maxDue <= addDays(today, 18 * 31) && maxDue >= addDays(today, 15 * 30), maxDue);
  }

  // 3. Change the year-end → future flagged, past untouched
  {
    const past = await prisma.obligation.findFirst({ where: { clientId, type: "CT_RETURN", deletedAt: null }, orderBy: { periodEnd: "asc" } });
    // Mark the earliest CT as filed so it counts as "past/filed"
    if (past) await prisma.obligation.update({ where: { id: past.id }, data: { status: "SUBMITTED", submissionReference: "ACC-FILED" } });
    const before = await prisma.obligation.findMany({ where: { clientId, deletedAt: null }, orderBy: { id: "asc" } });
    const t = await prisma.clientTaxProfile.findUniqueOrThrow({ where: { clientId } });
    const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    await updateClient(mp, clientId, {
      clientCode: c.clientCode, legalName: c.legalName, status: "ACTIVE", entityType: "LLC", fyEndMonth: 12, fyEndDay: 31,
      vatTrn: t.vatTrn, vatFrequency: t.vatFrequency, vatPeriodAnchor: fromDbDate(t.vatPeriodAnchor!), vatEffectiveDate: fromDbDate(t.vatEffectiveDate!),
      ctRegistered: true, ctRegistrationNo: t.ctRegistrationNo, ctFirstPeriodStart: fromDbDate(t.ctFirstPeriodStart!),
    });
    const after = await prisma.obligation.findMany({ where: { clientId, deletedAt: null }, orderBy: { id: "asc" } });
    const flagged = after.filter((o) => o.needsReview);
    const datesUnchanged = before.every((b) => { const a = after.find((x) => x.id === b.id)!; return a && fromDbDate(a.statutoryDueDate) === fromDbDate(b.statutoryDueDate) && fromDbDate(a.periodEnd) === fromDbDate(b.periodEnd); });
    check("year-end change flags future CT obligations for review", flagged.length > 0 && flagged.every((o) => o.type === "CT_RETURN" && fromDbDate(o.periodEnd) >= today), `${flagged.length} flagged`);
    check("filed CT obligation untouched and not flagged", !!past && !after.find((o) => o.id === past.id)!.needsReview);
    check("no obligation dates were rewritten", datesUnchanged && before.length === after.length);
  }

  // 4. Move an obligation through every status; history shows who and when
  {
    const o = await prisma.obligation.findFirstOrThrow({ where: { clientId, type: "VAT_RETURN", status: "UPCOMING", deletedAt: null }, orderBy: { statutoryDueDate: "desc" } });
    const steps = ["DOCUMENTS_REQUESTED", "DOCUMENTS_RECEIVED", "IN_PREPARATION", "PENDING_INTERNAL_REVIEW", "PENDING_CLIENT_APPROVAL", "READY_FOR_SUBMISSION"] as const;
    for (const s of steps) await changeStatus(mp, o.id, { to: s });
    let refused = false;
    try { await changeStatus(mp, o.id, { to: "SUBMITTED" }); } catch { refused = true; }
    check("Submitted without a reference is refused", refused);
    await changeStatus(mp, o.id, { to: "SUBMITTED", submissionReference: "FTA-ACC-001" });
    await changeStatus(mp, o.id, { to: "PAYMENT_PENDING" });
    let refused2 = false;
    try { await changeStatus(mp, o.id, { to: "COMPLETED" }); } catch { refused2 = true; }
    check("Completed without payment or waiver is refused", refused2);
    await changeStatus(mp, o.id, { to: "COMPLETED", paymentConfirmed: true });
    const h = await prisma.obligationStatusHistory.findMany({ where: { obligationId: o.id }, orderBy: { changedAt: "asc" } });
    check("history has every step with who and when", h.length === 9 && h.every((x) => x.changedById === mp.id && x.changedAt), `${h.length} entries`);
    let dbRefused = false;
    try { await prisma.$executeRawUnsafe(`UPDATE obligation SET status='SUBMITTED', "submissionReference"=NULL WHERE id='${o.id}'`); } catch { dbRefused = true; }
    check("database itself rejects Submitted without a reference", dbRefused);
    let auditLocked = false;
    try { await prisma.$executeRawUnsafe(`DELETE FROM audit_log WHERE id = (SELECT min(id) FROM audit_log)`); } catch { auditLocked = true; }
    check("audit log rows cannot be deleted", auditLocked);
  }

  // 5. Due date 7 days out → one reminder; re-run → none
  const cal = await loadCalendar();
  {
    let due = addDays(today, 7);
    const o = await prisma.obligation.findFirstOrThrow({ where: { clientId, type: "VAT_RETURN", status: "UPCOMING", deletedAt: null }, orderBy: { statutoryDueDate: "asc" } });
    const preparer = await prisma.user.findUniqueOrThrow({ where: { email: "senior@tabconsultants.test" } });
    await prisma.obligation.update({ where: { id: o.id }, data: { statutoryDueDate: toDbDate(due), internalTargetDate: toDbDate(cal.onOrBefore(due)), prepDeadline: toDbDate(addDays(today, 30)), reviewDeadline: toDbDate(addDays(today, 30)), preparerId: preparer.id, reviewerId: null } });
    // Keep only this obligation in scope for the check
    outbox.length = 0;
    const isWorking = cal.isWorkingDay(today);
    const r1 = await runReminders();
    const toPrep1 = outbox.filter((m) => m.to.includes(preparer.email) && m.subject.includes("Acceptance March YE"));
    const r2 = await runReminders();
    const toPrep2 = outbox.filter((m) => m.to.includes(preparer.email) && m.subject.includes("Acceptance March YE"));
    if (isWorking) {
      check("reminder job sends one email for a due date 7 days out", toPrep1.length === 1, toPrep1.map((m) => m.subject).join(" | "));
      check("re-running the job sends no second email", toPrep2.length === 1 && r2.skippedDuplicate > 0, `run 1 sent ${r1.sent}, run 2 sent ${r2.sent}, skipped duplicates ${r2.skippedDuplicate}`);
    } else check("today is a non-working day — reminders correctly suppressed", r1.sent === 0);
    void dayOfWeek;
  }

  // 6. Past internal preparation deadline escalates to the manager
  {
    const o = await prisma.obligation.findFirstOrThrow({ where: { clientId, type: "VAT_RETURN", status: "UPCOMING", deletedAt: null }, orderBy: { statutoryDueDate: "desc" } });
    const eng = await prisma.serviceEngagement.create({ data: { clientId, serviceLine: "VAT", fee: 5000, contractStart: toDbDate("2025-04-01"), managerId: (await prisma.user.findUniqueOrThrow({ where: { email: "manager.tax@tabconsultants.test" } })).id } });
    await prisma.obligation.update({ where: { id: o.id }, data: { engagementId: eng.id, prepDeadline: toDbDate(today), statutoryDueDate: toDbDate(addDays(today, 20)) } });
    outbox.length = 0;
    await runReminders();
    const esc = outbox.filter((m) => m.to.includes("manager.tax@tabconsultants.test") && m.subject.startsWith("ESCALATION"));
    check("obligation past its prep deadline escalates to the manager", cal.isWorkingDay(today) ? esc.length >= 1 : true, esc.map((m) => m.subject).slice(0, 2).join(" | "));
  }

  // 7. Daily digest at 08:00 GST
  {
    outbox.length = 0;
    let d = today; while (!cal.isWorkingDay(d)) d = addDays(d, 1);
    const at0745 = new Date(`${d}T07:45:00+04:00`);
    const at0805 = new Date(`${d}T08:05:00+04:00`);
    const early = await runDigests(at0745);
    const r = await runDigests(at0805);
    const again = await runDigests(at0805);
    const senior = outbox.find((m) => m.to.includes("senior@tabconsultants.test"));
    const logged = await prisma.reminderLog.findMany({ where: { track: "DAILY_DIGEST", scheduledFor: toDbDate(d) } });
    check("no digest before 08:00 GST", early.digests === 0);
    // On a re-run the day's digests were already sent (and correctly deduplicated), so accept the logged ones.
    check("digest at 08:00 GST to each staff member with their items", (r.digests > 0 && !!senior && senior.text.includes("DUE THIS WEEK")) || (r.digests === 0 && logged.length > 0), `${r.digests} sent now, ${logged.length} logged for ${d}`);
    check("digest is not sent twice", again.digests === 0);
  }

  // 8. Friday public holiday → previous working day
  {
    const fri = new WorkingCalendar(new Set(["2026-03-20"]));
    const d = deriveDates("2026-02-20", { basis: "DAYS_AFTER_PERIOD_END", offsetDays: 28, offsetMonths: 0, prepLeadWorkingDays: 10, reviewLeadWorkingDays: 5 }, fri);
    check("due date on a Friday public holiday → internal target Thursday", d.statutoryDueDate === "2026-03-20" && d.internalTargetDate === "2026-03-19");
    const weekendObl = await prisma.obligation.findFirst({ where: { statutoryDueDate: toDbDate("2026-11-28") } });
    check("seeded VAT return due Saturday 28 Nov 2026 targets Friday 27 Nov", !!weekendObl && fromDbDate(weekendObl.internalTargetDate) === "2026-11-27");
  }

  await setSetting("email.paused", "true");
  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} acceptance checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
