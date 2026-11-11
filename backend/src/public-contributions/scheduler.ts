import cron from "node-cron";
import { getDbPool } from "../db/index.js";
import { refreshEnrolledContributors } from "./enrollment.js";

// A separate schedule keeps repository-wide synchronization at its existing cadence.
export function startContributorScheduler(token: string): { stop(): Promise<void> } {
  let active: Promise<void> | null = null;
  const task = cron.schedule("*/30 * * * *", () => {
    if (active) return;
    active = (async () => {
      const client = await getDbPool().connect();
      let locked = false;
      try {
        const result = await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock($1::integer) AS locked", [1279411269]);
        locked = result.rows[0]?.locked === true;
        if (locked) await refreshEnrolledContributors(token);
      } finally {
        if (locked) await client.query("SELECT pg_advisory_unlock($1::integer)", [1279411269]).catch(() => undefined);
        client.release();
      }
    })().catch(() => console.error("Scheduled contributor synchronization failed"))
      .finally(() => { active = null; });
  });
  return { async stop() { task.stop(); await active; } };
}
