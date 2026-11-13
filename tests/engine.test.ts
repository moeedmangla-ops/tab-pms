import { describe, expect, it } from "vitest";
import { WorkingCalendar, addMonthsEom, dayOfWeek } from "../src/lib/dates";
import { deriveDates, financialYears, vatPeriods, RuleParams } from "../src/lib/engine/periods";
import { validateTransition, tone, isOverdue } from "../src/lib/engine/workflow";
import { sendDateBefore, dedupeKey } from "../src/lib/engine/reminders";
import { MATRIX } from "../src/lib/permissions";
import { parseCsv } from "../src/lib/services/import";

const VAT: RuleParams = { basis: "DAYS_AFTER_PERIOD_END", offsetDays: 28, offsetMonths: 0, prepLeadWorkingDays: 10, reviewLeadWorkingDays: 5 };
const CT: RuleParams = { basis: "MONTHS_AFTER_PERIOD_END", offsetDays: 0, offsetMonths: 9, prepLeadWorkingDays: 10, reviewLeadWorkingDays: 5 };
const cal = new WorkingCalendar(new Set(["2026-03-20", "2026-12-02", "2026-12-03"]));

describe("working calendar", () => {
  it("treats Saturday and Sunday as the weekend, Friday as a working day", () => {
    expect(cal.isWorkingDay("2026-11-13")).toBe(true); // Friday
    expect(cal.isWorkingDay("2026-11-14")).toBe(false); // Saturday
    expect(cal.isWorkingDay("2026-11-15")).toBe(false); // Sunday
  });
  it("moves a Friday public holiday to Thursday", () => {
    expect(dayOfWeek("2026-03-20")).toBe(5);
    expect(cal.onOrBefore("2026-03-20")).toBe("2026-03-19");
  });
  it("moves a Sunday to the previous Friday", () => {
    expect(cal.onOrBefore("2026-02-28")).toBe("2026-02-27");
  });
  it("skips a Friday holiday when moving off a weekend", () => {
    expect(cal.onOrBefore("2026-03-22")).toBe("2026-03-19");
  });
});

describe("period derivation", () => {
  it("31 March year-end produces April–March financial years", () => {
    const fys = financialYears(3, 31, "2026-01-01", "2028-06-30");
    expect(fys).toEqual([
      { start: "2025-04-01", end: "2026-03-31" },
      { start: "2026-04-01", end: "2027-03-31" },
      { start: "2027-04-01", end: "2028-03-31" },
    ]);
  });
  it("quarterly VAT periods follow the client's anchor, not calendar quarters", () => {
    const p = vatPeriods("2024-02-01", "QUARTERLY", "2026-01-01", "2026-12-31");
    expect(p.map((x) => x.end)).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
    expect(p[1].start).toBe("2026-02-01");
  });
  it("monthly VAT periods end on month ends", () => {
    const p = vatPeriods("2024-01-01", "MONTHLY", "2026-01-01", "2026-03-31");
    expect(p.map((x) => x.end)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
  it("respects the registration date", () => {
    expect(vatPeriods("2024-01-01", "QUARTERLY", "2024-01-01", "2024-12-31", "2024-07-01").map((x) => x.end)).toEqual(["2024-09-30", "2024-12-31"]);
  });
  it("month-end arithmetic keeps month ends", () => {
    expect(addMonthsEom("2026-03-31", 9)).toBe("2026-12-31");
    expect(addMonthsEom("2026-06-30", 9)).toBe("2027-03-31");
    expect(addMonthsEom("2026-05-31", 9)).toBe("2027-02-28");
  });
});

describe("due-date derivation", () => {
  it("VAT: 28 days after period end", () => {
    expect(deriveDates("2026-10-31", VAT, cal).statutoryDueDate).toBe("2026-11-28");
  });
  it("keeps the statutory date and moves the internal target off a weekend", () => {
    const d = deriveDates("2026-10-31", VAT, cal); // 28 Nov 2026 is a Saturday
    expect(d.statutoryDueDate).toBe("2026-11-28");
    expect(d.internalTargetDate).toBe("2026-11-27");
    expect(d.movedForNonWorkingDay).toBe(true);
  });
  it("internal deadlines: prep 10 working days and review 5 working days before target", () => {
    const d = deriveDates("2026-10-31", VAT, cal);
    expect(d.reviewDeadline).toBe("2026-11-20");
    expect(d.prepDeadline).toBe("2026-11-13");
  });
  it("CT: 9 months after a 31 March year-end is 31 December", () => {
    expect(deriveDates("2026-03-31", CT, cal).statutoryDueDate).toBe("2026-12-31");
  });
  it("a due date on a Friday public holiday moves the target to Thursday", () => {
    // period end 2026-02-20 + 28 days = 2026-03-20 (Friday, holiday)
    const d = deriveDates("2026-02-20", VAT, cal);
    expect(d.statutoryDueDate).toBe("2026-03-20");
    expect(d.internalTargetDate).toBe("2026-03-19");
  });
});

describe("status workflow", () => {
  const o = { status: "READY_FOR_SUBMISSION" as const, submissionReference: null, paymentStatus: "UNPAID" as const };
  it("Submitted requires a submission reference", () => {
    expect(validateTransition(o, { to: "SUBMITTED" }, null)).toMatch(/reference/);
    expect(validateTransition(o, { to: "SUBMITTED", submissionReference: "ABC123" }, null)).toBeNull();
  });
  it("On Hold requires a reason", () => {
    expect(validateTransition(o, { to: "ON_HOLD" }, null)).toMatch(/reason/);
  });
  it("Completed requires payment or a waiver", () => {
    const s = { ...o, status: "PAYMENT_PENDING" as const, submissionReference: "X" };
    expect(validateTransition(s, { to: "COMPLETED" }, null)).toMatch(/payment/);
    expect(validateTransition(s, { to: "COMPLETED", paymentConfirmed: true }, null)).toBeNull();
    expect(validateTransition(s, { to: "COMPLETED", waiverReason: "Nil return" }, null)).toBeNull();
  });
  it("disabled stages are rejected", () => {
    expect(validateTransition(o, { to: "PAYMENT_PENDING", submissionReference: "x" }, ["UPCOMING", "SUBMITTED", "COMPLETED"])).toMatch(/not enabled/);
  });
  it("overdue is derived, and colour coding follows the spec", () => {
    const due = new Date("2026-11-10T00:00:00Z");
    expect(isOverdue({ status: "IN_PREPARATION", statutoryDueDate: due }, "2026-11-13")).toBe(true);
    expect(isOverdue({ status: "SUBMITTED", statutoryDueDate: due }, "2026-11-13")).toBe(false);
    expect(tone({ status: "IN_PREPARATION", statutoryDueDate: due }, "2026-11-13")).toBe("red");
    expect(tone({ status: "UPCOMING", statutoryDueDate: new Date("2026-11-18T00:00:00Z") }, "2026-11-13")).toBe("amber");
    expect(tone({ status: "ON_HOLD", statutoryDueDate: due }, "2026-11-13")).toBe("grey");
    expect(tone({ status: "COMPLETED", statutoryDueDate: due }, "2026-11-13")).toBe("green");
  });
});

describe("reminders", () => {
  it("a reminder date on a weekend moves to the previous working day", () => {
    expect(sendDateBefore("2026-11-30", 1, cal)).toBe("2026-11-27"); // Sunday → Friday
  });
  it("dedupe key is stable and case-insensitive on recipient", () => {
    expect(dedupeKey("o1", "r1", "A@B.com", "2026-11-13")).toBe(dedupeKey("o1", "r1", "a@b.com", "2026-11-13"));
  });
});

describe("permissions matrix", () => {
  it("Business Development sees leads only", () => {
    expect(MATRIX.BUSINESS_DEVELOPMENT.clients.scope).toBe("none");
    expect(MATRIX.BUSINESS_DEVELOPMENT.obligations.scope).toBe("none");
    expect(MATRIX.BUSINESS_DEVELOPMENT.leads.scope).toBe("all");
  });
  it("Read-only can never edit", () => {
    expect(Object.values(MATRIX.READ_ONLY).every((a) => !a.edit)).toBe(true);
  });
  it("only Managing Partner and Partner approve invoices", () => {
    const approvers = Object.entries(MATRIX).filter(([, m]) => m.invoices.approve).map(([k]) => k);
    expect(approvers.sort()).toEqual(["MANAGING_PARTNER", "PARTNER"]);
  });
});

describe("CSV import parser", () => {
  it("handles quotes, commas and CRLF", () => {
    const p = parseCsv('Client code,Legal name\r\nA1,"Smith, Jones & Co ""LLC"""\r\nA2,Beta\r\n');
    expect(p.headers).toEqual(["Client code", "Legal name"]);
    expect(p.rows[0]["Legal name"]).toBe('Smith, Jones & Co "LLC"');
    expect(p.rows).toHaveLength(2);
  });
});
