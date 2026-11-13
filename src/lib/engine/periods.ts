/**
 * Pure period and due-date derivation. No database access, fully unit-tested.
 *
 * Nothing here asserts a statutory fact: rule parameters (offsets, lead times)
 * come from the versioned deadline_rule table. See BUILD_SPEC Sections 4 and 13.
 */
import { YMD, addDays, addMonths, addMonthsEom, daysInMonth, ymd, parseYmd, WorkingCalendar } from "../dates";

export type Period = { start: YMD; end: YMD };

export type RuleParams = {
  basis: "DAYS_AFTER_PERIOD_END" | "MONTHS_AFTER_PERIOD_END" | "ON_SOURCE_DATE";
  offsetDays: number;
  offsetMonths: number;
  prepLeadWorkingDays: number;
  reviewLeadWorkingDays: number;
};

export type DerivedDates = {
  statutoryDueDate: YMD;
  internalTargetDate: YMD;
  prepDeadline: YMD;
  reviewDeadline: YMD;
  movedForNonWorkingDay: boolean;
};

const FREQ_MONTHS = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 } as const;
export type Frequency = keyof typeof FREQ_MONTHS;

/**
 * VAT periods rolling from the client's anchor (first day of any one period).
 * Returns every period whose end falls in [from, to].
 */
export function vatPeriods(anchor: YMD, freq: Frequency, from: YMD, to: YMD, notBefore?: YMD): Period[] {
  const step = FREQ_MONTHS[freq];
  // move anchor back far enough to cover `from`
  let start = anchor;
  while (start > from) start = addMonths(start, -step);
  const out: Period[] = [];
  for (let i = 0; i < 400; i++) {
    const end = addDays(addMonths(start, step), -1);
    if (end > to) break;
    if (end >= from && (!notBefore || end >= notBefore)) out.push({ start, end });
    start = addMonths(start, step);
  }
  return out;
}

/** Financial years ending on fyEndMonth/fyEndDay whose end falls in [from, to]. */
export function financialYears(fyEndMonth: number, fyEndDay: number, from: YMD, to: YMD, notBefore?: YMD): Period[] {
  const out: Period[] = [];
  const fy = parseYmd(from).y - 1;
  for (let y = fy; y <= parseYmd(to).y + 1; y++) {
    const endDay = Math.min(fyEndDay, daysInMonth(y, fyEndMonth));
    const end = ymd(y, fyEndMonth, endDay);
    const start = addDays(addMonthsEom(end, -12), 1);
    if (end >= from && end <= to && (!notBefore || end >= notBefore)) out.push({ start, end });
  }
  return out;
}

export function statutoryDate(periodEnd: YMD, rule: RuleParams): YMD {
  switch (rule.basis) {
    case "DAYS_AFTER_PERIOD_END":
      return addDays(periodEnd, rule.offsetDays);
    case "MONTHS_AFTER_PERIOD_END":
      return addDays(addMonthsEom(periodEnd, rule.offsetMonths), rule.offsetDays);
    case "ON_SOURCE_DATE":
      return addDays(periodEnd, rule.offsetDays);
  }
}

/**
 * Statutory date is kept as recorded. The internal target moves to the previous
 * working day; prep and review deadlines count working days back from the target.
 */
export function deriveDates(periodEnd: YMD, rule: RuleParams, cal: WorkingCalendar): DerivedDates {
  const statutoryDueDate = statutoryDate(periodEnd, rule);
  const internalTargetDate = cal.onOrBefore(statutoryDueDate);
  return {
    statutoryDueDate,
    internalTargetDate,
    reviewDeadline: cal.subtractWorkingDays(internalTargetDate, rule.reviewLeadWorkingDays),
    prepDeadline: cal.subtractWorkingDays(internalTargetDate, rule.prepLeadWorkingDays),
    movedForNonWorkingDay: internalTargetDate !== statutoryDueDate,
  };
}
