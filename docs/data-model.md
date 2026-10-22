# Phase 1 Data Model

数据库：PostgreSQL。

> 数据库保存 **GitHub 原始事实**，统计结果由 Analytics 查询得到。Phase 1 不把排行榜分数写回事实表。

## 1. 原则

1. GitHub stable ID 优先于可变名称；
2. 所有 activity 写入必须可幂等重放；
3. Repository scope 是“当前快照”，历史 activity 是“事实记录”；
4. Repository 退出统计范围后不删除历史数据，只将 `tracked=false`；
5. Bot activity 可以计入仓库活动，但 Bot 不进入人类 Contributor Leaderboard；
6. 无法关联 GitHub 用户的 Commit 仍然属于仓库活动；
7. 所有时间字段使用 `TIMESTAMPTZ`。

## 2. groups

```text
id              BIGSERIAL PK
name            TEXT UNIQUE NOT NULL
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

## 3. repositories

```text
id              BIGSERIAL PK
github_id       BIGINT UNIQUE NOT NULL
node_id         TEXT UNIQUE NOT NULL
owner           TEXT NOT NULL
name            TEXT NOT NULL
full_name       TEXT NOT NULL
default_branch  TEXT NOT NULL
group_id        BIGINT NULL FK -> groups.id
html_url        TEXT NOT NULL
archived        BOOLEAN NOT NULL DEFAULT FALSE
tracked         BOOLEAN NOT NULL DEFAULT TRUE
last_synced_at  TIMESTAMPTZ
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

规则：

- rename 通过 `github_id` 更新 owner/name/full_name；
- 当前完整 scope 中不存在的历史 tracked repository 标记 `tracked=false`；
- untracked repository 历史事实保留；
- 当前查询默认只聚合 `tracked=true` 的仓库。

建议索引：

```text
INDEX repositories_tracked_idx (tracked)
INDEX repositories_group_id_idx (group_id)
```

## 4. contributors

```text
id              BIGSERIAL PK
github_id       BIGINT UNIQUE
login           TEXT
avatar_url      TEXT
actor_type      TEXT NOT NULL DEFAULT 'Unknown'
is_bot          BOOLEAN NOT NULL DEFAULT FALSE
enrolled_at     TIMESTAMPTZ NULL
public_synced_at TIMESTAMPTZ NULL
public_sync_truncated  BOOLEAN NOT NULL DEFAULT FALSE
public_sync_incomplete BOOLEAN NOT NULL DEFAULT FALSE
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

约束建议：

- `github_id` 非空时作为第一身份键；
- `login` 允许 GitHub rename 后更新；
- 对 `github_id IS NULL` 的 fallback actor，可按规范化 login 查找；
- 不强制把 actor unknown 的 Commit 建 contributor。

可选部分唯一索引由 migration 实现时根据 PostgreSQL 语义确定，避免两个 NULL 规则导致错误归并。

## 5. commits

```text
id              BIGSERIAL PK
repository_id   BIGINT NOT NULL FK -> repositories.id
sha             TEXT NOT NULL
contributor_id  BIGINT NULL FK -> contributors.id
authored_at     TIMESTAMPTZ NOT NULL
additions       INTEGER NOT NULL DEFAULT 0
deletions       INTEGER NOT NULL DEFAULT 0
is_merge        BOOLEAN NOT NULL DEFAULT FALSE
html_url        TEXT
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE(repository_id, sha)
```

说明：

- 只保存被 Collector 采集到的默认分支 Commit；
- Phase 1 排行只计 Commit 数，不使用 additions/deletions；
- merge commit 保留真实 `is_merge` 标识；
- additions/deletions 保存 API 返回事实，不用于 Phase 1 total。

建议索引：

```text
INDEX commits_authored_at_idx (authored_at)
INDEX commits_repository_time_idx (repository_id, authored_at)
INDEX commits_contributor_time_idx (contributor_id, authored_at)
```

## 6. pull_requests

```text
id              BIGSERIAL PK
repository_id   BIGINT NOT NULL FK -> repositories.id
github_id       BIGINT NOT NULL
number          INTEGER NOT NULL
contributor_id  BIGINT NULL FK -> contributors.id
state           TEXT NOT NULL
created_at      TIMESTAMPTZ NOT NULL
closed_at       TIMESTAMPTZ
merged_at       TIMESTAMPTZ
html_url        TEXT
ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE(repository_id, github_id)
```

Phase 1 排行按照 **PR created_at** 计入范围。

建议索引：

```text
INDEX prs_created_at_idx (created_at)
INDEX prs_repository_time_idx (repository_id, created_at)
INDEX prs_contributor_time_idx (contributor_id, created_at)
```

## 7. issues

```text
id              BIGSERIAL PK
repository_id   BIGINT NOT NULL FK -> repositories.id
github_id       BIGINT NOT NULL
number          INTEGER NOT NULL
contributor_id  BIGINT NULL FK -> contributors.id
state           TEXT NOT NULL
created_at      TIMESTAMPTZ NOT NULL
closed_at       TIMESTAMPTZ
html_url        TEXT
ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE(repository_id, github_id)
```

规则：

- PR 不得同时写入 issues；
- Phase 1 排行按照 **Issue created_at** 计入范围。

建议索引：

```text
INDEX issues_created_at_idx (created_at)
INDEX issues_repository_time_idx (repository_id, created_at)
INDEX issues_contributor_time_idx (contributor_id, created_at)
```

## 8. sync_runs

```text
id                      BIGSERIAL PK
trigger                  TEXT NOT NULL
range_from               TIMESTAMPTZ NOT NULL
range_to                 TIMESTAMPTZ NOT NULL
started_at               TIMESTAMPTZ NOT NULL
finished_at              TIMESTAMPTZ
status                   TEXT NOT NULL
repositories_ok          INTEGER NOT NULL DEFAULT 0
repositories_failed      INTEGER NOT NULL DEFAULT 0
error_message            TEXT
created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
```

建议 status：

```text
running | success | partial | failed
```

建议 trigger：

```text
scheduled | manual
```

用途：

- 计算最近成功同步；
- 生成下一次增量同步起点；
- 提供 API freshness；
- 记录 partial / failed run。

建议索引：

```text
INDEX sync_runs_status_finished_idx (status, finished_at DESC)
```

## 9. Repository scope 更新事务

一次 Repository Sync 成功后：

1. upsert 本轮 `trackedRepositories`；
2. 为新 group upsert groups；
3. 更新 tracked repo 的 `tracked=true`、group、rename 后名称、`last_synced_at`；
4. 将数据库中上一轮 tracked、但本轮完整快照不包含的 repository 设置为 `tracked=false`；
5. 整体在事务中完成。

Repository Sync 本身若不完整/失败，**不得执行第 4 步**。

## 10. Contributor upsert

```text
actor.githubId != null:
    先按 github_id 查找 / upsert
    login 和 avatar 可以更新

actor.githubId == null && actor.login != null:
    可按规范化 login fallback 查找

actor.login == null:
    不生成 contributor
```

`is_bot`：

- `actor.type == Bot` → true；
- 或 login 匹配常见 `[bot]` → true。

## 11. Phase 1 排行口径

对给定时间范围：

```text
commits = tracked repo 中 authored_at 落在范围内的 commit 数
prs     = tracked repo 中 created_at 落在范围内的 PR 数
issues  = tracked repo 中 created_at 落在范围内的 Issue 数
total   = commits + prs + issues
```

时间窗口为 `[from,to)`。

### Organization / Repository 统计

包含：

- Bot activity；
- 无法归属 contributor 的 Commit。

### Contributor 统计

只包含：

- actor 可识别；
- contributor `is_bot=false`。

## 12. all 的含义

`range=all` = 数据库中已采集的全部事实。

它不表示系统一定回填了仓库在 GitHub 上从创建至今的全部历史。

## 13. 后续兼容

未来加入 Review、外部仓库贡献、加权积分时：

- 新增 fact table / aggregation layer；
- 不修改已有 Commit / PR / Issue 的历史语义；
- 分数由独立 scoring layer 产生，不覆盖原始事实。


## 14. 复旦身份验证（自助身份绑定）

个人贡献榜使用独立的身份层，不把 GitHub contributor 直接当作复旦成员。

### members

```text
id                      BIGSERIAL PK
email_fingerprint       TEXT UNIQUE NOT NULL
email_domain            TEXT NOT NULL
verification_status     TEXT NOT NULL DEFAULT 'verified'
verified_at             TIMESTAMPTZ NOT NULL
last_reverified_at      TIMESTAMPTZ NOT NULL
created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
```

`email_fingerprint` 使用服务器密钥对规范化邮箱执行
`HMAC-SHA256("email:" + normalized_email)`。数据库不需要长期保存完整邮箱。

当前 `verification_status`：

```text
verified | revoked
```

邮箱验证仅证明“复旦身份邮箱可用”，当前不宣称严格的在校学生学籍认证。

### email_verification_challenges

```text
id                         BIGSERIAL PK
email_fingerprint          TEXT NOT NULL
email_domain               TEXT NOT NULL
requester_ip_fingerprint   TEXT NOT NULL
code_hash                  TEXT NOT NULL
code_salt                  TEXT NOT NULL
expires_at                 TIMESTAMPTZ NOT NULL
attempt_count              INTEGER NOT NULL DEFAULT 0
used_at                    TIMESTAMPTZ
delivery_status            TEXT NOT NULL DEFAULT 'pending'
sent_at                    TIMESTAMPTZ
created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
```

安全规则：

- 验证码为密码学随机的 6 位数字；
- 10 分钟过期；
- 同邮箱 60 秒内禁止重发；
- 每小时同邮箱最多 5 次成功/进行中的发送；
- 每小时同来源 IP 最多 20 次成功/进行中的发送；
- 单验证码最多 5 次错误尝试；
- 成功验证后立即设置 `used_at`，禁止重复使用；
- 验证码使用带随机 salt 的 scrypt 派生值保存，不保存明文；
- 来源 IP 与邮箱一样只保存 HMAC fingerprint，不保存原始值；
- 邮件发送失败的 challenge 标记为 `failed`，不占用后续发送频率额度。

### github_accounts（下一阶段预留）

```text
github_id       BIGINT PK
login           TEXT NOT NULL
avatar_url      TEXT
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
```

GitHub 身份使用稳定的 `github_id`，不使用可修改的 login 作为永久主键。

### member_github_accounts（下一阶段预留）

```text
member_id       BIGINT NOT NULL FK -> members.id
github_id       BIGINT NOT NULL FK -> github_accounts.github_id
linked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
is_primary      BOOLEAN NOT NULL DEFAULT FALSE

PRIMARY KEY(member_id, github_id)
```

一个成员可以绑定多个 GitHub 账号；同一成员最多一个 `is_primary=true` 账号。

## 15. 正式收录的个人贡献

管理员通过根目录 `contributors.json` 收录 GitHub 用户。部署运行
`scripts/sync-contributors.mjs`，按 GitHub stable ID 幂等保存账号并设置 `enrolled_at`。
该收录不生成邮箱验证或 OAuth 绑定记录；自助身份验证继续使用现有身份层。

`contributor_public_activities` 保存这些用户的公开 Commit、PR、Issue：

```text
contributor_id BIGINT NOT NULL FK -> contributors.id ON DELETE CASCADE
kind           TEXT NOT NULL CHECK IN ('commit', 'pull_request', 'issue')
repository     TEXT NOT NULL
identifier     TEXT NOT NULL
occurred_at    TIMESTAMPTZ NOT NULL
title          TEXT NOT NULL
html_url       TEXT NOT NULL
PRIMARY KEY(contributor_id, kind, repository, identifier)
INDEX contributor_public_activities_time_idx (contributor_id, occurred_at)
```

达人榜及个人详情将这些记录与已监控仓库活动合并，按用户、类型、仓库和 SHA/编号去重。
项目/组织汇总仍只计算已监控仓库。已收录用户在当前时间范围没有活动时以 0 条保留在总榜。
普通同步任务每六小时刷新个人记录，下载直接读取已保存记录。
完整快照在事务内替换旧记录；GitHub 不完整结果不覆盖旧数据；达到每类 5,000 条上限时保留已采集历史并设置截断标记。


## 16. 稳定身份贡献账本与注册约束

`contributor_public_activities` 升级为 `id BIGSERIAL PRIMARY KEY`；新增可回填的
`repository_github_id BIGINT`、`object_github_id BIGINT`、`merged_at TIMESTAMPTZ`、
`first_seen_at/last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()`。
`UNIQUE(contributor_id, kind, repository_github_id, identifier)` 保证重复采集、PR 状态更新、仓库重命名不新增重复贡献。
旧记录仓库 ID 空时仅保留历史；完成真实 ID 回填前不计分。新增写入必须带真实仓库 ID。
`contributors.public_sync_version INTEGER NOT NULL DEFAULT 0` 标记回填版本；当前版本 2 使用每日重叠增量游标。

`scoring_repositories`：`github_id BIGINT PRIMARY KEY`、`full_name/html_url TEXT NOT NULL`、
`enabled BOOLEAN NOT NULL DEFAULT FALSE`、`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`。
91 项初筛仓库保留为停用候选，待细分规则后启用；所有计分检查稳定 ID。

`members` 新增唯一的可空 `student_fingerprint TEXT`（HMAC-SHA256）、
`registration_github_id BIGINT`、`registration_session_hash TEXT`，以及可空
`registration_session_expires_at TIMESTAMPTZ`。旧用户字段可空以保留原记录，新注册必须填写学号和 GitHub。
`email_verification_challenges` 保存同次注册的学号指纹、`requested_github_id BIGINT` 与 `requested_github_login TEXT`。
`member_single_github_account_idx(member_id)` 与现有 GitHub 账号所属唯一索引组成一对一约束。
邮箱验证、注册和 OAuth 绑定共享事务锁，唯一约束负责最终防重。恢复注册的 Cookie 只允许继续原用户绑定，不能更换账号或新建用户。

个人历史只做 upsert；限额与分数不覆盖贡献事实。旧第 15 节的完整快照替换策略由本节的永久增量策略替代，刷新间隔改为每日。


## 17. 开发贡献奖励与完成注册确认

`contributor_score_awards(contributor_id BIGINT REFERENCES contributors(id) ON DELETE CASCADE,
award_key TEXT, points INTEGER CHECK(points>0), reason TEXT, awarded_at TIMESTAMPTZ DEFAULT now())`。
`PRIMARY KEY(contributor_id,award_key)` 确保同一账号同一奖励只发一次。
`leaderboard-development-v1` 为四位实际开发者各 50 分；迁移只增加 contributor 和奖励，
不虚构邮箱、学号或 OAuth 认证记录。重复部署/重新绑定不重复发奖。

注册会话哈希在 OAuth 完成后保留到原有效期，作为只读完成凭据；
`resumeRegistration` 仍禁止已绑定成员重复绑定。状态查询检查学号指纹存在且唯一、
稳定 GitHub ID 一致且仅绑定一个成员、贡献者确实存在，查询不输出任何学号信息。

## 18. 网站会话与仓库审核

`website_sessions` 保存随机会话 token 的 SHA256、GitHub ID、登录用户名、CSRF 随机值、过期时间；身份和管理权限每次在后端核验。`website_login_states` 保存一次性 OAuth state 哈希、浏览器凭据哈希、受限返回路径、过期/使用时间。

`project_proposals` 增加提交成员外键、稳定 GitHub 仓库 ID、审核人 GitHub ID、审核时间和备注；相同仓库仅允许一个待审核申请。历史匿名申请保留，但新请求必须关联已认证成员。

`campus_projects` 保存网站公开展示字段，以 GitHub 仓库 ID 和 URL 唯一；初始三个项目由原有页面迁入。审批写入申请外键，不自动启用积分白名单。

`project_notification_outbox` 每个申请一条持久化邮件任务，记录尝试次数、发送时间、下次尝试时间、租约和安全错误标记。任务通过数据库锁领取，发送失败退避重试，成功后不再领取；服务重启可继续。SMTP投递采用至少一次语义，极端断电场景可能重复通知，不能保证收件方邮箱的最终投递。

## 19. Commit/Issue 的 Star 门槛

`repository_star_counts` 保存 `github_id BIGINT PRIMARY KEY`、`stars INTEGER NULL CHECK(stars>=0)`、`checked_at TIMESTAMPTZ NOT NULL DEFAULT now()`。GitHub API 按稳定仓库 ID 查询并核对返回 ID；相同仓库供所有用户共享缓存。`stars=NULL` 表示仓库无法公开访问，不满足门槛。临时请求失败不覆盖最近一次核实结果，也不会为未核实仓库补造 Star 数。

Commit/Issue 只对 Star≥10 的仓库应用原有3次/仓库/月及10次/人/月限制；PR继续仅使用 `scoring_repositories` 白名单判断，提交20分、合并另加30分。两个条件独立，仓库所有者身份不影响 Star 门槛。每次计分根据当前缓存重新处理完整历史，低 Star 记录保留原始来源并计0分，不占额度。
