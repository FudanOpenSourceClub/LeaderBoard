import type {
  CollectRange,
  GitHubActorRef,
  GitHubClient,
  IssueActivity,
  PullRequestActivity,
  TrackedRepository,
} from "@leadboard/contracts";

interface RestActor {
  id: number | string;
  login: string;
  avatar_url: string | null;
  type: string;
}

interface RestActivity {
  id: number | string;
  number: number;
  user: RestActor | null;
  created_at: string;
  updated_at?: string;
  closed_at: string | null;
  html_url: string | null;
  state: "open" | "closed";
}

interface RestPullRequest extends RestActivity {
  merged_at: string | null;
}

interface RestIssue extends RestActivity {
  pull_request?: unknown;
}

function actorRef(actor: RestActor | null): GitHubActorRef {
  return {
    githubId: actor?.id == null ? null : String(actor.id),
    login: actor?.login ?? null,
    avatarUrl: actor?.avatar_url ?? null,
    type: actor?.type === "User" || actor?.type === "Bot" || actor?.type === "Organization"
      ? actor.type : "Unknown",
  };
}

function inRange(createdAt: string, range: CollectRange): boolean {
  const created = Date.parse(createdAt);
  return created >= Date.parse(range.from) && created < Date.parse(range.to);
}

function changedInRange(item: RestActivity, range: CollectRange): boolean {
  return Date.parse(item.created_at) < Date.parse(range.to) &&
    [item.created_at, item.updated_at, item.closed_at, "merged_at" in item ? (item as RestPullRequest).merged_at : null]
      .some(at => typeof at === "string" && inRange(at, range));
}

/** Refresh changed objects while preserving their original creation time for scoring. */
export class PullRequestIssueCollector {
  constructor(private readonly client: GitHubClient) {}

  async collectPullRequests(repo: TrackedRepository, range: CollectRange): Promise<PullRequestActivity[]> {
    const items = await this.client.paginateRest<RestPullRequest>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pulls`,
      { state: "all" },
    );

    return items.filter((item) => changedInRange(item, range)).map((item) => ({
      kind: "pull_request",
      repositoryGithubId: repo.githubId,
      externalId: String(item.id),
      number: item.number,
      actor: actorRef(item.user),
      occurredAt: item.created_at,
      state: item.merged_at != null ? "merged" : item.state,
      closedAt: item.closed_at,
      mergedAt: item.merged_at,
      rawUrl: item.html_url,
    }));
  }

  async collectIssues(repo: TrackedRepository, range: CollectRange): Promise<IssueActivity[]> {
    const items = await this.client.paginateRest<RestIssue>(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues`,
      { state: "all" },
    );

    return items
      .filter((item) => !("pull_request" in item) && changedInRange(item, range))
      .map((item) => ({
        kind: "issue",
        repositoryGithubId: repo.githubId,
        externalId: String(item.id),
        number: item.number,
        actor: actorRef(item.user),
        occurredAt: item.created_at,
        state: item.state,
        closedAt: item.closed_at,
        rawUrl: item.html_url,
      }));
  }
}
