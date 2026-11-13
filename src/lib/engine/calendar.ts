import { prisma } from "../db";
import { WorkingCalendar, fromDbDate } from "../dates";

/** Load the working calendar for a jurisdiction from the holiday table. */
export async function loadCalendar(jurisdiction = "AE"): Promise<WorkingCalendar> {
  const rows = await prisma.holiday.findMany({ where: { jurisdiction }, select: { date: true } });
  return new WorkingCalendar(new Set(rows.map((r) => fromDbDate(r.date))));
}
