import {
  CampusProjectsResponseSchema,
  ProjectProposalAdminResponseSchema,
  ProjectReviewRequestSchema,
  WebsiteSessionSchema,
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
  RegistrationStatusSchema,
  GitHubRegistrationIdentitySchema,
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
import { Router, type Request, type RequestHandler, type Response } from "express";
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
import { getRegistrationStatus } from "../auth/github-link.js";
import { createWebsiteAuthFromEnv, csrfMatches, WebsiteAuthError, type WebsiteAuthApi } from "../auth/website-session.js";
import { getContributorActivityExport } from "../public-contributions/enrollment.js";
import { ProjectError, ProjectProposalService, type ProjectProposalApi } from "../projects/proposals.js";
import { getSyncStatus as defaultGetSyncStatus, SyncAlreadyRunningError } from "../sync/index.js";

import {createContributionTagRouter,type ContributionTagApi} from "./contribution-tags.js";
import { AdminError } from "../auth/roles.js";
import { createWebsiteAdminRouter, type WebsiteAdminDependencies } from "./admin.js";

interface AnalyticsApi {
  getGroups(): Promise<GroupSummary[]>;
  getOrganizationActivitySummary(range: TimeRange): Promise<OrganizationActivitySummary>;
  getRepositoryStats(range: TimeRange, group?: string): Promise<RepositoryStat[]>;
  getContributorLeaderboard(input: LeaderboardQuery): Promise<ContributorRank[]>;
  getContributorDetail(username: string, range: TimeRange): Promise<ContributorDetail | null>;
}

export interface ApiDependencies {
  websiteAdmin: Partial<WebsiteAdminDependencies>;
  contributionTags: ContributionTagApi;
  analytics: AnalyticsApi;
  getSyncStatus(): Promise<SyncStatus>;
  emailVerification: EmailVerificationApi;
  githubLink: GitHubLinkApi;
  projectProposals: ProjectProposalApi;
  contributorExport: typeof getContributorActivityExport;
  registrationStatus: typeof getRegistrationStatus;
  websiteAuth: WebsiteAuthApi;
  projectReview: Pick<ProjectProposalService,"projects"|"list"|"review">;
  notifyProjects(): Promise<void>;
}

function sendError(res: Response, status: number, code: string, message: string): void {
  const body: ApiErrorResponse = { error: { code, message } };
  res.status(status).json(body);
}

function singleQuery(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length > 0 ? value : "";
}

function registrationCookie(cookieHeader: string | undefined): string {
  return (cookieHeader ?? "").split(";").map(v=>v.trim())
    .find(v=>v.startsWith("leaderboard_registration="))?.slice("leaderboard_registration=".length) ?? "";
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
  if (error instanceof AdminError || error instanceof EmailAuthError || error instanceof GitHubLinkError || error instanceof WebsiteAuthError || error instanceof ProjectError) {
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
  const githubLink: GitHubLinkApi = dependencies.githubLink ?? new UnavailableGitHubLinkApi();
  const projectProposals = dependencies.projectProposals ?? new ProjectProposalService();
  const contributorExport = dependencies.contributorExport ?? getContributorActivityExport;
  const registrationStatus = dependencies.registrationStatus ?? getRegistrationStatus;
  const websiteAuth=dependencies.websiteAuth??createWebsiteAuthFromEnv();
  const projectReview=dependencies.projectReview??new ProjectProposalService();
  const cookie=(req:Request,name:string)=>(req.headers.cookie??"").split(";").map(v=>v.trim()).find(v=>v.startsWith(name+"="))?.slice(name.length+1)??"";
  const sessionCookie=(res:Response,token:string)=>res.cookie("leaderboard_session",token,{httpOnly:true,secure:true,sameSite:"lax",maxAge:30*86400000,path:"/"});
  const requireUser=async(req:Request,admin=false)=>{
    const user=await websiteAuth.getSession(cookie(req,"leaderboard_session"));
    if(!user)throw new WebsiteAuthError("REGISTRATION_REQUIRED",401,"请先注册网站，已注册用户请先登录");
    if(admin&&user.role!=="owner")throw new WebsiteAuthError("ADMIN_REQUIRED",403,"仅站长可以处理申请");
    if(!admin&&!user.memberId)throw new WebsiteAuthError("REGISTRATION_REQUIRED",401,"请先完成网站注册");
    if(req.method!=="GET"&&!csrfMatches(user,req.get("X-CSRF-Token")))throw new WebsiteAuthError("INVALID_CSRF",403,"登录状态已变化，请刷新后重试");
    return user;
  };
  const router = Router();

  router.get("/auth/session",async(req,res,next)=>{
    res.setHeader("Cache-Control","no-store");
    try{
      let token=cookie(req,"leaderboard_session");
      if(!token){const issued=await websiteAuth.fromRegistration(registrationCookie(req.headers.cookie));if(issued){token=issued;sessionCookie(res,token)}}
      const user=await websiteAuth.getSession(token);
      res.json(WebsiteSessionSchema.parse(user?{authenticated:true,login:user.login,registered:!!user.memberId,isAdmin:user.role==="owner",canTag:user.role==="owner"||user.role==="admin",role:user.role??null,csrfToken:user.csrfToken}:{authenticated:false}));
    }catch(error){if(!handleServiceError(error,res))next(error)}
  });
  router.get("/auth/github/login",async(req,res,next)=>{
    try{const result=await websiteAuth.startLogin(singleQuery(req.query.returnTo)??"/projects");
      res.cookie("leaderboard_login",result.browserToken,{httpOnly:true,secure:true,sameSite:"lax",maxAge:10*60000,path:"/api/v1/auth"});
      res.redirect(303,result.authorizeUrl);
    }catch(error){if(!handleServiceError(error,res))next(error)}
  });

  router.get("/auth/github/register", async (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await websiteAuth.startLogin("/join", "register");
      res.cookie("leaderboard_login", result.browserToken, {httpOnly:true,secure:true,sameSite:"lax",maxAge:10*60000,path:"/api/v1/auth"});
      res.redirect(303, result.authorizeUrl);
    } catch (error) { if (!handleServiceError(error, res)) next(error); }
  });

  router.get("/auth/github/registration", async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const identity = await websiteAuth.getRegistrationIdentity(cookie(req, "leaderboard_session"));
      res.json(GitHubRegistrationIdentitySchema.parse(identity ? {verified:true,githubId:identity.githubId,login:identity.login} : {verified:false}));
    } catch (error) { if (!handleServiceError(error, res)) next(error); }
  });

  const requireGitHubIdentity = async (req: Request) => {
    const identity = await websiteAuth.getRegistrationIdentity(cookie(req, "leaderboard_session"));
    if (!identity) throw new WebsiteAuthError("GITHUB_AUTH_REQUIRED", 401, "请先通过 GitHub 官方授权验证账号");
    return identity;
  };

  router.get("/auth/registration/status", async (req,res,next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const token = cookie(req, "leaderboard_session");
      if (token) {
        const user = await websiteAuth.getSession(token);
        res.json(RegistrationStatusSchema.parse(user?.memberId ? {registered:true,login:user.login} : {registered:false}));
        return;
      }
      res.json(RegistrationStatusSchema.parse(await registrationStatus(registrationCookie(req.headers.cookie))));
    } catch (error) { if (!handleServiceError(error,res)) next(error); }
  });

  router.post("/auth/email/send-code", async (req, res, next) => {
    const parsed = EmailCodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_EMAIL", "请输入有效邮箱地址");
      return;
    }
    try {
      const identity = await requireGitHubIdentity(req);
      const requesterIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
      const result = await emailVerification.sendCode(parsed.data.email, requesterIp, {studentId:parsed.data.studentId,githubId:identity.githubId,githubLogin:identity.login});
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
      const identity = await requireGitHubIdentity(req);
      if (!githubLink.completeVerifiedRegistration) throw new GitHubLinkError("GITHUB_LINK_NOT_CONFIGURED", 503, "GitHub 绑定服务尚未配置");
      const result = await emailVerification.verifyCode(parsed.data.email, parsed.data.code, identity.githubId);
      if (!result.registrationToken) throw new GitHubLinkError("REGISTRATION_SESSION_REQUIRED", 401, "请重新完成邮箱验证");
      if (result.registrationToken) res.cookie("leaderboard_registration",result.registrationToken, {
        httpOnly:true,secure:true,sameSite:"lax",maxAge:7*86400000,path:"/api/v1/auth",
      });
      await githubLink.completeVerifiedRegistration(result.memberId, identity, result.registrationToken);
      const confirmation = await registrationStatus(result.registrationToken);
      if (!confirmation.registered) throw new GitHubLinkError("REGISTRATION_WRITE_NOT_CONFIRMED", 500, "未能确认注册记录");
      const token = await websiteAuth.fromRegistration(result.registrationToken);
      if (token) sessionCookie(res, token);
      res.json(EmailCodeVerifyResponseSchema.parse({
        verified: true,
        registered: true,
        githubLink: {available:false},
      }));
    } catch (error) {
      if (!handleServiceError(error, res)) next(error);
    }
  });

  router.post("/auth/github/retry", async (req,res,next) => {
    try {
      const token=registrationCookie(req.headers.cookie);
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
      if(state.startsWith("login.") || state.startsWith("register.")){
        try{const result=await websiteAuth.completeLogin(code,state,cookie(req,"leaderboard_login"));
          sessionCookie(res,result.sessionToken);res.clearCookie("leaderboard_login",{path:"/api/v1/auth"});res.redirect(303,result.returnPath);return;
        }catch(error){res.redirect(303,error instanceof WebsiteAuthError&&error.code==="REGISTRATION_REQUIRED"?"/join?login=registration_required":"/join?login=failed");return;}
      }
      const token = registrationCookie(req.headers.cookie);
      if (!token) throw new GitHubLinkError("REGISTRATION_SESSION_REQUIRED",401,"请先完成邮箱验证");
      await githubLink.completeAuthorization(code, state, token);
      const confirmation = await registrationStatus(token);
      if (!confirmation.registered) throw new GitHubLinkError("REGISTRATION_WRITE_NOT_CONFIRMED",500,"未能确认注册记录");
      const sessionToken=await websiteAuth.fromRegistration(token);
      if(sessionToken)sessionCookie(res,sessionToken);
      res.redirect(303, "/join?github=success");
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

  router.get("/projects",async(_req,res,next)=>{
    try{res.json(CampusProjectsResponseSchema.parse({items:await projectReview.projects()}));}
    catch(error){if(!handleServiceError(error,res))next(error)}
  });
  router.post("/project-proposals",async(req,res,next)=>{
    try{
      const user=await requireUser(req);
      const parsed=ProjectProposalRequestSchema.safeParse(req.body);
      if(!parsed.success){sendError(res,400,"INVALID_PROJECT_PROPOSAL","请填写 GitHub 仓库地址、实验室和完整说明");return}
      const result=await projectProposals.submit(parsed.data,user.memberId!);
      res.status(201).json(ProjectProposalResponseSchema.parse(result));
      void dependencies.notifyProjects?.().catch(()=>undefined);
    }catch(error){if(!handleServiceError(error,res))next(error)}
  });
  router.get("/admin/project-proposals",async(req,res,next)=>{
    res.setHeader("Cache-Control","no-store");
    try{await requireUser(req,true);res.json(ProjectProposalAdminResponseSchema.parse({items:await projectReview.list()}));}
    catch(error){if(!handleServiceError(error,res))next(error)}
  });
  router.post("/admin/project-proposals/:id/review",async(req,res,next)=>{
    try{
      const user=await requireUser(req,true);const id=Number(req.params.id);
      const parsed=ProjectReviewRequestSchema.safeParse(req.body);
      if(!Number.isSafeInteger(id)||id<1||!parsed.success){sendError(res,400,"INVALID_REVIEW","请填写审核结论；通过时需填写公开简介");return}
      await projectReview.review(id,parsed.data,user.githubId);res.json({reviewed:true});
    }catch(error){if(!handleServiceError(error,res))next(error)}
  });

  router.use("/admin",createContributionTagRouter(async req=>{
    const user=await websiteAuth.getSession(cookie(req,"leaderboard_session"));
    if(!user)throw new WebsiteAuthError("REGISTRATION_REQUIRED",401,"请先登录");
    if(user.role!=="owner"&&user.role!=="admin")throw new WebsiteAuthError("TAGGER_REQUIRED",403,"当前账号没有标签添加权限");
    if(req.method!=="GET"&&!csrfMatches(user,req.get("X-CSRF-Token")))throw new WebsiteAuthError("INVALID_CSRF",403,"请刷新后重试");
    return user;
  },dependencies.contributionTags));
  router.use("/admin",createWebsiteAdminRouter(req=>requireUser(req,true),dependencies.websiteAdmin));
  router.use(((error, _req, res, next)=>{if(!handleServiceError(error,res))next(error)}) as import("express").ErrorRequestHandler);

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

  const disabledExport: RequestHandler = (_req,res)=>{res.setHeader("Cache-Control","no-store");sendError(res,410,"EXPORT_DISABLED","贡献导出已关闭");};
  router.get("/contributors/:username/export.csv",disabledExport);
  router.get("/public-contributors/:username/export.csv",disabledExport);

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
