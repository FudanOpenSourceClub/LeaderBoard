import type { Pool } from "pg";

export interface ScoringEvent {
  contributorId: string;
  repositoryGithubId: string | null;
  objectGithubId?: string | null;
  repository: string;
  kind: "commit" | "pull_request" | "issue";
  identifier: string;
  occurredAt: string;
  mergedAt: string | null;
  title: string;
  url: string;
  group: string;
}
export interface ScoreDecision extends ScoringEvent {
  whitelisted: boolean;
  month: string;
  repositoryMonthCount: number;
  monthCount: number;
  repositoryCapExceeded: boolean;
  monthlyCapExceeded: boolean;
  commitIssuePoints: number;
  prOpenedPoints: number;
  prMergedPoints: number;
  points: number;
}
export interface ScoreSummary {
  score: number;
  commitIssueScore: number;
  prOpenedScore: number;
  prMergedScore: number;
  mergedPrs: number;
}
export const emptyScore = (): ScoreSummary => ({ score: 0, commitIssueScore: 0, prOpenedScore: 0, prMergedScore: 0, mergedPrs: 0 });

export function eventKey(event: ScoringEvent): string {
  return [event.contributorId, event.kind, event.repositoryGithubId ?? event.repository.toLowerCase(), event.identifier].join(":");
}

/** Apply both quotas over full history BEFORE filtering the requested view. */
export function scoreEvents(events: ScoringEvent[], whitelist: Set<string>, from: string | null, to: string) {
  const dedup = new Map<string, ScoringEvent>();
  for (const event of events) {
    const key = eventKey(event);
    const previous = dedup.get(key);
    dedup.set(key, previous ? {
      ...previous, ...event, mergedAt: event.mergedAt ?? previous.mergedAt,
      title: event.title || previous.title,
    } : event);
  }
  const sorted = [...dedup.values()].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt) || eventKey(a).localeCompare(eventKey(b)));
  const repoCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  const users = new Map<string, ScoreSummary>();
  const repositories = new Map<string, Map<string, ScoreSummary>>();
  const inRange = (at: string | null) => at !== null && Date.parse(at) < Date.parse(to)
    && (from === null || Date.parse(at) >= Date.parse(from));
  const decisions: ScoreDecision[] = [];
  for (const event of sorted) {
    if (Date.parse(event.occurredAt) >= Date.parse(to)) continue;
    const whitelisted = event.repositoryGithubId !== null && whitelist.has(event.repositoryGithubId);
    const month = new Date(Date.parse(event.occurredAt) + 8 * 3600000).toISOString().slice(0, 7);
    const userMonth = `${event.contributorId}:${month}`;
    const repoMonth = `${userMonth}:${event.repositoryGithubId}`;
    let repoCount = 0;
    let monthCount = 0;
    if (whitelisted && event.kind !== "pull_request") {
      repoCount = (repoCounts.get(repoMonth) ?? 0) + 1;
      repoCounts.set(repoMonth, repoCount);
      monthCount = monthCounts.get(userMonth) ?? 0;
      // Repository overflow does not consume the user's remaining monthly quota.
      if (repoCount <= 3) { monthCount++; monthCounts.set(userMonth, monthCount); }
    }
    const commitIssuePoints = whitelisted && event.kind !== "pull_request"
      && repoCount <= 3 && monthCount <= 10 && inRange(event.occurredAt) ? 1 : 0;
    const prOpenedPoints = whitelisted && event.kind === "pull_request" && inRange(event.occurredAt) ? 20 : 0;
    const prMergedPoints = whitelisted && event.kind === "pull_request" && inRange(event.mergedAt) ? 30 : 0;
    const decision: ScoreDecision = {
      ...event, whitelisted, month, repositoryMonthCount: repoCount, monthCount,
      repositoryCapExceeded: repoCount > 3,
      // Evaluate both limits even when the repository limit already blocks this record.
      monthlyCapExceeded: repoCount > 3 ? monthCount >= 10 : monthCount > 10,
      commitIssuePoints, prOpenedPoints, prMergedPoints,
      points: commitIssuePoints + prOpenedPoints + prMergedPoints,
    };
    decisions.push(decision);
    const totals = users.get(event.contributorId) ?? emptyScore();
    const perRepo = repositories.get(event.contributorId) ?? new Map<string, ScoreSummary>();
    const repoTotals = perRepo.get(event.repository) ?? emptyScore();
    for (const value of [totals, repoTotals]) {
      value.score += decision.points;
      value.commitIssueScore += commitIssuePoints;
      value.prOpenedScore += prOpenedPoints;
      value.prMergedScore += prMergedPoints;
      value.mergedPrs += prMergedPoints > 0 ? 1 : 0;
    }
    users.set(event.contributorId, totals);
    perRepo.set(event.repository, repoTotals);
    repositories.set(event.contributorId, perRepo);
  }
  return { users, repositories, decisions };
}

export async function getContributionScores(pool: Pool, from: string | null, to: string) {
  const [source, allowed] = await Promise.all([
    pool.query<{
      contributor_id: string; repository_github_id: string | null; repository: string;
      kind: ScoringEvent["kind"]; identifier: string; occurred_at: Date; merged_at: Date | null;
      title: string; html_url: string; group_name: string; object_github_id:string|null;
    }>(`WITH source_events AS (
      SELECT a.contributor_id, a.repository_github_id,
        a.repository, a.kind, a.identifier, a.occurred_at, a.merged_at, a.title, a.html_url,
        coalesce(g.name,'个人开源贡献') AS group_name,a.object_github_id
      FROM contributor_public_activities a JOIN contributors c ON c.id=a.contributor_id
      LEFT JOIN repositories r ON r.github_id=a.repository_github_id
        OR (a.repository_github_id IS NULL AND lower(r.full_name)=lower(a.repository))
      LEFT JOIN groups g ON g.id=r.group_id
      WHERE c.enrolled_at IS NOT NULL AND c.is_bot=FALSE
      UNION ALL
      SELECT c.contributor_id,r.github_id,r.full_name,'commit',c.sha,c.authored_at,NULL,'',
        coalesce(c.html_url,'https://github.com/'||r.full_name||'/commit/'||c.sha),g.name,NULL::bigint
      FROM commits c JOIN repositories r ON r.id=c.repository_id AND r.tracked=TRUE LEFT JOIN groups g ON g.id=r.group_id
      UNION ALL
      SELECT p.contributor_id,r.github_id,r.full_name,'pull_request',p.number::text,p.created_at,p.merged_at,'',
        coalesce(p.html_url,'https://github.com/'||r.full_name||'/pull/'||p.number),g.name,p.github_id
      FROM pull_requests p JOIN repositories r ON r.id=p.repository_id AND r.tracked=TRUE LEFT JOIN groups g ON g.id=r.group_id
      UNION ALL
      SELECT i.contributor_id,r.github_id,r.full_name,'issue',i.number::text,i.created_at,NULL,'',
        coalesce(i.html_url,'https://github.com/'||r.full_name||'/issues/'||i.number),g.name,i.github_id
      FROM issues i JOIN repositories r ON r.id=i.repository_id AND r.tracked=TRUE LEFT JOIN groups g ON g.id=r.group_id
    ) SELECT s.contributor_id::text,s.repository_github_id::text,s.repository,s.kind,s.identifier,s.occurred_at,
        s.merged_at,s.title,s.html_url,s.object_github_id::text,coalesce(s.group_name,'个人开源贡献') AS group_name
      FROM source_events s JOIN contributors c ON c.id=s.contributor_id AND c.is_bot=FALSE`),
    pool.query<{ github_id: string }>("SELECT github_id::text FROM scoring_repositories WHERE enabled=TRUE"),
  ]);
  const events = source.rows.map((r) => ({
    contributorId: r.contributor_id, repositoryGithubId: r.repository_github_id,objectGithubId:r.object_github_id,
    repository: r.repository, kind: r.kind, identifier: r.identifier,
    occurredAt: r.occurred_at.toISOString(), mergedAt: r.merged_at?.toISOString() ?? null,
    title: r.title, url: r.html_url, group: r.group_name,
  }));
  return scoreEvents(events, new Set(allowed.rows.map((r) => r.github_id)), from, to);
}
