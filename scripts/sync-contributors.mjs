import { readFile } from "node:fs/promises";
import { getDbPool } from "../backend/dist/db/index.js";
import { enrollContributor } from "../backend/dist/public-contributions/enrollment.js";

const pool = getDbPool();
try {
  const accounts = JSON.parse(await readFile(new URL("../contributors.json", import.meta.url), "utf8"));
  if (!Array.isArray(accounts) || !accounts.every((name) => typeof name === "string")) {
    throw new Error("contributors.json must contain GitHub usernames");
  }
  for (const name of accounts) {
    const existing = await pool.query(
      `SELECT 1 FROM contributors WHERE lower(login)=lower($1) AND enrolled_at IS NOT NULL
         AND public_synced_at >= now() - interval '6 hours'`,
      [name],
    );
    if (existing.rowCount) {
      console.info(`${name}: enrolled, public activity is current`);
      continue;
    }
    const result = await enrollContributor(name, process.env.GITHUB_TOKEN ?? "", pool);
    console.info(`${result.login}: enrolled with ${result.events} public contribution records`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Contributor synchronization failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
