import { parseArgs } from "node:util";
import { getDbPool } from "../backend/dist/db/index.js";
import { backfillPublicContributions, LIVE_WINDOW_MS } from "../backend/dist/public-contributions/backfill.js";

const { values } = parseArgs({ options: {
  from: { type: "string" },
  to: { type: "string" },
  "github-id": { type: "string" },
  apply: { type: "boolean", default: false },
} });

if (!values.from) throw new Error("Provide the start of the recovery period with --from");
const period = {
  from: new Date(values.from).toISOString(),
  to: values.to ? new Date(values.to).toISOString() : new Date(Date.now() - LIVE_WINDOW_MS).toISOString(),
};
const pool = getDbPool();
try {
  const summary = await backfillPublicContributions(pool, process.env.GITHUB_TOKEN ?? "", {
    period, githubId: values["github-id"], apply: values.apply,
  });
  console.info(JSON.stringify({ period, apply: values.apply, ...summary }));
  if (summary.failed) process.exitCode = 1;
} finally {
  await pool.end();
}
