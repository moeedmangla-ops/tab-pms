"use server";
import { RoleKey, RuleBasis, ObligationType } from "@prisma/client";
import { requireUser, clientIp, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { setSetting, SettingKey } from "@/lib/settings";
import { act, str } from "@/lib/web";
import { toDbDate } from "@/lib/dates";
import { ValidationError } from "@/lib/services/obligations";
import { runJob, JobName, JOBS } from "@/jobs/runner";

async function admin() {
  const u = await requireUser();
  requirePermission(u, "settings", "edit");
  return u;
}

export async function saveEmail(fd: FormData) {
  const u = await admin();
  await act("/settings?tab=email", async () => {
    const vals: [SettingKey, string][] = [
      ["email.paused", fd.get("paused") === "on" ? "true" : "false"],
      ["email.testModeAddress", str(fd, "testModeAddress")],
      ["email.senderMailbox", str(fd, "senderMailbox")],
      ["email.storeBodies", fd.get("storeBodies") === "on" ? "true" : "false"],
      ["client.inactivityDays", str(fd, "inactivityDays") || "90"],
      ["digest.hourGst", str(fd, "digestHour") || "8"],
      ["firm.trn", str(fd, "firmTrn")],
    ];
    for (const [k, v] of vals) await setSetting(k, v);
    await audit(prisma, { userId: u.id, ip: await clientIp(), action: "UPDATE", table: "app_setting", recordId: "email", after: Object.fromEntries(vals) });
  }, "Settings saved");
}

export async function newRuleVersion(fd: FormData) {
  const u = await admin();
  await act("/settings?tab=rules", async () => {
    const code = str(fd, "code");
    const prev = await prisma.deadlineRule.findFirst({ where: { code }, orderBy: { version: "desc" } });
    const effectiveFrom = str(fd, "effectiveFrom");
    if (!effectiveFrom) throw new ValidationError("Effective-from date is required.");
    const r = await prisma.$transaction(async (tx) => {
      if (prev && !prev.effectiveTo) {
        const end = new Date(toDbDate(effectiveFrom).getTime() - 86_400_000);
        if (end < prev.effectiveFrom) throw new ValidationError("New version must start after the current version's effective date.");
        await tx.deadlineRule.update({ where: { id: prev.id }, data: { effectiveTo: end } });
      }
      const r = await tx.deadlineRule.create({
        data: {
          code: code || `RULE_${Date.now()}`,
          version: (prev?.version ?? 0) + 1,
          obligationType: (str(fd, "obligationType") || prev?.obligationType) as ObligationType,
          name: str(fd, "name") || prev?.name || "Rule",
          basis: (str(fd, "basis") || prev?.basis) as RuleBasis,
          offsetDays: Number(str(fd, "offsetDays") || 0),
          offsetMonths: Number(str(fd, "offsetMonths") || 0),
          prepLeadWorkingDays: Number(str(fd, "prep") || 10),
          reviewLeadWorkingDays: Number(str(fd, "review") || 5),
          effectiveFrom: toDbDate(effectiveFrom),
          notes: str(fd, "notes") || null,
        },
      });
      await audit(tx, { userId: u.id, ip: await clientIp(), action: "CREATE", table: "deadline_rule", recordId: r.id, after: r });
      return r;
    });
    void r;
  }, "New rule version saved. Existing obligations keep the version that produced them.");
}

export async function confirmRule(fd: FormData) {
  const u = await admin();
  await act("/settings?tab=rules", async () => {
    const r = await prisma.deadlineRule.update({ where: { id: str(fd, "id") }, data: { isConfirmed: true, confirmedById: u.id, confirmedAt: new Date() } });
    await audit(prisma, { userId: u.id, action: "UPDATE", table: "deadline_rule", recordId: r.id, before: { isConfirmed: false }, after: { isConfirmed: true } });
  }, "Rule confirmed");
}

export async function saveReminderRule(fd: FormData) {
  const u = await admin();
  await act("/settings?tab=reminders", async () => {
    const id = str(fd, "id");
    const before = await prisma.reminderRule.findUniqueOrThrow({ where: { id } });
    const offsets = str(fd, "offsets").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
    if (offsets.some((n) => !Number.isInteger(n) || n < 0)) throw new ValidationError("Offsets must be whole numbers of days, comma-separated.");
    const r = await prisma.reminderRule.update({ where: { id }, data: { isActive: fd.get("isActive") === "on", offsetsDays: offsets, repeatEveryDays: str(fd, "repeat") ? Number(str(fd, "repeat")) : before.repeatEveryDays } });
    await audit(prisma, { userId: u.id, action: "UPDATE", table: "reminder_rule", recordId: id, before, after: r });
  }, "Reminder rule saved");
}

export async function saveTemplate(fd: FormData) {
  const u = await admin();
  await act(`/settings?tab=templates`, async () => {
    const key = str(fd, "key");
    const before = await prisma.emailTemplate.findUniqueOrThrow({ where: { key } });
    const t = await prisma.emailTemplate.update({ where: { key }, data: { subject: str(fd, "subject"), body: String(fd.get("body") ?? "") } });
    await audit(prisma, { userId: u.id, action: "UPDATE", table: "email_template", recordId: key, before, after: t });
  }, "Template saved");
}

export async function addHoliday(fd: FormData) {
  const u = await admin();
  await act("/settings?tab=holidays", async () => {
    const h = await prisma.holiday.create({ data: { date: toDbDate(str(fd, "date")), name: str(fd, "name"), isConfirmed: fd.get("isConfirmed") === "on", jurisdiction: "AE" } });
    await audit(prisma, { userId: u.id, action: "CREATE", table: "holiday", recordId: h.id, after: h });
  }, "Holiday added. Internal dates on new obligations use it; existing obligations are unchanged.");
}

export async function removeHoliday(fd: FormData) {
  const u = await admin();
  await act("/settings?tab=holidays", async () => {
    const h = await prisma.holiday.delete({ where: { id: str(fd, "id") } });
    await audit(prisma, { userId: u.id, action: "DELETE", table: "holiday", recordId: h.id, after: h });
  }, "Holiday removed");
}

export async function confirmHoliday(fd: FormData) {
  const u = await admin();
  await act("/settings?tab=holidays", async () => {
    const h = await prisma.holiday.update({ where: { id: str(fd, "id") }, data: { isConfirmed: true } });
    await audit(prisma, { userId: u.id, action: "UPDATE", table: "holiday", recordId: h.id, after: h });
  }, "Holiday confirmed");
}

export async function addUser(fd: FormData) {
  const u = await admin();
  await act("/settings?tab=users", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: str(fd, "role") as RoleKey } });
    const pw = String(fd.get("password") ?? "");
    if (pw && pw.length < 12) throw new ValidationError("Password must be at least 12 characters (or leave blank for Microsoft sign-in only).");
    const n = await prisma.user.create({ data: { email: str(fd, "email").toLowerCase(), name: str(fd, "name"), roleId: role.id, managerId: str(fd, "managerId") || null, passwordHash: pw ? await hashPassword(pw) : null } });
    await audit(prisma, { userId: u.id, action: "CREATE", table: "user", recordId: n.id, after: { email: n.email, role: role.key } });
  }, "User added. They enrol two-factor at first sign-in.");
}

export async function updateUser(fd: FormData) {
  const u = await admin();
  await act("/settings?tab=users", async () => {
    const id = str(fd, "id");
    const before = await prisma.user.findUniqueOrThrow({ where: { id } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: str(fd, "role") as RoleKey } });
    const active = fd.get("isActive") === "on";
    const n = await prisma.user.update({
      where: { id },
      data: { roleId: role.id, managerId: str(fd, "managerId") || null, isActive: active, onLeaveFrom: str(fd, "leaveFrom") ? toDbDate(str(fd, "leaveFrom")) : null, onLeaveTo: str(fd, "leaveTo") ? toDbDate(str(fd, "leaveTo")) : null, ...(fd.get("reset2fa") === "on" ? { totpEnabled: false, totpSecret: null } : {}) },
    });
    if (!active) await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(prisma, { userId: u.id, action: "UPDATE", table: "user", recordId: id, before: { roleId: before.roleId, isActive: before.isActive, managerId: before.managerId }, after: { roleId: n.roleId, isActive: n.isActive, managerId: n.managerId } });
  }, "User saved");
}

export async function runNow(fd: FormData) {
  await admin();
  const name = str(fd, "job") as JobName;
  await act("/settings?tab=jobs", async () => {
    if (!(name in JOBS)) throw new ValidationError("Unknown job");
    await runJob(name);
  }, `${name} ran`);
}
