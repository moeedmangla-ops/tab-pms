import { prisma } from "../db";

/** Every connector call is logged. Detail must never contain client personal data or secrets. */
export async function logConnector(
  connector: string,
  direction: "INBOUND" | "OUTBOUND",
  status: "OK" | "ERROR" | "DISABLED",
  detail?: string,
  record?: { type: string; id: string },
) {
  try {
    await prisma.connectorLog.create({
      data: { connector, direction, status, detail: detail?.slice(0, 1000), recordType: record?.type, recordId: record?.id },
    });
  } catch {
    // logging must never break the caller
  }
}
