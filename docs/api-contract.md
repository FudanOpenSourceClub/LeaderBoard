# Phase 1 Interface Contract

> **这是 Phase 1 的唯一跨模块接口真相源（source of truth）。**
>
> 所有跨 Issue 的共享类型必须最终落到 `packages/contracts`，Backend 与 Frontend 均从该包导入。任何字段变更必须先修改本文和 contracts package，再修改实现，禁止各模块自行定义“相似但不同”的类型。

## 1. 全局约定

- Node.js：24 LTS
- 包管理：npm workspaces
- 共享契约：`@leadboard/contracts`
- Runtime schema：Zod
- 时间：ISO 8601 UTC string
- 时间窗口统一为半开区间：`[from, to)`
- GitHub numeric ID 在 JS/TS 边界统一序列化为 `string`
- GitHub stable ID 优先于 login / repository name
- HTTP Base Path：`/api/v1`
- 支持时间范围：`7d | 30d | 90d | all`
- `all` 表示 LeadBoard **已经入库的全部历史**，不承诺等于 GitHub 账号/仓库的全部历史
- 所有可重复执行的写入必须幂等
- 正式收录用户的榜单和详情包含已保存的个人公开贡献，与已监控仓库事件按身份去重；组织统计仍使用仓库范围。

## 2. Shared actor

```ts
export type GitHubActorType =
  | "User"
  | "Bot"
  | "Organization"
  | "Unknown";

export interface GitHubActorRef {
  githubId: string | null;
  login: string | null;
  avatarUrl: string | null;
  type: GitHubActorType;
}
```

规则：

- 无法关联 GitHub 用户的 Commit 允许所有 actor identity 字段为 null，`type="Unknown"`；
- Bot 判断优先使用 GitHub actor type，同时兼容常见 `[bot]` login；
- Actor 信息由 Collector 提供，Ingestion 不应为每条事件重新请求 GitHub 用户 API。

## 3. Config / Bootstrap

### 输入：环境变量

```text
GITHUB_TOKEN
GITHUB_ORG
LEADBOARD_GROUP_PROPERTY=leadboard_group
DATABASE_URL
PORT=3000
INGESTION_CRON_SCHEDULE=0 */6 * * *
INITIAL_SYNC_DAYS=30
SYNC_OVERLAP_MINUTES=10
DATA_STALE_AFTER_HOURS=12
```

### 输出

```ts
export interface AppConfig {
  githubToken: string;
  githubOrg: string;
  groupProperty: string;
  databaseUrl: string;
  port: number;
  ingestionCronSchedule: string;
  initialSyncDays: number;
  syncOverlapMinutes: number;
  dataStaleAfterHours: number;
}
```

要求：缺少必填项时启动失败；日志不得输出 Token。

## 4. Repository Sync

### 输入

```ts
export interface RepositorySyncInput {
  org: string;
  groupProperty: string;
}
```

### 单个受监控仓库

```ts
export interface TrackedRepository {
  githubId: string;
  nodeId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  group: string;
  htmlUrl: string;
  archived: boolean;
}
```

### 输出

```ts
export interface RepositorySyncResult {
  trackedRepositories: TrackedRepository[];
  syncedAt: string;
}
```

规则：

- `leadboard_group=<group>`：纳入；
- `leadboard_group=untracked`：排除；
- property 缺失：排除；
- Fork：排除；
- Private：Phase 1 排除；
- Repository rename 使用 `githubId` 识别为同一仓库；
- Repository / Custom Property 任一分页不完整时，整个 Repository Sync 失败，不得返回半套结果；
- 因为结果是完整快照，Ingestion 可以把数据库中“上一轮 tracked、这一轮已不在结果中”的仓库标记为 `tracked=false`。

## 5. GitHub Client

业务模块不得各自创建 GitHub HTTP Client。

```ts
export interface GitHubRepositoryRef {
  githubId: string;
  nodeId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
  archived: boolean;
  isFork: boolean;
  isPrivate: boolean;
}

export interface GitHubClient {
  listOrgRepositories(org: string): Promise<GitHubRepositoryRef[]>;

  getRepositoryCustomProperties(
    owner: string,
    repo: string
  ): Promise<Record<string, unknown>>;

  requestRest<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    params?: Record<string, unknown>
  ): Promise<T>;

  paginateRest<T>(
    path: string,
    params?: Record<string, unknown>
  ): Promise<T[]>;

  queryGraphQL<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T>;
}
```

边界：

- GitHub Client 负责鉴权、REST pagination、Rate Limit、Retry 和统一错误；
- GraphQL connection 的 cursor 循环由具体 Collector 负责，因为不同 query 的 connection 结构不同；
- Client 提供单次 `queryGraphQL` primitive；
- 错误可包含 endpoint/status/context，不得包含 Token。

## 6. Collector → Ingestion

使用 **discriminated union**，保证数据模型需要的字段不会丢失。

### Base

```ts
export interface ActivityBase {
  repositoryGithubId: string;
  actor: GitHubActorRef;
  rawUrl: string | null;
}
```

### Commit

```ts
export interface CommitActivity extends ActivityBase {
  kind: "commit";
  externalId: string;      // sha
  occurredAt: string;      // authored_at
  additions: number;
  deletions: number;
  isMerge: boolean;
}
```

### Pull Request

```ts
export interface PullRequestActivity extends ActivityBase {
  kind: "pull_request";
  externalId: string;      // GitHub PR database ID
  number: number;          // repository-local PR number
  occurredAt: string;      // created_at
  state: "open" | "closed" | "merged";
  closedAt: string | null;
  mergedAt: string | null;
}
```

### Issue

```ts
export interface IssueActivity extends ActivityBase {
  kind: "issue";
  externalId: string;      // GitHub Issue database ID
  number: number;
  occurredAt: string;      // created_at
  state: "open" | "closed";
  closedAt: string | null;
}
```

### Union

```ts
export type GitHubActivity =
  | CommitActivity
  | PullRequestActivity
  | IssueActivity;
```

唯一性：

```text
repositoryGithubId + kind + externalId
```

Collector 函数：

```ts
export interface CollectRange {
  from: string; // inclusive
  to: string;   // exclusive
}

collectCommits(
  repo: TrackedRepository,
  range: CollectRange
): Promise<CommitActivity[]>;

collectPullRequests(
  repo: TrackedRepository,
  range: CollectRange
): Promise<PullRequestActivity[]>;

collectIssues(
  repo: TrackedRepository,
  range: CollectRange
): Promise<IssueActivity[]>;
```

额外规则：

- Commit 只采默认分支；
- PR / Issue 排行口径按 `created_at`；
- Issue API 中的 PR 必须过滤；
- Merge commit 保留 `isMerge`，Phase 1 排名不使用代码行；
- Collector 只产生事实，不做排名。

## 7. Ingestion

Repository scope 与 activity 写入分开，避免仓库退出统计范围后无法更新状态。

```ts
export interface RepositoryScopeApplyResult {
  tracked: number;
  untracked: number;
  upserted: number;
}

export interface IngestionResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

applyRepositoryScope(
  scope: RepositorySyncResult
): Promise<RepositoryScopeApplyResult>;

ingestActivities(
  activities: GitHubActivity[]
): Promise<IngestionResult>;
```

要求：

- `applyRepositoryScope` 在完整 Repository Sync 成功后执行；
- 当前快照不存在的历史 tracked repository 标记为 `tracked=false`；
- group / repository / contributor 使用 stable ID upsert；
- Contributor 有 `githubId` 时按 githubId 归并，缺失时才退化为 login；
- 同一 activity 重放不会产生重复记录；
- 无 actor 的 Commit 仍写入仓库事实；
- Bot activity 保留，但 contributor 标记 `is_bot=true`。

## 8. Sync Orchestrator

```ts
export type SyncRunStatus =
  | "success"
  | "partial"
  | "failed";

export type SyncTrigger =
  | "scheduled"
  | "manual";

export interface RunSyncInput {
  from?: string;
  to?: string;
  trigger: SyncTrigger;
}

export interface SyncRunResult {
  status: SyncRunStatus;
  trigger: SyncTrigger;
  rangeFrom: string;
  rangeTo: string;
  repositoriesOk: number;
  repositoriesFailed: number;
  startedAt: string;
  finishedAt: string;
}
```

窗口策略：

- 所有区间使用 `[from,to)`；
- 显式传 `from/to` 时严格使用；
- 未显式传时，`to=now`；
- 有最近成功 run：`from = lastSuccessfulRangeTo - SYNC_OVERLAP_MINUTES`；
- 从未成功同步：`from = to - INITIAL_SYNC_DAYS`；
- overlap 依靠幂等 upsert 去重；
- 一次 run 对应一条 `sync_runs`；
- 同一时刻禁止两个 sync run 并发。

Sync query service：

```ts
export interface SyncStatus {
  lastSuccessfulRunAt: string | null;
  lastRunStatus: SyncRunStatus | null;
  nextScheduledRunAt: string | null;
  dataStatus: "fresh" | "stale" | "missing";
}

getSyncStatus(): Promise<SyncStatus>;
```

`dataStatus`：

- 从未成功：`missing`
- 距最近成功 > `DATA_STALE_AFTER_HOURS`：`stale`
- 否则：`fresh`

## 9. Analytics

```ts
export type TimeRange = "7d" | "30d" | "90d" | "all";
export type LeaderboardMetric = "total" | "commits" | "prs" | "issues";

export interface GroupSummary {
  name: string;
}

export interface OrganizationActivitySummary {
  range: TimeRange;
  repositories: number;
  contributors: number;
  commits: number;
  prs: number;
  issues: number;
  total: number;
}

export interface RepositoryStat {
  githubId: string;
  fullName: string;
  group: string;
  commits: number;
  prs: number;
  issues: number;
  contributors: number;
  total: number;
}

export interface ContributorRank {
  rank: number;
  login: string;
  avatarUrl: string | null;
  commits: number;
  prs: number;
  issues: number;
  total: number;
}

export interface ContributorRepositoryStat {
  githubId: string | null;
  fullName: string;
  group: string;
  commits: number;
  prs: number;
  issues: number;
  total: number;
}

export interface ContributorDetail {
  login: string;
  avatarUrl: string | null;
  range: TimeRange;
  commits: number;
  prs: number;
  issues: number;
  total: number;
  repositories: ContributorRepositoryStat[];
}
```

Service：

```ts
getGroups(): Promise<GroupSummary[]>;

getOrganizationActivitySummary(
  range: TimeRange
): Promise<OrganizationActivitySummary>;

getRepositoryStats(
  range: TimeRange,
  group?: string
): Promise<RepositoryStat[]>;

getContributorLeaderboard(input: {
  range: TimeRange;
  metric: LeaderboardMetric;
  group?: string;
  limit: number;
}): Promise<ContributorRank[]>;

getContributorDetail(
  username: string,
  range: TimeRange
): Promise<ContributorDetail | null>;
```

口径：

```text
commits = authored_at in range 的 tracked default-branch commit
prs     = created_at in range 的 tracked PR
issues  = created_at in range 的 tracked Issue
total   = commits + prs + issues
```

- Organization / Repository activity 包含 Bot activity 和无法归属 contributor 的 Commit；
- Contributor 数量和 Contributor Leaderboard 只统计可识别的非 Bot contributor；
- Phase 1 不使用加权积分；
- 同分排序：`metric DESC, login ASC`。

## 10. REST API

### Health

`GET /health`

```json
{ "status": "ok" }
```

共享健康检查类型：

```ts
export interface HealthResponse {
  status: "ok";
}
```

### Organization Summary

`GET /api/v1/organization/summary?range=30d`

返回 `OrganizationSummary`。按照 #15 的组合规则：

```ts
export interface OrganizationSummary extends OrganizationActivitySummary {
  lastUpdatedAt: string | null;
  dataStatus: SyncStatus["dataStatus"];
}
```

API 直接复用 Analytics 的活动字段；`lastUpdatedAt` 来自
`SyncStatus.lastSuccessfulRunAt`，`dataStatus` 来自 `SyncStatus.dataStatus`。
API 不重新计算统计数字或新鲜度。

### Repository Stats

`GET /api/v1/organization/repositories?range=30d&group=AI`

```ts
export interface RepositoryStatsResponse {
  items: RepositoryStat[];
}
```

### Groups

`GET /api/v1/groups`

```ts
export interface GroupsResponse {
  items: GroupSummary[];
}
```

`group` query 参数使用 group **name**，不是数据库 ID。

### Contributor Leaderboard

`GET /api/v1/contributors/leaderboard?range=30d&metric=total&limit=50&group=AI`

```ts
export interface ContributorLeaderboardResponse {
  range: TimeRange;
  metric: LeaderboardMetric;
  items: ContributorRank[];
}
```

### Contributor Detail

`GET /api/v1/contributors/:username?range=30d`

返回 `ContributorDetail`；不存在返回 404。

个人公开贡献中的仓库可能尚未进入仓库目录，其 `githubId` 为 `null`；`fullName` 始终保留真实仓库名，前端以该名称作为列表键。
正式收录用户即使在所选时间范围没有活动，也返回总数为 0 的详情。

### 个人贡献导出

`GET /api/v1/contributors/:username/export.csv`

返回已保存的全部历史贡献，UTF-8 BOM CSV，列为类型、仓库、时间(UTC)、SHA或编号、标题、原始链接、统计口径。
下载不实时调用 GitHub。未收录且没有贡献记录的账号返回 404。
`/api/v1/public-contributors/:username/export.csv` 保留为兼容路径。
`X-LeaderBoard-Event-Count` 为导出条数，`X-LeaderBoard-Truncated` 和
`X-LeaderBoard-Incomplete` 表示采集状态，响应使用 `Cache-Control: no-store`。

### Sync Status

`GET /api/v1/sync/status`

返回 `SyncStatus`。

## 11. 错误格式

```ts
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
```

示例 code：

```text
INVALID_RANGE
INVALID_METRIC
INVALID_LIMIT
CONTRIBUTOR_NOT_FOUND
DATABASE_UNAVAILABLE
GITHUB_RATE_LIMITED
SYNC_ALREADY_RUNNING
INTERNAL_ERROR
```

## 12. 接口变更规则

任何跨模块接口变更必须按此顺序：

1. 在相关 Issue 说明变更原因；
2. 更新本文；
3. 更新 `packages/contracts` schema/type；
4. 更新/增加 contract test；
5. 再修改 Backend / Frontend 实现。

未经以上步骤，不接受“本模块先自定义一个字段”的 PR。

## 13. Bootstrap schema exports

`@leadboard/contracts` 的数据结构同时导出同名 TypeScript type 与
`<TypeName>Schema`（如 `GitHubActivitySchema`）。类型均由 Zod 推导。
`GitHubClient` 是含泛型方法的 TypeScript interface；它不是 JSON DTO。

Schema 校验 numeric ID 为十进制字符串、时间为 UTC `Z` 结尾的 ISO 时间、
计数为非负安全整数、序号/端口为正整数，并校验时间窗口先后顺序。
未知对象字段按 Zod 默认行为移除。Schema 不执行 IO、采集、排名或 freshness 计算。
`AppConfigSchema` 验证解析后的配置；Backend `loadConfig` 负责 env 映射、
默认值和 cron 校验，错误信息只输出字段名，不回显配置值。

## 14. Issue 名称兼容与运行入口（集成审查补充）

为保证任务说明中的 import 可以直接编译，共享包同时导出：

| Issue 中使用的名称 | 共享包定义 |
|---|---|
| `OrganizationSummaryResponse` / `OrganizationSummaryResponseSchema` | `OrganizationSummary` / `OrganizationSummarySchema` 的别名 |
| `RepositoryContributorStat` / `RepositoryContributorStatSchema` | `ContributorRepositoryStat` / `ContributorRepositoryStatSchema` 的别名 |
| `LeaderboardQuery` / `LeaderboardQuerySchema` | `{ range: TimeRange; metric: LeaderboardMetric; group?: string; limit: number }` |
| `SyncConfig` / `SyncConfigSchema` | 从 `AppConfig` 选取 `githubOrg`、`groupProperty`、`ingestionCronSchedule`、`initialSyncDays`、`syncOverlapMinutes`、`dataStaleAfterHours` |

别名引用同一个 schema，不允许在前后端另复制类型。前端查询的 `limit` 可选，由 HTTP 层补默认值 50；Analytics 的 `LeaderboardQuery.limit` 必填。

运行接入责任：

- #13 必须把调度器接到 `backend/src/server.ts`；导入模块不启动任务。根目录提供 `npm run sync:once`，以 `trigger="manual"` 调用同一个 `runSync()`，输出不含凭据的结果后关闭连接。CLI 和服务进程必须使用同一数据库锁，不能只用进程内布尔变量防重入。
- #15 把业务 Router 传给 `createApp({ apiRouter })`，挂载到 `/api/v1`，位于 404 之前。Router 内路径不再重复 `/api/v1`。`createApp()` 无参数仍支持健康检查。业务错误按约定映射 4xx/5xx，未处理错误统一返回不含内部信息的 JSON 500。
- #18 验证真实运行入口：空库建表、`sync:once`、后端启动、构建后的网页、网页到后端的代理，以及详情页直接打开/刷新。不能仅导入内部函数后宣称整站启动成功。
- `sync_runs.status=running` 是数据库内部状态；公共 `SyncRunStatus` 仍只包含已结束的 `success|partial|failed`。`getSyncStatus().lastRunStatus` 返回最近已结束的 run；没有则为 null。
- 只提供 `from` 时，`to=now`；只提供 `to` 时，以该 to 按默认策略推导 from；最终必须满足 `from < to`。`partial/failed` 不能推进成功游标。未显式指定 from 时，新加入或重新纳入的仓库至少从 `to - initialSyncDays` 开始采集，不能直接套用其他仓库的最近游标；显式窗口优先。
- Phase 1 是单 Organization 配置、单数据库统计范围；切换 `GITHUB_ORG` 需要新数据库，不能把多个组织的完整 scope 交替写进同一数据库。

数据语义边界：PR/Issue 按 `created_at` 采集时，只保证采集当时的状态；旧事件之后的关闭/合并不会因新建时间窗口自动刷新。默认分支新增但 authored_at 早于同步窗口的 Commit 也可能不被覆盖。当前不承诺完整历史、全量状态持续刷新或处理 force-push 撤回事实；需要扩展时另设任务，不能把滑动窗口描述成 GitHub 全量镜像。


HTTP 参数默认值：省略 range 使用 30d，省略 metric 使用 total，省略 limit 使用 50；group 省略表示不过滤。显式空值、重复参数及非法值返回 JSON 4xx；不能用默认值掩盖无效输入。HTTP 层转换正十进制 limit，Analytics 接收数字。数据库聚合计数安全转换为 number，GitHub BIGINT ID 保持 string。

IngestionResult 的 inserted/updated/skipped/errors 以输入 Activity 条数计数，每条只属于一项；正常返回四项之和等于输入条数。异常回滚必须上报；errors>0 不能被同步器算作该仓库成功。空的完整 scope 可以成功；scope 失败或全部仓库失败为 failed，只有部分仓库失败为 partial。


## 15. 复旦邮箱身份验证 API

个人贡献榜的第一步只验证复旦身份邮箱。GitHub OAuth 与个人贡献采集在下一阶段接入。

### 发送验证码

`POST /api/v1/auth/email/send-code`

请求：

```json
{
  "email": "student@fudan.edu.cn"
}
```

成功返回 HTTP 202：

```json
{
  "sent": true,
  "retryAfterSeconds": 60,
  "expiresInSeconds": 600
}
```

服务端同时校验允许的复旦邮箱域名；允许域名由
`FUDAN_EMAIL_DOMAINS` 配置，默认 `fudan.edu.cn,m.fudan.edu.cn`，并接受这些根域的子域。

### 验证验证码

`POST /api/v1/auth/email/verify`

请求：

```json
{
  "email": "student@fudan.edu.cn",
  "code": "012345"
}
```

成功返回 HTTP 200：

```json
{
  "verified": true
}
```

成功后创建或刷新同一 `email_fingerprint` 对应的 `members` 记录，不重复创建身份。

### 身份验证错误 code

```text
INVALID_EMAIL
INVALID_FUDAN_EMAIL
INVALID_VERIFICATION_CODE
VERIFICATION_CODE_EXPIRED
VERIFICATION_CODE_USED
VERIFICATION_ATTEMPTS_EXCEEDED
EMAIL_RESEND_TOO_SOON
EMAIL_RATE_LIMITED
IP_RATE_LIMITED
EMAIL_DELIVERY_FAILED
EMAIL_AUTH_NOT_CONFIGURED
```

安全边界：

- API 不返回验证码、code hash、SMTP 凭据、邮箱 HMAC secret；
- 完整邮箱仅用于当前请求和实际发信，不作为长期身份字段落库；
- 反向代理仅在 loopback 来源时被 Express 信任，用于可靠取得客户端 IP；
- 未配置 `EMAIL_HMAC_SECRET` 或 SMTP 时，服务仍可正常启动，但相关接口返回安全的 503；
- SMTP 支持隐式 TLS（常见 465）及 STARTTLS（常见 587）。


## 达人榜积分、每日增量与唯一注册

- 默认 `range=all&metric=score`；`score` 是新增排序指标，接口最多返回 10 人，同分按 GitHub 用户名稳定排序，超额活动次数不参与破同分。
- Contributor rank/detail/repository 增加 `score`、`commitIssueScore`、`prOpenedScore`、`prMergedScore`、`mergedPrs`。
- 仅 `scoring_repositories.enabled=true` 的稳定 Repository ID 计分，名称和 URL 不能代替 ID。根目录 `scoring-whitelist.json` 管理候选及启用状态。
- Commit/Issue 共用每用户自然月 10 次、每用户每仓库每自然月 3 次额度，每次 1 分。北京时间划分月份，按贡献时间和稳定身份确定次序。先检查仓库额度，未超仓库额度的记录再检查个人月度额度。
- 每次计算先检查完整历史，再筛选展示范围；时间筛选和分组不重置额度。PR 在创建时得 20 分、在 `merged_at` 时另得 30 分，不使用 closed 状态冒充 merged。
- CSV 增加仓库 ID、对象 ID、合并时间、白名单命中、自然月、两个额度的计数/超限标记、得分及 PR 分项。
- `POST /auth/email/send-code` 现需 `{ email, studentId, githubLogin }`。先解析 GitHub 稳定 ID，再查邮箱、学号指纹、注册/绑定的 GitHub ID；重复返回 409 `ALREADY_REGISTERED`，不发邮件。
- `POST /auth/email/verify` 仍需 `{ email, code }`。校验成功才创建用户，数据库唯一约束和事务锁保证并发只能注册一次；之后 OAuth 必须匹配预先填写的 GitHub 稳定 ID。
- 邮箱验证后通过 7 天 HttpOnly/Secure/SameSite=Lax Cookie 恢复未完成绑定。`POST /auth/github/retry` 不重发验证码、不创建第二个用户，已完成绑定后不能继续绑定第二个账号；同一凭据可在有效期内查询已完成的注册状态。
- 个人贡献每日增量采集，PR/Issue 按 `updated` 拉取，Commit 按 `committer-date` 拉取并保留重叠窗口。首次升级完整回填稳定仓库 ID 与合并状态；只有完整成功才推进游标。每批按用户 ID、贡献类型、仓库 ID、SHA/编号 upsert，永久保留历史。


## 后台确认注册成功（2026-10-22）

`GET /api/v1/auth/registration/status` 使用 HttpOnly/Secure/SameSite=Lax 注册 Cookie，返回
`{registered:false}` 或 `{registered:true,login:"GitHub用户名"}`，并设置 `Cache-Control: no-store`。
不返回学号、邮箱、指纹、成员 ID 或任何姓名字段；不采集姓名。

OAuth 回调必须携带与该 state 对应成员一致的注册 Cookie。绑定事务内检查学号指纹、
GitHub 稳定账号 ID 和一对一绑定关系；事务提交后重新查询 members、member_github_accounts、
github_accounts、contributors，确认唯一且完整才跳回成功页面。前端再次调用状态接口，
网址中的 `github=success` 或 `login` 不能作为注册成功凭据。

手工收录的 contributor 不是注册身份，允许通过邮箱验证及匹配该账号的 GitHub OAuth
认领已有档案，不创建重复 contributor，保留贡献及开发奖励。已注册成员仍拒绝重复注册。

Contributor rank/detail 新增可选 `bonusScore`：独立开发奖励，包含在 `score` 中，
按奖励发放时间进入 7d/30d/90d/all；实验室分组筛选不包含全站开发奖励。
奖励不伪装成 Commit/Issue/PR，不占白名单贡献配额。

## 注册会话、项目审核与关闭导出（2026-10-22）

- `GET /auth/session`：返回 `{authenticated:false}`，或已认证 GitHub 用户名、`registered`、`isAdmin`、会话专用 `csrfToken`。不返回学号、姓名、邮箱或内部成员 ID。
- `GET /auth/github/login?returnTo=/projects|/admin|/join`：GitHub 官方登录；复用既有 OAuth 回调地址，通过独立 state 与 HttpOnly 浏览器凭据防止回调串用。已注册用户和配置中的管理员可登录。网站会话有效期30天。
- `POST /project-proposals`：仅注册且登录的成员可用，须携带 `X-CSRF-Token`。服务器固定提交者身份，忽略客户端伪造的 memberId。只接受公开 GitHub 仓库，按稳定仓库 ID 防止重复待审/已收录申请。申请与邮件 outbox 在同一事务提交。
- `GET /admin/project-proposals`：仅管理员可读申请原文、申请人 GitHub、审核结论、通知状态。
- `POST /admin/project-proposals/:id/review`：仅管理员且须 CSRF。`decision=approve|reject`；通过时须提供10至500字 `description`，可选 `labUrl`、`tags`、`reviewNotes`。通过后事务性写入网站项目目录，重复审核返回409；拒绝不加入目录。
- `GET /projects`：公开数据库目录；不公开原始申请说明、内部成员信息。审批收录与贡献计分白名单独立，不自动改变计分范围。
- 贡献页面不再提供导出按钮；两个历史 CSV 下载路由均返回410 `EXPORT_DISABLED`。
- 网站后台权限按 `ADMIN_GITHUB_IDS` 判断，默认仓库所有者的稳定 ID；管理员身份与是否完成复旦注册分开，未完成注册的管理员也不能提交用户申请。
- `PROJECT_REVIEW_EMAIL` 指定通知邮箱。发送队列每30秒检查一次，立即尝试新申请；SMTP失败保留任务并退避重试。邮件链接不能执行审核操作。

个人贡献刷新从 `/user/{github_id}` 获取当前用户名并核对 ID；某个用户失败不阻断其他用户，整批仍报告失败以便发现问题。仓库 PR/Issue 同步包含本轮更新、关闭或合并的历史对象，保留原始创建时间计算提交分，按合并时间计算合并分。
