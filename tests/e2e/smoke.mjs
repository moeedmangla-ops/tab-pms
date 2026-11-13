// End-to-end smoke test across roles. Usage: node tests/e2e/smoke.mjs [shotsDir]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { authenticator } from "otplib";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv[2];
const PW = process.env.DEMO_PASSWORD ?? "TabDemo!2026";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`); };

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click("button:has-text('Continue')");
  await page.waitForURL(/\/login\/2fa/);
  const secretEl = page.locator(".font-mono.break-all");
  const secret = (await secretEl.count()) ? (await secretEl.textContent()).trim() : (await db.user.findUnique({ where: { email } })).totpSecret;
  await page.fill('input[name="code"]', authenticator.generate(secret));
  await page.click("button:has-text('Verify')");
  await page.waitForURL(`${BASE}/`);
  return { ctx, page };
}

const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

const browser = await chromium.launch();
try {
  // Wrong password is rejected without revealing the account
  {
    const p = await (await browser.newContext()).newPage();
    await p.goto(`${BASE}/login`);
    await p.fill('input[name="email"]', "mp@tabconsultants.test");
    await p.fill('input[name="password"]', "wrong-password");
    await p.click("button:has-text('Continue')");
    await p.waitForURL(/error=/);
    const body = await p.locator(".err").innerText();
    check("wrong password rejected", body.includes("Email or password is incorrect") || body.includes("temporarily locked"), body.slice(0, 120));
  }

  // Managing Partner
  const { page: mp } = await login(browser, "mp@tabconsultants.test");
  check("MP reaches dashboard with 2FA", (await mp.textContent("h1")) === "Dashboard");
  await shot(mp, "01-dashboard");
  const overdueCard = await mp.locator("a:has-text('Overdue')").first().textContent();
  const overdueN = Number(overdueCard.replace(/\D/g, ""));
  await mp.locator("a:has-text('Overdue')").first().click();
  await mp.waitForURL(/status=OVERDUE/);
  const listTotal = Number(((await mp.locator("text=/of \\d+/").first().textContent()).match(/of ([\d,]+)/) ?? [0, "0"])[1].replace(",", ""));
  check("dashboard 'Overdue' figure matches the list it opens", overdueN === listTotal, `${overdueN} vs ${listTotal}`);
  await mp.goto(`${BASE}/obligations?view=firm&status=OPEN`);
  await shot(mp, "02-obligations-list");
  for (const m of ["kanban", "calendar", "year"]) {
    await mp.goto(`${BASE}/obligations?view=firm&mode=${m}`);
    check(`obligations ${m} view renders`, !(await mp.textContent("body")).includes("could not be shown"));
    await shot(mp, `03-obligations-${m}`);
  }
  // Inline status change from the list
  await mp.goto(`${BASE}/obligations?view=firm&status=UPCOMING`);
  const firstSelect = mp.locator('select[form^="st-"]').first();
  await firstSelect.selectOption("IN_PREPARATION");
  await mp.waitForURL(/ok=/);
  check("inline status change saves", (await mp.textContent("body")).includes("Status updated"));
  // Clients
  await mp.goto(`${BASE}/clients`);
  const mpClients = Number(((await mp.locator("text=/client\\(s\\) in view/").textContent()).match(/\d+/) ?? [0])[0]);
  check("MP sees all 20 clients", mpClients === 20, String(mpClients));
  await shot(mp, "04-clients");
  const ex = await mp.request.get(`${BASE}/api/clients/export`);
  check("Excel export of the client view downloads", ex.status() === 200 && (ex.headers()["content-type"] ?? "").includes("spreadsheetml"), String(ex.status()));
  const au = await mp.request.get(`${BASE}/api/audit/export`);
  check("audit trail exports to CSV", au.status() === 200 && (await au.text()).startsWith("at,userId"), String(au.status()));
  await mp.fill('input[name="q"]', "100400000007919");
  await mp.click("button:has-text('Apply')");
  check("search by VAT TRN finds the client", (await mp.locator("tbody tr").count()) === 1);
  await mp.goto(`${BASE}/clients`);
  await mp.locator("tbody a").first().click();
  await mp.waitForURL(/\/clients\/[a-z0-9]+$/);
  for (const t of ["contacts", "services", "obligations", "communication", "tasks", "notes", "audit", "documents"]) {
    await mp.goto(mp.url().split("?")[0] + `?tab=${t}`);
    check(`client tab ${t}`, !(await mp.textContent("body")).includes("could not be shown"));
    if (t === "obligations") await shot(mp, "05-client-obligations");
  }
  await mp.goto(`${BASE}/leads`);
  await shot(mp, "06-leads");
  await mp.goto(`${BASE}/work`);
  await shot(mp, "07-my-work");
  await mp.goto(`${BASE}/settings?tab=rules`);
  await shot(mp, "08-settings-rules");
  await mp.goto(`${BASE}/settings?tab=connectors`);
  await shot(mp, "09-settings-connectors");
  await mp.goto(`${BASE}/reports/missing-data`);
  check("missing-data report lists the 2 clients without a year-end", (await mp.locator("tbody tr").count()) === 2);

  // Business Development: leads only
  const { page: bd } = await login(browser, "bd@tabconsultants.test");
  const denied = (pg) => pg.waitForSelector("text=could not be shown", { timeout: 8000 }).then(() => true).catch(() => false);
  await bd.goto(`${BASE}/clients`);
  check("BD cannot open clients", await denied(bd));
  await bd.goto(`${BASE}/obligations`);
  check("BD cannot open obligations", await denied(bd));
  const r = await bd.request.get(`${BASE}/api/clients/export`);
  check("BD cannot export clients (server-side 403)", r.status() === 403, String(r.status()));
  await bd.goto(`${BASE}/leads`);
  check("BD can open leads", (await bd.textContent("h1")) === "Leads");

  // Accountant: assigned clients only
  const { page: ac } = await login(browser, "accountant@tabconsultants.test");
  await ac.goto(`${BASE}/clients`);
  const acClients = Number(((await ac.locator("text=/client\\(s\\) in view/").textContent()).match(/\d+/) ?? [0])[0]);
  check("Accountant sees only assigned clients", acClients > 0 && acClients < 20, String(acClients));
  await ac.goto(`${BASE}/settings`);
  check("Accountant cannot open settings", await denied(ac));

  // Read-only: no edit controls
  const { page: ro } = await login(browser, "readonly@tabconsultants.test");
  await ro.goto(`${BASE}/clients`);
  check("Read-only sees no 'New client' button", (await ro.locator("a:has-text('New client')").count()) === 0);
  await ro.goto(`${BASE}/obligations?view=firm`);
  check("Read-only has no inline status control", (await ro.locator('select[form^="st-"]').count()) === 0);

  // Phone width: no horizontal page scroll on dashboard
  const mob = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await mob.context().addCookies(await mp.context().cookies());
  await mob.goto(`${BASE}/`);
  const sw = await mob.evaluate(() => document.documentElement.scrollWidth);
  check("dashboard has no horizontal scroll at phone width", sw <= 390, String(sw));
} finally {
  await browser.close();
  await db.$disconnect();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
