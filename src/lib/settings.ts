import { prisma } from "./db";

export const SETTING_DEFAULTS = {
  "email.paused": "true", // outbound email is paused until an administrator turns it on
  "email.testModeAddress": "", // when set, every message is redirected here
  "email.senderMailbox": "", // shared mailbox, e.g. compliance@tabconsultantsllc.com
  "email.storeBodies": "false", // Phase 2: store Outlook email bodies on sync
  "client.inactivityDays": "90",
  "digest.hourGst": "8",
  "firm.trn": "",
  "firm.address": "Shams Free Zone, Sharjah, United Arab Emirates",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? SETTING_DEFAULTS[key];
}

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await prisma.appSetting.findMany();
  const out = { ...SETTING_DEFAULTS } as Record<SettingKey, string>;
  for (const r of rows) if (r.key in out) out[r.key as SettingKey] = r.value;
  return out;
}

export async function setSetting(key: SettingKey, value: string) {
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
