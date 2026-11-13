/**
 * Seeded load test (BUILD_SPEC Section 11): tops the database up to 10,000 clients,
 * runs the nightly generator, then times the list endpoints.
 *   npx tsx scripts/loadtest.ts            (run against a disposable database)
 */
import { prisma } from "../src/lib/db";
import { generateObligations } from "../src/lib/engine/generate";
import { listObligations } from "../src/lib/services/obligations";
import { listClients } from "../src/lib/services/clients";
import { Actor } from "../src/lib/permissions";
import { addDays, todayDubai } from "../src/lib/dates";

const TARGET = Number(process.env.LOAD_CLIENTS ?? 10_000);

async function time<T>(label: string, f: () => Promise<T>, runs = 5) {
  await f(); // warm
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); await f(); ts.push(performance.now() - t); }
  ts.sort((a, b) => a - b);
  const med = ts[Math.floor(ts.length / 2)];
  console.log(`${med < 500 ? "PASS" : "FAIL"}  ${label}: median ${med.toFixed(0)} ms (max ${ts.at(-1)!.toFixed(0)} ms)`);
  return med;
}

async function main() {
  const have = await prisma.client.count();
  const add = Math.max(0, TARGET - have);
  const stamp = Date.now().toString(36);
  const users = await prisma.user.findMany({ where: { role: { key: { in: ["ACCOUNTANT", "SENIOR_ACCOUNTANT", "TAX_CONSULTANT"] } } } });
  const managers = await prisma.user.findMany({ where: { role: { key: "MANAGER" } } });
  console.log(`Adding ${add} clients…`);
  const t0 = performance.now();
  for (let i = 0; i < add; i += 1000) {
    const n = Math.min(1000, add - i);
    const created = await prisma.client.createManyAndReturn({
      data: Array.from({ length: n }, (_, k) => ({ clientCode: `LT-${stamp}-${i + k}`, legalName: `Load Test ${i + k} Trading LLC`, status: "ACTIVE" as const, fyEndMonth: [3, 6, 9, 12][(i + k) % 4], fyEndDay: [31, 30, 30, 31][(i + k) % 4], emirate: "Dubai", searchText: `load test ${i + k} trading llc lt-${stamp}-${i + k}` })),
      select: { id: true },
    });
    await prisma.clientTaxProfile.createMany({ data: created.map((c, k) => ({ clientId: c.id, vatFrequency: k % 3 === 0 ? "MONTHLY" as const : "QUARTERLY" as const, vatPeriodAnchor: new Date(`2024-0${(k % 3) + 1}-01T00:00:00Z`), ctRegistered: true })) });
    await prisma.serviceEngagement.createMany({ data: created.map((c, k) => ({ clientId: c.id, serviceLine: "VAT" as const, fee: 5000, contractStart: new Date("2025-01-01T00:00:00Z"), preparerId: users[k % users.length].id, managerId: managers[k % managers.length].id })) });
  }
  console.log(`Clients inserted in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const g0 = performance.now();
  const g = await generateObligations();
  const gs = (performance.now() - g0) / 1000;
  const total = await prisma.obligation.count();
  console.log(`Nightly generation: ${g.processed} clients, ${g.created} obligations created in ${gs.toFixed(1)} s. Total obligations: ${total}`);
  const g2 = performance.now();
  const again = await generateObligations();
  console.log(`Re-run (idempotent): ${again.created} created in ${((performance.now() - g2) / 1000).toFixed(1)} s`);
  await prisma.$executeRawUnsafe("ANALYZE");

  const mpU = await prisma.user.findFirstOrThrow({ where: { role: { key: "MANAGING_PARTNER" } } });
  const mp: Actor = { id: mpU.id, role: "MANAGING_PARTNER", teamIds: [] };
  const acU = users[0];
  const ac: Actor = { id: acU.id, role: "ACCOUNTANT", teamIds: [] };
  const today = todayDubai();
  console.log(`\nAt ${await prisma.client.count()} clients and ${total} obligations:`);
  await time("obligations — whole firm, open, page 1", () => listObligations(mp, { view: "firm", status: "OPEN" }, 1, 50));
  await time("obligations — whole firm, overdue", () => listObligations(mp, { view: "firm", status: "OVERDUE" }, 1, 50));
  await time("obligations — due next 7 days", () => listObligations(mp, { view: "firm", status: "OPEN", dueFrom: today, dueTo: addDays(today, 7) }, 1, 50));
  await time("obligations — page 40 (deep pagination)", () => listObligations(mp, { view: "firm", status: "OPEN" }, 40, 50));
  await time("obligations — accountant 'my work' (row-level security)", () => listObligations(ac, { view: "mine", status: "OPEN" }, 1, 50));
  await time("clients — all, page 1", () => listClients(mp, {}, 1, 50));
  await time("clients — search", () => listClients(mp, { q: "trading 4321" }, 1, 50));
  await time("clients — accountant (assigned only)", () => listClients(ac, {}, 1, 50));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
