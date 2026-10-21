/**
 * A public GitHub activity export, deliberately separate from the verified
 * Fudan leaderboard. GitHub Search is not equivalent to GitHub's contribution
 * graph or LeadBoard's tracked-repository database.
 */
export interface PublicContribution {
  kind: "commit" | "pull_request" | "issue";
  repository: string;
  occurredAt: string;
  identifier: string;
  title: string;
  url: string;
}

export interface PublicContributionExport {
  rows: PublicContribution[];
  totals: Record<PublicContribution["kind"], number>;
  truncated: boolean;
  incomplete: boolean;
}

type SearchKind = PublicContribution["kind"];
interface SearchItem {
  html_url?: string;
  repository_url?: string;
  repository?: { full_name?: string };
  created_at?: string;
  title?: string;
  number?: number;
  sha?: string;
  commit?: { author?: { date?: string }; message?: string };
}
interface SearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: SearchItem[];
}
const MAX_PER_KIND = 1000;
const SEARCH_KINDS: SearchKind[] = ["commit", "pull_request", "issue"];
const HEADER = ["类型", "仓库", "时间(UTC)", "SHA或编号", "标题", "原始链接", "统计口径"];

export async function collectPublicContributions(
  username: string,
  githubToken: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicContributionExport> {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) {
    throw new Error("Invalid GitHub username");
  }
  if (!githubToken.trim()) throw new Error("GitHub token not configured");

  const rows: PublicContribution[] = [];
  const totals = { commit: 0, pull_request: 0, issue: 0 };
  let truncated = false;
  let incomplete = false;

  for (const kind of SEARCH_KINDS) {
    const q = kind === "commit" ? "author:" + username : "author:" + username + " is:" + (kind === "pull_request" ? "pr" : "issue");
    const endpoint = kind === "commit" ? "commits" : "issues";
    let expected = 0;
    for (let page = 1; page <= 10; page++) {
      const url = new URL("https://api.github.com/search/" + endpoint);
      url.searchParams.set("q", q);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      const response = await fetcher(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + githubToken,
          "User-Agent": "LeadBoard-Public-Contribution-Export",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new Error("GitHub " + endpoint + " search returned HTTP " + response.status);
      }
      const payload = await response.json() as SearchResponse;
      if (!Array.isArray(payload.items) || !Number.isInteger(payload.total_count) || payload.total_count < 0) {
        throw new Error("Invalid GitHub search response");
      }
      if (page === 1) {
        expected = payload.total_count;
        totals[kind] = expected;
        truncated ||= expected > MAX_PER_KIND;
      }
      incomplete ||= payload.incomplete_results === true;
      for (const item of payload.items) {
        const url = item.html_url;
        if (!url?.startsWith("https://github.com/")) continue;
        const repository = kind === "commit"
          ? item.repository?.full_name
          : item.repository_url?.replace("https://api.github.com/repos/", "");
        if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) continue;
        const occurredAt = kind === "commit" ? item.commit?.author?.date : item.created_at;
        const identifier = kind === "commit" ? item.sha : String(item.number ?? "");
        if (!occurredAt || !identifier || Number.isNaN(Date.parse(occurredAt))) continue;
        rows.push({
          kind,
          repository,
          occurredAt,
          identifier,
          title: kind === "commit" ? (item.commit?.message ?? "").split("\n")[0] : (item.title ?? ""),
          url,
        });
      }
      if (page * 100 >= Math.min(expected, MAX_PER_KIND) || payload.items.length === 0) break;
    }
  }
  // The same event might be returned twice if GitHub changes index order
  // while pages are being fetched. Keep one row per event URL and kind.
  const dedup = new Map<string, PublicContribution>();
  for (const row of rows) dedup.set(row.kind + ":" + row.url, row);
  return {
    rows: [...dedup.values()].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt) || a.url.localeCompare(b.url)),
    totals,
    truncated,
    incomplete,
  };
}

function csvCell(value: string): string {
  // Guard against spreadsheet formula injection in GitHub-provided titles.
  const safe = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
  return /[,"\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function publicContributionCsv(data: PublicContributionExport): string {
  const scope = "公开 GitHub 搜索记录（不等于已认证复旦贡献或 GitHub contributions 总数）";
  const values = [
    HEADER,
    ...data.rows.map((r) => [
      r.kind, r.repository, r.occurredAt, r.identifier, r.title, r.url, scope,
    ]),
  ];
  return "\uFEFF" + values.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
