# LeaderBoard Phase 1 — 验收规范

> 本文定义“一个 Issue / PR 到底什么时候算完成”。  
> Issue 中的验收标准是任务级要求；本文是全项目统一的验收底线。二者同时满足，才允许 Merge。

## 1. 验收原则

LeaderBoard 采用 **Contract First + Automated Gates + Maintainer Review + Integration Evidence**。

任何 PR 都必须证明四件事：

1. **接口正确**：实现了 Issue 顶部声明的接口，并且只消费声明的上游接口；
2. **行为正确**：功能、异常路径、边界条件有测试；
3. **可集成**：输出可以被下游直接消费，不需要临时字段适配；
4. **可重复**：从干净环境安装、构建、测试，结果可复现。

“本地能跑一次”不等于验收通过。

---

## 2. Merge Gate 总览

PR 合并前至少满足：

| Gate | 内容 | 自动/人工 |
|---|---|---|
| G0 | PR 正确关联 Issue，Issue 已声明语言/实现接口/使用接口 | 自动 |
| G1 | Secret Scan | 自动 |
| G2 | install / typecheck / test / build | 自动 |
| G3 | Shared Contract 验证 | 自动 |
| G4 | Docker / Migration / Integration / Pipeline（按改动触发） | 自动 |
| G5 | Issue 专项验收标准 | 自动测试 + 人工核对 |
| G6 | 接口边界 / 架构 Review | 人工 |
| G7 | E2E（Phase 1 最终集成） | 自动 Mock + Live Smoke Test |

CI 中未达到对应阶段的能力会显示为 skipped；一旦相关目录/模块出现，对应 Gate 自动变成强制执行。

---

## 3. PR 必须提供的验收证据

PR 描述必须包含：

- 关联 Issue：使用 `Closes #<number>`；
- 本 PR 实现的接口；
- 本 PR 使用的上游接口；
- 执行过的测试命令及结果；
- 新增/修改的测试；
- 如果修改 Contract / Database，说明兼容性影响；
- UI 任务提供截图或录屏；
- E2E / Database 任务提供关键结果，不得提供 Token。

推荐证据格式：

```text
npm ci                         PASS
npm run typecheck              PASS
npm test                       PASS (42 tests)
npm run build                  PASS
npm run test:integration       PASS (8 tests)
```

只写“已测试”不算有效证据。

---

## 4. CI 标准命令

当根目录 `package.json` 出现后，以下脚本是项目级固定接口：

```text
npm run typecheck
npm test
npm run build
```

当对应模块出现后，还必须提供：

```text
npm run db:migrate
npm run db:verify
npm run test:integration
npm run test:pipeline
npm run test:e2e
npm run test:e2e:live
```

含义：

| Script | 责任 |
|---|---|
| `typecheck` | 所有 workspace TypeScript 类型检查 |
| `test` | 单元测试 |
| `build` | 所有可构建 workspace |
| `db:migrate` | 从当前 schema 状态执行 migration |
| `db:verify` | 验证关键表、列、FK、UNIQUE、Index |
| `test:integration` | Repository scope / Ingestion + PostgreSQL |
| `test:pipeline` | Fixture → DB → Analytics |
| `test:e2e` | 使用 Mock GitHub 的完整本地链路 |
| `test:e2e:live` | 使用专用测试 GitHub Organization 的真实链路 |

CI 不接受“只有开发者电脑上的自定义命令”。

---

## 5. Contract Gate

`docs/api-contract.md` 是文字规范，`@leadboard/contracts` 是代码规范。

两者必须同步。

`packages/contracts` 至少必须：

- 有自己的 `package.json`，name 为 `@leadboard/contracts`；
- 导出共享 TypeScript types；
- 对外部输入/HTTP response 等边界提供 Zod schema；
- 有 `typecheck`、`test`、`build`；
- Backend / Frontend 均直接依赖该 workspace package。

禁止在 Backend、Frontend、Collector、Ingestion 中复制一份“几乎相同”的共享 DTO。

Contract 修改 PR 必须同时：

1. 更新 `docs/api-contract.md`；
2. 更新 `packages/contracts`；
3. 更新 contract tests；
4. 标注受影响的下游 Issue / 模块。

---

## 6. Database Gate

只要 `db/migrations/` 出现真实 migration，CI 就必须：

1. 启动干净 PostgreSQL；
2. 执行 `npm run db:migrate`；
3. 再执行一次 `npm run db:migrate`，确认无异常重复应用；
4. 执行 `npm run db:verify`。

`db:verify` 至少验证：

- groups / repositories / contributors / commits / pull_requests / issues / sync_runs 存在；
- PK / FK 存在；
- Commit / PR / Issue 的唯一约束存在；
- sync_runs 的 trigger / range_from / range_to / status 存在；
- 关键时间查询索引存在。

Migration PR 不允许只提交 SQL 而没有验证。

---

## 7. Integration Gate

当 `backend/src/ingestion/` 出现后，必须提供 `test:integration`。

Integration Test 至少覆盖：

- `applyRepositoryScope()` 完整 scope 写入；
- tracked → untracked；
- repository rename 仍然保持同一 github_id；
- Commit / PR / Issue 重放两次不增加事实行数；
- contributor githubId stable、login 可更新；
- Bot 被标记但 activity 仍保存；
- unknown actor Commit 仍保存；
- transaction 失败不会留下半写入状态。

---

## 8. Pipeline Gate

跨模块测试的标准数据集见 [test-fixtures.md](test-fixtures.md)。#8 / #14 / #18 应优先复用该语义 fixture，并冻结 `REFERENCE_NOW`，避免各模块各写一套无法对账的数据。



当 `backend/src/analytics/` 出现后，必须提供 `test:pipeline`。

使用固定 fixture：

```text
RepositorySyncResult
+ CommitActivity[]
+ PullRequestActivity[]
+ IssueActivity[]
        ↓
applyRepositoryScope / ingestActivities
        ↓
PostgreSQL
        ↓
Analytics
```

必须用断言验证：

- organization totals；
- repository totals；
- contributor totals；
- Bot / unknown 的统计口径；
- group filter；
- tracked=false repository 不进入当前统计；
- `7d / 30d / 90d / all`；
- leaderboard 同分稳定排序。

不能只 snapshot “有 JSON 输出”；必须断言关键数字。

---

## 9. API Contract Gate

所有 HTTP endpoint 必须：

- 输入参数经过校验；
- 输出符合 `@leadboard/contracts`；
- 错误符合 `ApiErrorResponse`；
- Controller 不直接写 SQL；
- Controller 不重算 rank / total；
- Organization Summary 的 activity 数据来自 Analytics，freshness 来自 SyncStatus。

至少覆盖：

```text
GET /health
GET /api/v1/organization/summary
GET /api/v1/organization/repositories
GET /api/v1/groups
GET /api/v1/contributors/leaderboard
GET /api/v1/contributors/:username
GET /api/v1/sync/status
```

并测试 invalid range / metric / limit 与 contributor 404。

---

## 10. Frontend Gate

Frontend 必须：

- 从 `@leadboard/contracts` 导入共享 response types；
- 不重新计算 total / rank；
- Mock API 与真实 API 使用同一 schema；
- 对 loading / empty / error 都有可见状态；
- Query state 与实际请求一致；
- 基本键盘可操作；
- 移动端不出现阻断使用的布局问题。

UI PR 需要提供截图或录屏。

---

## 11. Security Gate

所有 PR 都执行 Secret Scan。

同时人工检查：

- 不提交 `.env`；
- 不打印 GitHub Token；
- Error / log 不包含 Authorization header；
- 测试 fixture 不使用真实 secret；
- Live E2E Token 只能存 GitHub Actions Secret；
- PR 评论和 CI log 不输出 secret。

生产依赖存在时，CI 执行：

```text
npm audit --omit=dev --audit-level=high
```

高危/严重生产依赖漏洞必须处理或在 PR 中给出明确的临时豁免理由。

---

## 12. 各 Issue 专项验收

### #2 Bootstrap

必须证明：

- Node.js 24 LTS；
- 根目录 npm workspaces；
- `backend` / `frontend` / `packages/contracts`；
- 根目录有 lockfile；
- root `typecheck/test/build`；
- contracts workspace 的 `typecheck/test/build`；
- Backend / Frontend 能 import `@leadboard/contracts`；
- `GET /health=200`；
- Docker Compose PostgreSQL 配置有效。

### #3 Database

必须证明：

- 空库 migration 成功；
- 第二次 migration 无异常；
- `db:verify` 通过；
- constraints / indexes 与 data-model 一致；
- DB helper 可被 #8/#14 复用；
- transaction helper 有测试。

### #4 GitHub Client

至少 Mock：

- Authorization 注入；
- Secret redaction；
- REST 多页；
- GraphQL request primitive；
- Rate Limit；
- secondary throttling；
- 可重试 5xx；
- 不可重试 4xx；
- retry 达到上限后正确失败。

### #5 Repository Sync

Fixture 至少包含：

- tracked；
- untracked；
- missing property；
- fork；
- private；
- archived tracked repo；
- renamed repo stable ID；
- 多页仓库。

还必须模拟中途 API 失败，确认不会产生“部分成功 scope”。

### #6 Commit Collector

至少覆盖：

- 默认分支；
- 空仓库；
- GraphQL 多页；
- `from` inclusive；
- `to` exclusive；
- actor user；
- actor unknown；
- merge；
- additions/deletions；
- 输出通过 CommitActivity schema。

### #7 PR / Issue Collector

至少覆盖：

- REST 多页；
- open PR；
- closed-not-merged PR；
- merged PR；
- open / closed Issue；
- Issue endpoint 中 PR 被过滤；
- actor user / bot；
- `[from,to)`；
- 输出通过 schema。

### #8 Ingestion

必须在真实 PostgreSQL Integration Test 中证明：

- scope upsert；
- rename；
- untrack；
- contributor stable ID；
- Bot；
- unknown actor；
- 三类 activity；
- 同批数据执行两遍不增加事实行；
- 失败 transaction rollback。

### #13 Sync

必须验证：

- 首次使用 INITIAL_SYNC_DAYS；
- 后续从 last successful rangeTo 增量同步；
- overlap；
- overlap 不重复；
- scope failure → run failed 且 scope 不变；
- 单 repo failure → partial；
- 并发 run 被拒绝；
- missing/stale/fresh；
- sync_runs 状态完整。

### #14 Analytics

使用确定 fixture 精确断言：

- organization；
- repository；
- contributor；
- Bot；
- unknown actor；
- group filter；
- tracked=false；
- range；
- all；
- 同分排序。

### #15 REST API

Contract Test 覆盖全部 endpoint、参数与错误格式。

特别验证：

```text
organization summary
= analytics activity
+ sync freshness
```

Frontend fixture 不修改字段即可切到真实 API。

### #16 Frontend Skeleton

必须证明：

- 所有 API DTO 来自 contracts；
- Mock adapter 与真实 transport 同 interface；
- range / group state 可复用；
- loading/error/empty 基础组件可复用；
- Backend 尚未完成时仍能用 schema-valid fixture 开发。

### #17 Contributor UI

必须证明：

- range / metric / group 会产生正确请求；
- rank / total 直接使用 API；
- detail route；
- contributor 404；
- loading / empty / error；
- 响应式基本可用。

### #18 E2E

这是 Phase 1 最终 Gate。

必须完成两类 E2E：

**Mock E2E（每个 PR 可自动跑）**

```text
Mock GitHub
→ Repository Sync
→ Collectors
→ PostgreSQL
→ Analytics
→ REST API
→ Frontend smoke
```

**Live E2E（维护者手动触发）**

使用专用测试 Organization：

```text
Real GitHub
→ Sync
→ PostgreSQL
→ API
→ Dashboard
```

Live E2E 至少记录：

- 测试时间窗口；
- tracked repo 数；
- Commit / PR / Issue 关键计数；
- leaderboard 示例；
- freshness；
- 第二次 overlap sync 前后事实表行数；
- 页面截图；
- 已知限制。

禁止记录 Token。

---

## 13. Review Checklist

Maintainer Review 重点不是重复跑全部测试，而是检查自动化测试无法证明的架构边界：

- 实现接口是否和 Issue 顶部一致；
- 使用接口是否和 Issue 顶部一致；
- 是否私自修改 shared contract；
- 是否越层访问（例如 Frontend 计算统计、Collector 写 DB、Ingestion 重新请求 GitHub）；
- 是否出现重复业务口径；
- 错误路径是否被吞掉；
- 测试是否真正验证行为，而不是只追求 coverage；
- 数据库 migration 是否可长期维护；
- UI 是否符合 API 语义。

---

## 14. Merge 规则

允许 Merge：

```text
PR Policy PASS
+ CI Acceptance Gate PASS
+ Issue Acceptance Criteria 完成
+ Maintainer Review 通过
+ Review threads resolved
```

不得因为“赶进度”跳过红色 CI。

紧急修复如果确需临时绕过某一非安全 Gate，必须：

1. 在 PR 说明原因；
2. 创建 follow-up Issue；
3. 不得绕过 Secret Scan、Contract Compatibility、数据破坏风险检查。

---

## 15. Live E2E Secrets

Live E2E Workflow 使用两个 Repository Secrets：

```text
LEADBOARD_E2E_GITHUB_TOKEN
LEADBOARD_E2E_GITHUB_ORG
```

Token 只授予测试 Organization / 测试仓库所需的最小只读权限。

Live E2E 不使用开发者个人 Token。


## 16. Dependabot PR 例外

自动生成的 `dependabot[bot]` PR 不要求创建独立开发 Issue，也不要求填写人工接口元数据，因此 PR Policy 对 Dependabot 跳过 linked-Issue 检查。

但 Dependabot **不跳过 CI**：

- Secret Scan
- build / typecheck / tests
- Contract / Database / Integration / Pipeline / E2E（如适用）
- Maintainer Review

依赖升级如果导致任何 Acceptance Gate 失败，不得直接 Merge。

## 17. 运行接入与最终完成检查

新增命令：

| 命令 | 当前用途 |
|---|---|
| `npm run check:integration` | 检查已出现模块的依赖和必需命令；允许尚未开发的阶段缺席 |
| `npm run check:phase1` | 强制检查所有后端阶段和 E2E 入口；业务未完成时应失败 |
| `npm run test:tooling` | 回归验证集成检查和 PR 元数据规则 |
| `npm run test:bootstrap` | 构建后真实启动基础后端与网页预览，验证资源和代理；不等于业务 E2E |

`check:phase1` 只检查入口完整性，不能代替业务测试。普通 CI 绿色也不表示 Phase 1 已全部完成。

#13 必须交付 `npm run sync:once` 并接入后端进程的定时任务和退出清理；手动和定时同步跨进程共用数据库锁。#15 必须把路由接入 `createApp({ apiRouter })` 和实际 server 入口。#18 必须验证实际进程和浏览器页面，接手带数据库/调度器的运行测试；基础 smoke 在 sync 模块出现后不再于无数据库的 Node quality job 执行。

最终验收顺序：

```text
npm ci
npm run check:phase1
npm run typecheck
npm test
npm run build
npm run db:migrate
npm run db:verify
npm run test:integration
npm run test:pipeline
npm run test:e2e
```

上述数据库命令使用专用测试数据库。最后还要执行有真实测试组织授权的 `npm run test:e2e:live`，记录实际结果；没有授权时标记“未验证”，不能以 mock 代替。

所有数据库、Pipeline、E2E 测试与 `npm test` 的无数据库单元测试分开：单元测试不得因为本机没有 PostgreSQL 而失败。CI 中数据库相关 job 先编译 contracts，Mock/Live E2E 先完成全项目构建。E2E 若使用浏览器自动化，由 #18 在工作流中明确安装所需浏览器和系统依赖。

Live E2E 同时提供测试入口使用的 `LEADBOARD_E2E_GITHUB_TOKEN` / `LEADBOARD_E2E_GITHUB_ORG` 与应用使用的 `GITHUB_TOKEN` / `GITHUB_ORG`，值来自相同的专用 Secrets。

Phase 1 的功能验收不等于公网生产部署验收。当前 Compose 只包含数据库。长期运行还需要正式应用运行配置、HTTPS/域名或校内访问入口、进程重启策略、备份与恢复演练；不使用 Vite preview 作为生产服务器。
