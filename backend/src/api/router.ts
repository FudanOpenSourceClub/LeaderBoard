import {
  ContributorDetailSchema,
  ContributorLeaderboardResponseSchema,
  EmailCodeRequestSchema,
  EmailCodeSendResponseSchema,
  EmailCodeVerifyRequestSchema,
  EmailCodeVerifyResponseSchema,
  GroupsResponseSchema,
  LeaderboardMetricSchema,
  OrganizationSummaryResponseSchema,
  ProjectProposalRequestSchema,
  ProjectProposalResponseSchema,
  RepositoryStatsResponseSchema,
  TimeRangeSchema,
  type ApiErrorResponse,
  type ContributorDetail,
  type ContributorRank,
  type GroupSummary,
  type LeaderboardQuery,
  type OrganizationActivitySummary,
  type RepositoryStat,
  type SyncStatus,
  type TimeRange,
} from "@leadboard/contracts";
import { Router, type RequestHandler, type Response } from "express";
import { AnalyticsService } from "../analytics/index.js";
import {
  EmailAuthError,
  GitHubLinkError,
  UnavailableEmailVerificationApi,
  UnavailableGitHubLinkApi,
  type EmailVerificationApi,
  type GitHubLinkApi,
} from "../auth/index.js";
import { GitHubClientError } from "../github/client.js";
import { publicContributionCsv } from "../public-contributions/export.js";
import { getContributorActivityExport } from "../public-contributions/enrollment.js";
import { ProjectProposalService, type ProjectProposalApi } from "../projects/proposals.js";
import { getSyncStatus as defaultGetSyncStatus, SyncAlreadyRunningError } from "../sync/index.js";

interface AnalyticsApi {
  getGroups(): Promise<GroupSummary[]>;
  getOrganizationActivitySummary(range: TimeRange): Promise<OrganizationActivitySummary>;
  getRepositoryStats(range: TimeRange, group?: string): Promise<RepositoryStat[]>;
  getContributorLeaderboard(input: LeaderboardQuery): Promise<ContributorRank[]>;
  getContributorDetail(username: string, range: TimeRange): Promise<ContributorDetail | null>;
}

export interface ApiDependencies {
  analytics: AnalyticsApi;
  getSyncStatus(): Promise<SyncStatus>;
  emailVerification: EmailVerificationApi;
  githubLink: GitHubLinkApi;
  projectProposals: ProjectProposalApi;
  contributorExport: typeof getContributorActivityExport;
}

function sendError(res: Response, status: number, code: string, message: string): void {
  const body: ApiErrorResponse = { error: { code, message } };
  res.status(status).json(body);
}

function singleQuery(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length > 0 ? value : "";
}

function parseRange(value: unknown, res: Response): TimeRange | null {
  const raw = singleQuery(value);
  if (raw === "") {
    sendError(res, 400, "INVALID_RANGE", "range must be 7d, 30d, 90d or all");
    return null;
  }
  const parsed = TimeRangeSchema.safeParse(raw ?? "30d");
  if (!parsed.success) {
    sendError(res, 400, "INVALID_RANGE", "range must be 7d, 30d, 90d or all");
    return null;
  }
  return parsed.data;
}

function parseMetric(value: unknown, res: Response) {
  const raw = singleQuery(value);
  if (raw === "") {
    sendError(res, 400, "INVALID_METRIC", "metric must be score, total, commits, prs or issues");
    return null;
  }
  const parsed = LeaderboardMetricSchema.safeParse(raw ?? "score");
  if (!parsed.success) {
    sendError(res, 400, "INVALID_METRIC", "metric must be score, total, commits, prs or issues");
    return null;
  }
  return parsed.data;
}

function parseLimit(value: unknown, res: Response): number | null {
  const raw = singleQuery(value);
  if (raw === undefined) return 50;
  if (!/^[1-9]\d*$/.test(raw)) {
    sendError(res, 400, "INVALID_LIMIT", "limit must be a positive integer");
    return null;
  }
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit)) {
    sendError(res, 400, "INVALID_LIMIT", "limit must be a positive integer");
    return null;
  }
  return limit;
}

function parseGroup(value: unknown, res: Response): string | undefined | null {
  const raw = singleQuery(value);
  if (raw === "") {
    sendError(res, 400, "INVALID_GROUP", "group must be a non-empty string");
    return null;
  }
  return raw;
}

function handleServiceError(error: unknown, res: Response): boolean {
  if (error instanceof EmailAuthError || error instanceof GitHubLinkError) {
    sendError(res, error.status, error.code, error.message);
    return true;
  }
  if (error instanceof SyncAlreadyRunningError) {
    sendError(res, 409, "SYNC_ALREADY_RUNNING", "A synchronization run is already active");
    return true;
  }
  if (error instanceof GitHubClientError && error.code === "RATE_LIMITED") {
    sendError(res, 503, "GITHUB_RATE_LIMITED", "GitHub is temporarily rate limited");
    return true;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (code.startsWith("08") || ["57P01", "57P02", "57P03"].includes(code)) {
      sendError(res, 503, "DATABASE_UNAVAILABLE", "Database is temporarily unavailable");
      return true;
    }
  }
  return false;
}

export function createApiRouter(dependencies: Partial<ApiDependencies> = {}): Router {
  const analytics = dependencies.analytics ?? new AnalyticsService();
  const getSyncStatus = dependencies.getSyncStatus ?? defaultGetSyncStatus;
  const emailVerification: EmailVerificationApi = dependencies.emailVerification ?? new UnavailableEmailVerificationApi();
  const githubLink = dependencies.githubLink ?? new UnavailableGitHubLinkApi();
  const projectProposals = dependencies.projectProposals ?? new ProjectProposalService();
  const contributorExport = dependencies.contributorExport ?? getContributorActivityExport;
  const router = Router();

  router.post("/auth/email/send-code", async (req, res, next) => {
    const parsed = EmailCodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_EMAIL", "请输入有效邮箱地址");
      return;
    }
    try {
      const requesterIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
      const result = await emailVerification.sendCode(parsed.data.email, requesterIp, {studentId:parsed.data.studentId,githubLogin:parsed.data.githubLogin});
      res.status(202).json(EmailCodeSendResponseSchema.parse(result));
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  });

  router.post("/auth/email/verify", async (req, res, next) => {
    const parsed = EmailCodeVerifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_VERIFICATION_CODE", "邮箱或验证码格式不正确");
      return;
    }
    try {
      const result = await emailVerification.verifyCode(parsed.data.email, parsed.data.code);
      if (result.registrationToken) res.cookie("leaderboard_registration",result.registrationToken, {
        httpOnly:true,secure:true,sameSite:"lax",maxAge:7*86400000,path:"/api/v1/auth",
      });
      const link = await githubLink.createAuthorization(result.memberId);
      res.json(EmailCodeVerifyResponseSchema.parse({
        verified: true,
        githubLink: link,
      }));
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  });

  router.post("/auth/github/retry", async (req,res,next) => {
    try {
      const cookie=(req.headers.cookie??"").split(";").map(v=>v.trim()).find(v=>v.startsWith("leaderboard_registration="));
      const token=cookie?.slice("leaderboard_registration=".length)??"";
      if (!emailVerification.resumeRegistration) {sendError(res,401,"REGISTRATION_SESSION_REQUIRED","请先完成邮箱验证");return;}
      const memberId=await emailVerification.resumeRegistration(token);
      res.json(await githubLink.createAuthorization(memberId));
    } catch(error) { if(!handleServiceError(error,res))next(error); }
  });

  router.get("/auth/github/callback", async (req, res, next) => {
    const code = singleQuery(req.query.code);
    const state = singleQuery(req.query.state);
    const denied = singleQuery(req.query.error);
    if (denied) {
      res.redirect(303, "/join?github=error&reason=access_denied");
      return;
    }
    if (!code || !state) {
      res.redirect(303, "/join?github=error&reason=invalid_callback");
      return;
    }
    try {
      const result = await githubLink.completeAuthorization(code, state);
      res.redirect(303, `/join?github=success&login=${encodeURIComponent(result.login)}`);
    } catch (error) {
      if (error instanceof GitHubLinkError) {
        const reason = error.code === "GITHUB_ACCOUNT_ALREADY_LINKED"
          ? "already_linked"
          : error.code === "GITHUB_ACCOUNT_MISMATCH" ? "account_mismatch"
          : error.code === "GITHUB_LINK_NOT_CONFIGURED"
            ? "not_configured"
            : "authorization_failed";
        res.redirect(303, `/join?github=error&reason=${reason}`);
        return;
      }
      next(error);
    }
  });

  router.post("/project-proposals", async (req, res, next) => {
    const parsed = ProjectProposalRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_PROJECT_PROPOSAL", "请把项目地址、实验室和补充说明填写完整");
      return;
    }
    try {
      const result = await projectProposals.submit(parsed.data);
      res.status(201).json(ProjectProposalResponseSchema.parse(result));
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  });

  router.get("/organization/summary", async (req, res, next) => {
    const range = parseRange(req.query.range, res);
    if (range === null) return;
    try {
      const [summary, sync] = await Promise.all([
        analytics.getOrganizationActivitySummary(range),
        getSyncStatus(),
      ]);
      res.json(OrganizationSummaryResponseSchema.parse({
        ...summary,
        lastUpdatedAt: sync.lastSuccessfulRunAt,
        dataStatus: sync.dataStatus,
      }));
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  });

  router.get("/organization/repositories", async (req, res, next) => {
    const range = parseRange(req.query.range, res);
    if (range === null) return;
    const group = parseGroup(req.query.group, res);
    if (group === null) return;
    try {
      const items = await analytics.getRepositoryStats(range, group);
      res.json(RepositoryStatsResponseSchema.parse({ items }));
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  });

  router.get("/groups", async (_req, res, next) => {
    try {
      res.json(GroupsResponseSchema.parse({ items: await analytics.getGroups() }));
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  });

  router.get("/contributors/leaderboard", async (req, res, next) => {
    const range = parseRange(req.query.range, res);
    if (range === null) return;
    const metric = parseMetric(req.query.metric, res);
    if (metric === null) return;
    const limit = parseLimit(req.query.limit, res);
    if (limit === null) return;
    const group = parseGroup(req.query.group, res);
    if (group === null) return;
    try {
      const items = await analytics.getContributorLeaderboard({
        range, metric, limit, ...(group === undefined ? {} : { group }),
      });
      res.json(ContributorLeaderboardResponseSchema.parse({ range, metric, items }));
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  });

  const exportContributor: RequestHandler<{ username: string }> = async (req, res, next) => {
    const username = req.params.username;
    if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) {
      sendError(res, 400, "INVALID_USERNAME", "Invalid GitHub username");
      return;
    }
    try {
      const data = await contributorExport(username);
      if (data === null) {
        sendError(res, 404, "CONTRIBUTOR_NOT_FOUND", "Contributor not found");
        return;
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="LeaderBoard-${username}-public-contributions.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-LeaderBoard-Truncated", String(data.truncated));
      res.setHeader("X-LeaderBoard-Incomplete", String(data.incomplete));
      res.setHeader("X-LeaderBoard-Event-Count", String(data.rows.length));
      res.send(publicContributionCsv(data));
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  };
  router.get("/contributors/:username/export.csv", exportContributor);
  // Preserve existing contribution download links.
  router.get("/public-contributors/:username/export.csv", exportContributor);

  router.get("/contributors/:username", async (req, res, next) => {
    const range = parseRange(req.query.range, res);
    if (range === null) return;
    try {
      const detail = await analytics.getContributorDetail(req.params.username, range);
      if (detail === null) {
        sendError(res, 404, "CONTRIBUTOR_NOT_FOUND", "Contributor not found");
        return;
      }
      res.json(ContributorDetailSchema.parse(detail));
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  });

  router.get("/sync/status", async (_req, res, next) => {
    try {
      res.json(await getSyncStatus());
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  });

  return router;
}
