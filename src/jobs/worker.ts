/**
 * Durable job worker: pg-boss (Postgres-backed queue with retries).
 * Schedules run in Asia/Dubai. Start with `npm run worker`.
 * Run a single job once: `npm run worker -- --once send-reminders`
 */
import PgBoss from "pg-boss";
import { JOBS, JobName, runJob } from "./runner";

async function main() {
  const onceIdx = process.argv.indexOf("--once");
  if (onceIdx > -1) {
    const name = process.argv[onceIdx + 1] as JobName;
    if (!(name in JOBS)) throw new Error(`Unknown job ${name}. Jobs: ${Object.keys(JOBS).join(", ")}`);
    const r = await runJob(name);
    console.log(JSON.stringify({ job: name, ...r }, null, 2));
    process.exit(0);
  }

  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
  boss.on("error", (e) => console.error(JSON.stringify({ level: "error", event: "queue_error", message: e.message })));
  await boss.start();
  for (const [name, def] of Object.entries(JOBS)) {
    await boss.createQueue(name);
    await boss.schedule(name, def.cron, {}, { tz: "Asia/Dubai", retryLimit: 3, retryDelay: 120, retryBackoff: true, singletonKey: name });
    await boss.work(name, { batchSize: 1 }, async () => {
      await runJob(name as JobName);
    });
  }
  console.log(JSON.stringify({ level: "info", event: "worker_started", jobs: Object.keys(JOBS) }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
