/**
 * Calendar-date helpers for the deadline engine.
 *
 * Due dates are calendar dates in Asia/Dubai, represented here as `YMD` strings
 * ("2026-03-31") so no timezone arithmetic can shift them. They are stored in
 * Postgres as DATE. Timestamps (sent_at, changed_at …) are UTC timestamptz.
 */
import { TZDate } from "@date-fns/tz";

export const FIRM_TZ = "Asia/Dubai";

export type YMD = string; // yyyy-mm-dd

export function ymd(y: number, m: number, d: number): YMD {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseYmd(s: YMD): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

/** Prisma returns DATE columns as a UTC-midnight Date. */
export function fromDbDate(d: Date): YMD {
  return d.toISOString().slice(0, 10);
}

export function toDbDate(s: YMD): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(s: YMD, n: number): YMD {
  const { y, m, d } = parseYmd(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Add calendar months, clamping to month end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(s: YMD, n: number): YMD {
  const { y, m, d } = parseYmd(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Add months to a month-end date and keep it a month end (31 Mar + 3 = 30 Jun). */
export function addMonthsEom(s: YMD, n: number): YMD {
  const { y, m, d } = parseYmd(s);
  const isEom = d === daysInMonth(y, m);
  const r = addMonths(s, n);
  if (!isEom) return r;
  const p = parseYmd(r);
  return ymd(p.y, p.m, daysInMonth(p.y, p.m));
}

export function dayOfWeek(s: YMD): number {
  const { y, m, d } = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun … 6 Sat
}

export function diffDays(a: YMD, b: YMD): number {
  return Math.round((toDbDate(a).getTime() - toDbDate(b).getTime()) / 86_400_000);
}

/** Today's date in Dubai. */
export function todayDubai(now: Date = new Date()): YMD {
  const t = new TZDate(now, FIRM_TZ);
  return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

/** Current hour (0–23) in Dubai. */
export function hourDubai(now: Date = new Date()): number {
  return new TZDate(now, FIRM_TZ).getHours();
}

export function formatDate(s: YMD | Date | null | undefined): string {
  if (!s) return "—";
  const v = typeof s === "string" ? s : fromDbDate(s);
  const { y, m, d } = parseYmd(v);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
  return `${String(d).padStart(2, "0")} ${mon} ${y}`;
}

export function formatDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  const t = new TZDate(d, FIRM_TZ);
  return `${formatDate(ymd(t.getFullYear(), t.getMonth() + 1, t.getDate()))} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} GST`;
}

/** Working-day calendar: weekend days + holiday set, per jurisdiction. */
export class WorkingCalendar {
  constructor(
    private readonly holidays: Set<YMD>,
    private readonly weekend: number[] = [0, 6], // UAE: Saturday, Sunday
  ) {}

  isWorkingDay(s: YMD): boolean {
    return !this.weekend.includes(dayOfWeek(s)) && !this.holidays.has(s);
  }

  /** The date itself if it is a working day, else the previous working day. */
  onOrBefore(s: YMD): YMD {
    let c = s;
    for (let i = 0; i < 60 && !this.isWorkingDay(c); i++) c = addDays(c, -1);
    return c;
  }

  /** n working days before s (s itself is not counted). */
  subtractWorkingDays(s: YMD, n: number): YMD {
    let c = s;
    let left = n;
    while (left > 0) {
      c = addDays(c, -1);
      if (this.isWorkingDay(c)) left--;
    }
    return c;
  }
}
