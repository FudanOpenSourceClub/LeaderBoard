import { readFile } from "node:fs/promises";
import { getDbPool } from "../backend/dist/db/index.js";
import { enrollContributor } from "../backend/dist/public-contributions/enrollment.js";

const pool = getDbPool();
try {
  const whitelist = JSON.parse(await readFile(new URL("../scoring-whitelist.json", import.meta.url), "utf8"));
  if (!Array.isArray(whitelist) || !whitelist.every(r => /^[1-9]\d*$/.test(r.githubId) && typeof r.enabled === "boolean" && typeof r.fullName === "string" && typeof r.url === "string")) throw new Error("Invalid repository whitelist");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE scoring_repositories SET enabled=FALSE");
    for (const repo of whitelist) await client.query(
      `INSERT INTO scoring_repositories (github_id,full_name,html_url,enabled) VALUES ($1,$2,$3,$4)
       ON CONFLICT (github_id) DO UPDATE SET full_name=EXCLUDED.full_name,html_url=EXCLUDED.html_url,
         enabled=EXCLUDED.enabled,updated_at=now()`, [repo.githubId,repo.fullName,repo.url,repo.enabled]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  console.info(`Repository whitelist: ${whitelist.filter(r => r.enabled).length} enabled, ${whitelist.length} candidates`);
  const accounts = JSON.parse(await readFile(new URL("../contributors.json", import.meta.url), "utf8"));
  if (!Array.isArray(accounts) || !accounts.every((account) => /^[1-9]\d*$/.test(account.githubId) && typeof account.login === "string")) {
    throw new Error("contributors.json must contain stable GitHub IDs and display logins");
  }
  for (const account of accounts) {
    const name=account.login;
    const existing = await pool.query(
      `SELECT 1 FROM contributors WHERE github_id=$1 AND enrolled_at IS NOT NULL AND public_sync_version=2
         AND public_synced_at >= now() - interval '1 day'`,
      [account.githubId],
    );
    if (existing.rowCount) {
      console.info(`${name}: enrolled, public activity is current`);
      continue;
    }
    const result = await enrollContributor(name, process.env.GITHUB_TOKEN ?? "", pool, fetch, account.githubId);
    console.info(`${result.login}: enrolled with ${result.events} public contribution records`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Contributor synchronization failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
