import { z } from "zod";

const text = z.string().trim().min(1);
const githubId = z.string().regex(/^[1-9]\d*$/, "Expected a positive decimal ID string");
const utc = z.iso.datetime();
const count = z.number().int().nonnegative();
const positive = z.number().int().positive();
const webUrl = z.url({ protocol: /^https?$/ });
const ordered = (from: string, to: string) => Date.parse(from) < Date.parse(to);

export const GitHubActorTypeSchema = z.enum(["User", "Bot", "Organization", "Unknown"]);
export type GitHubActorType = z.infer<typeof GitHubActorTypeSchema>;

export const GitHubActorRefSchema = z.object({
  githubId: githubId.nullable(), login: text.nullable(),
  avatarUrl: webUrl.nullable(), type: GitHubActorTypeSchema,
});
export type GitHubActorRef = z.infer<typeof GitHubActorRefSchema>;

export const AppConfigSchema = z.object({
  githubToken: text, githubOrg: text, groupProperty: text,
  databaseUrl: z.url({ protocol: /^postgres(ql)?$/ }),
  port: positive.max(65535), ingestionCronSchedule: text,
  initialSyncDays: positive, syncOverlapMinutes: count, dataStaleAfterHours: positive,
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const RepositorySyncInputSchema = z.object({ org: text, groupProperty: text });
export type RepositorySyncInput = z.infer<typeof RepositorySyncInputSchema>;

const repositoryShape = {
  githubId, nodeId: text, owner: text, name: text, fullName: text,
  defaultBranch: text, htmlUrl: webUrl, archived: z.boolean(),
};

export const TrackedRepositorySchema = z.object({ ...repositoryShape, group: text });
export type TrackedRepository = z.infer<typeof TrackedRepositorySchema>;

export const RepositorySyncResultSchema = z.object({ trackedRepositories: z.array(TrackedRepositorySchema), syncedAt: utc });
export type RepositorySyncResult = z.infer<typeof RepositorySyncResultSchema>;

export const GitHubRepositoryRefSchema = z.object({ ...repositoryShape, isFork: z.boolean(), isPrivate: z.boolean() });
export type GitHubRepositoryRef = z.infer<typeof GitHubRepositoryRefSchema>;

export interface GitHubClient {
  listOrgRepositories(org: string): Promise<GitHubRepositoryRef[]>;
  getRepositoryCustomProperties(owner: string, repo: string): Promise<Record<string, unknown>>;
  requestRest<T>(method: "GET" | "POST" | "PATCH", path: string, params?: Record<string, unknown>): Promise<T>;
  paginateRest<T>(path: string, params?: Record<string, unknown>): Promise<T[]>;
  queryGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export const ActivityBaseSchema = z.object({ repositoryGithubId: githubId, actor: GitHubActorRefSchema, rawUrl: webUrl.nullable() });
export type ActivityBase = z.infer<typeof ActivityBaseSchema>;

export const CommitActivitySchema = ActivityBaseSchema.extend({
  kind: z.literal("commit"), externalId: text, occurredAt: utc,
  additions: count, deletions: count, isMerge: z.boolean(),
});
export type CommitActivity = z.infer<typeof CommitActivitySchema>;

export const PullRequestActivitySchema = ActivityBaseSchema.extend({
  kind: z.literal("pull_request"), externalId: githubId, number: positive,
  occurredAt: utc, state: z.enum(["open", "closed", "merged"]),
  closedAt: utc.nullable(), mergedAt: utc.nullable(),
});
export type PullRequestActivity = z.infer<typeof PullRequestActivitySchema>;

export const IssueActivitySchema = ActivityBaseSchema.extend({
  kind: z.literal("issue"), externalId: githubId, number: positive,
  occurredAt: utc, state: z.enum(["open", "closed"]), closedAt: utc.nullable(),
});
export type IssueActivity = z.infer<typeof IssueActivitySchema>;

export const GitHubActivitySchema = z.discriminatedUnion("kind", [CommitActivitySchema, PullRequestActivitySchema, IssueActivitySchema]);
export type GitHubActivity = z.infer<typeof GitHubActivitySchema>;

export const CollectRangeSchema = z.object({ from: utc, to: utc }).refine(
  ({ from, to }) => ordered(from, to), { path: ["to"], message: "to must be after from" },
);
export type CollectRange = z.infer<typeof CollectRangeSchema>;

export const RepositoryScopeApplyResultSchema = z.object({ tracked: count, untracked: count, upserted: count });
export type RepositoryScopeApplyResult = z.infer<typeof RepositoryScopeApplyResultSchema>;

export const IngestionResultSchema = z.object({ inserted: count, updated: count, skipped: count, errors: count });
export type IngestionResult = z.infer<typeof IngestionResultSchema>;

export const SyncRunStatusSchema = z.enum(["success", "partial", "failed"]);
export type SyncRunStatus = z.infer<typeof SyncRunStatusSchema>;

export const SyncTriggerSchema = z.enum(["scheduled", "manual"]);
export type SyncTrigger = z.infer<typeof SyncTriggerSchema>;

export const RunSyncInputSchema = z.object({ from: utc.optional(), to: utc.optional(), trigger: SyncTriggerSchema }).refine(
  ({ from, to }) => from === undefined || to === undefined || ordered(from, to),
  { path: ["to"], message: "to must be after from" },
);
export type RunSyncInput = z.infer<typeof RunSyncInputSchema>;

export const SyncRunResultSchema = z.object({
  status: SyncRunStatusSchema, trigger: SyncTriggerSchema,
  rangeFrom: utc, rangeTo: utc, repositoriesOk: count, repositoriesFailed: count,
  startedAt: utc, finishedAt: utc,
}).refine(({ rangeFrom, rangeTo }) => ordered(rangeFrom, rangeTo), {
  path: ["rangeTo"], message: "rangeTo must be after rangeFrom",
}).refine(({ startedAt, finishedAt }) => Date.parse(finishedAt) >= Date.parse(startedAt), {
  path: ["finishedAt"], message: "finishedAt must not precede startedAt",
});
export type SyncRunResult = z.infer<typeof SyncRunResultSchema>;

export const SyncStatusSchema = z.object({
  lastSuccessfulRunAt: utc.nullable(), lastRunStatus: SyncRunStatusSchema.nullable(),
  nextScheduledRunAt: utc.nullable(), dataStatus: z.enum(["fresh", "stale", "missing"]),
});
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export const TimeRangeSchema = z.enum(["7d", "30d", "90d", "all"]);
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const LeaderboardMetricSchema = z.enum(["score", "total", "commits", "prs", "issues"]);
export type LeaderboardMetric = z.infer<typeof LeaderboardMetricSchema>;

export const GroupSummarySchema = z.object({ name: text });
export type GroupSummary = z.infer<typeof GroupSummarySchema>;

const activityCounts = { commits: count, prs: count, issues: count, total: count };
export const ContributionCategorySchema=z.enum(["contributor","committer","maintainer"]);
export const ContributionTagSchema=z.object({
  id:githubId,githubId,login:text,category:ContributionCategorySchema,repository:text,
  evidenceUrls:z.array(webUrl),reason:text,actorLogin:text,createdAt:utc,revokedAt:utc.nullable(),
});
export type ContributionTag=z.infer<typeof ContributionTagSchema>;
export const ContributionTagsResponseSchema=z.object({items:z.array(ContributionTagSchema)});
const evidenceLink=z.string().trim().max(1000).url().refine(v=>{
  try{const u=new URL(v);return u.protocol==="https:"&&u.hostname==="github.com"&&!u.port&&!u.username&&!u.password
    && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:pull\/[1-9]\d*|issues\/[1-9]\d*|discussions\/[1-9]\d*|commit\/[a-fA-F0-9]{7,40}|blob\/.+)$/.test(u.pathname);}catch{return false}
},"请提供公开 GitHub 贡献或维护者名单链接");
export const AddContributionTagRequestSchema=z.object({
  githubId,category:ContributionCategorySchema,evidenceUrls:z.array(evidenceLink).min(1).max(6),
  reason:z.string().trim().min(5).max(1000),confirmed:z.literal(true),
}).strict().superRefine((v,ctx)=>{
  if(!v.evidenceUrls.every(url=>evidenceLink.safeParse(url).success))return;
  const urls=v.evidenceUrls.map(u=>new URL(u));const repo=(u:URL)=>u.pathname.split('/').slice(1,3).join('/').toLowerCase();
  if(new Set(urls.map(repo)).size!==1||new Set(urls.map(u=>u.origin+u.pathname)).size!==urls.length)ctx.addIssue({code:"custom",message:"证据必须属于同一项目且不能重复"});
  if(v.category==='committer'&&urls.filter(u=>/\/pull\//.test(u.pathname)).length<3)ctx.addIssue({code:"custom",message:"Committer 需提供至少3个合并 PR 链接"});
  if(v.category==='maintainer'&&(!urls.some(u=>/\/blob\//.test(u.pathname))||urls.filter(u=>/\/(pull|issues|discussions)\//.test(u.pathname)).length<2))ctx.addIssue({code:"custom",message:"Maintainer 需公开维护者名单及至少两次维护活动证据"});
});
export type AddContributionTagRequest=z.infer<typeof AddContributionTagRequestSchema>;
export const ContributionProfileSchema=z.object({
  submittedPrs:count,submittedIssues:count,mergedPrs:count,mergedSubmittedPrs:count,
  prMergeRate:z.number().min(0).max(100).nullable(),activeDays:count,activeWeeks:count,repositories:count,
  incomplete:z.boolean(),lastSyncedAt:utc.nullable(),
});
const scoringCounts = {
  score: z.number().int().safe().optional(), adjustmentScore: z.number().int().safe().optional(), commitIssueScore: count.optional(), prOpenedScore: count.optional(),
  prMergedScore: count.optional(), mergedPrs: count.optional(),
};

export const OrganizationActivitySummarySchema = z.object({ range: TimeRangeSchema, repositories: count, contributors: count, ...activityCounts });
export type OrganizationActivitySummary = z.infer<typeof OrganizationActivitySummarySchema>;

export const RepositoryStatSchema = z.object({ githubId, fullName: text, group: text, contributors: count, ...activityCounts });
export type RepositoryStat = z.infer<typeof RepositoryStatSchema>;

export const ContributorRankSchema = z.object({ rank: positive, login: text, avatarUrl: webUrl.nullable(), ...activityCounts, ...scoringCounts, bonusScore: count.optional(),communityTags:z.array(ContributionTagSchema).optional() });
export type ContributorRank = z.infer<typeof ContributorRankSchema>;

export const ContributorRepositoryStatSchema = z.object({ githubId: githubId.nullable(), fullName: text, group: text, ...activityCounts, ...scoringCounts });
export type ContributorRepositoryStat = z.infer<typeof ContributorRepositoryStatSchema>;

export const ContributorDetailSchema = z.object({
  login: text, avatarUrl: webUrl.nullable(), range: TimeRangeSchema,
  ...activityCounts, ...scoringCounts, bonusScore: count.optional(), repositories: z.array(ContributorRepositoryStatSchema),
  communityTags:z.array(ContributionTagSchema).optional(),contributionProfile:ContributionProfileSchema.optional(),
});
export type ContributorDetail = z.infer<typeof ContributorDetailSchema>;

export const HealthResponseSchema = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const OrganizationSummarySchema = OrganizationActivitySummarySchema.extend({
  lastUpdatedAt: utc.nullable(), dataStatus: SyncStatusSchema.shape.dataStatus,
});
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;

export const RepositoryStatsResponseSchema = z.object({ items: z.array(RepositoryStatSchema) });
export type RepositoryStatsResponse = z.infer<typeof RepositoryStatsResponseSchema>;

export const GroupsResponseSchema = z.object({ items: z.array(GroupSummarySchema) });
export type GroupsResponse = z.infer<typeof GroupsResponseSchema>;

export const ContributorLeaderboardResponseSchema = z.object({
  range: TimeRangeSchema, metric: LeaderboardMetricSchema, items: z.array(ContributorRankSchema),
});
export type ContributorLeaderboardResponse = z.infer<typeof ContributorLeaderboardResponseSchema>;

export const ApiErrorResponseSchema = z.object({ error: z.object({ code: text, message: text }) });
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

// Names used by the handoff Issues; aliases share the same runtime schema.
export const OrganizationSummaryResponseSchema = OrganizationSummarySchema;
export type OrganizationSummaryResponse = OrganizationSummary;
export const RepositoryContributorStatSchema = ContributorRepositoryStatSchema;
export type RepositoryContributorStat = ContributorRepositoryStat;

export const LeaderboardQuerySchema = z.object({
  range: TimeRangeSchema, metric: LeaderboardMetricSchema,
  group: text.optional(), limit: positive,
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;


const emailAddress = z.string().trim().max(254).email();

export const EmailCodeRequestSchema = z.object({
  email: emailAddress,
  studentId: z.string().trim().regex(/^[0-9]{6,20}$/, "Expected a student number"),
});
export type EmailCodeRequest = z.infer<typeof EmailCodeRequestSchema>;

export const EmailCodeVerifyRequestSchema = z.object({
  email: emailAddress,
  code: z.string().trim().regex(/^\d{6}$/, "Expected a 6-digit verification code"),
});
export type EmailCodeVerifyRequest = z.infer<typeof EmailCodeVerifyRequestSchema>;

export const EmailCodeSendResponseSchema = z.object({
  sent: z.literal(true),
  retryAfterSeconds: positive,
  expiresInSeconds: positive,
});
export type EmailCodeSendResponse = z.infer<typeof EmailCodeSendResponseSchema>;

export const GitHubLinkInfoSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    authorizeUrl: webUrl,
  }),
]);
export type GitHubLinkInfo = z.infer<typeof GitHubLinkInfoSchema>;

export const RegistrationStatusSchema = z.discriminatedUnion("registered", [
  z.object({ registered: z.literal(false) }),
  z.object({ registered: z.literal(true), login: text }),
]);
export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export const GitHubRegistrationIdentitySchema = z.discriminatedUnion("verified", [
  z.object({verified: z.literal(false)}),
  z.object({verified: z.literal(true), githubId, login: text}),
]);
export type GitHubRegistrationIdentity = z.infer<typeof GitHubRegistrationIdentitySchema>;

export const EmailCodeVerifyResponseSchema = z.object({
  verified: z.literal(true),
  githubLink: GitHubLinkInfoSchema,
  registered: z.literal(true).optional(),
});
export type EmailCodeVerifyResponse = z.infer<typeof EmailCodeVerifyResponseSchema>;

export const WebsiteSessionSchema = z.discriminatedUnion("authenticated", [
  z.object({authenticated:z.literal(false)}),
  z.object({authenticated:z.literal(true),login:text,registered:z.boolean(),isAdmin:z.boolean(),canTag:z.boolean().default(false),role:z.enum(["owner","admin"]).nullable().default(null),csrfToken:text}),
]);
export type WebsiteSession = z.infer<typeof WebsiteSessionSchema>;
export const CampusProjectSchema = z.object({
  name:text,repo:text,url:webUrl,lab:text,labUrl:webUrl.nullable(),description:text,tags:z.array(text),
});
export const CampusProjectsResponseSchema = z.object({items:z.array(CampusProjectSchema)});
export type CampusProject = z.infer<typeof CampusProjectSchema>;
export const ProjectReviewRequestSchema = z.object({
  decision:z.enum(["approve","reject"]),reviewNotes:z.string().max(1000).default(""),
  description:z.string().trim().max(500).optional(),labUrl:webUrl.optional(),tags:z.array(z.string().trim().min(1).max(40)).max(6).optional(),
}).refine(v=>v.decision!=="approve" || (v.description?.length??0)>=10,{message:"通过前请填写至少10字的公开简介"});
export type ProjectReviewRequest = z.infer<typeof ProjectReviewRequestSchema>;
export const ProjectProposalAdminSchema = z.object({
  id:positive,projectUrl:webUrl,labName:text,notes:text,status:z.enum(["pending","approved","rejected"]),
  submitterLogin:text.nullable(),createdAt:utc,reviewedAt:utc.nullable(),reviewNotes:z.string(),notificationSent:z.boolean(),notificationAttempts:count,
});
export const ProjectProposalAdminResponseSchema=z.object({items:z.array(ProjectProposalAdminSchema)});
export type ProjectProposalAdmin = z.infer<typeof ProjectProposalAdminSchema>;

export const ProjectProposalRequestSchema = z.object({
  projectUrl: z.string().trim().max(500).regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/),
  labName: z.string().trim().min(2).max(120),
  notes: z.string().trim().min(10).max(1200),
});
export type ProjectProposalRequest = z.infer<typeof ProjectProposalRequestSchema>;

export const ProjectProposalResponseSchema = z.object({
  submitted: z.literal(true),
  id: positive,
});
export type ProjectProposalResponse = z.infer<typeof ProjectProposalResponseSchema>;


export const SyncConfigSchema = AppConfigSchema.pick({
  githubOrg: true, groupProperty: true, ingestionCronSchedule: true,
  initialSyncDays: true, syncOverlapMinutes: true, dataStaleAfterHours: true,
});
export type SyncConfig = z.infer<typeof SyncConfigSchema>;


// Website permissions are persisted against stable OAuth-verified GitHub IDs.
export const WebsiteRoleSchema = z.enum(["owner", "admin"]);
export type WebsiteRole = z.infer<typeof WebsiteRoleSchema>;
const adminReason = z.string().trim().min(5).max(1000);
export const AdminRoleRequestSchema = z.object({
  githubLogin: z.string().trim().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  role: WebsiteRoleSchema.nullable(), reason: adminReason,
}).strict();
export type AdminRoleRequest = z.infer<typeof AdminRoleRequestSchema>;
export const AdminRoleEntrySchema = z.object({
  githubId, login:text, role:WebsiteRoleSchema, grantedBy:githubId, grantedAt:utc,
  revokedAt:utc.nullable(), reason:text,
});
export const AdminRolesResponseSchema=z.object({items:z.array(AdminRoleEntrySchema)});
export type AdminRoleEntry=z.infer<typeof AdminRoleEntrySchema>;
export const ScoreAdjustmentRequestSchema=z.object({
  githubId, delta:z.number().int().min(-100000).max(100000).refine(v=>v!==0),
  reason:adminReason, requestId:z.uuid(),
}).strict();
export type ScoreAdjustmentRequest=z.infer<typeof ScoreAdjustmentRequestSchema>;
export const ScoreAdjustmentSchema=z.object({
  id:githubId, githubId, login:text, delta:z.number().int().safe(), reason:text,
  actorLogin:text, createdAt:utc, requestId:z.uuid(), reversesId:githubId.nullable(),
  reversed:z.boolean(),
});
export type ScoreAdjustment=z.infer<typeof ScoreAdjustmentSchema>;
export const ScoreAdjustmentsResponseSchema=z.object({items:z.array(ScoreAdjustmentSchema)});
export const ReverseAdjustmentRequestSchema=z.object({reason:adminReason,requestId:z.uuid()}).strict();
export const AdminContributorsResponseSchema=z.object({items:z.array(z.object({githubId,login:text}))});
export const AdminAuditResponseSchema=z.object({items:z.array(z.object({
  id:githubId,actorLogin:text,targetLogin:text,action:text,reason:text,createdAt:utc,
}))});
