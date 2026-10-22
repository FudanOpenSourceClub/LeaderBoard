# Phase 1 Architecture

## 1. 目标

Phase 1 只建立一个可验证、可多人并行开发的 MVP 数据闭环：

```text
GitHub Organization
        │
        ▼
Repository Sync
        │ RepositorySyncResult
        ▼
applyRepositoryScope()
        │ TrackedRepository[]
        ▼
GitHub Collectors
        │ GitHubActivity[]
        ▼
ingestActivities()
        │ PostgreSQL facts
        ▼
Analytics Services
        │ shared response types
        ▼
REST API
        │ JSON
        ▼
React Dashboard
```

所有模块通过 `packages/contracts` 中的共享类型耦合，而不是通过“约定俗成”的 JSON。

## 2. Monorepo 规划

```text
LeaderBoard/
├── backend/
│   └── src/
│       ├── config/
│       ├── github/
│       ├── repositories/
│       ├── collectors/
│       ├── ingestion/
│       ├── sync/
│       ├── analytics/
│       ├── api/
│       └── db/
├── frontend/
├── packages/
│   └── contracts/
├── db/
│   └── migrations/
├── docs/
├── .github/
├── docker-compose.yml
└── package.json
```

根目录使用 npm workspaces。

## 3. 技术栈

- Node.js 24 LTS
- TypeScript
- npm workspaces
- Express
- React + Vite
- PostgreSQL
- `pg`
- `node-pg-migrate`
- Zod
- Vitest
- Docker Compose
- GitHub REST + GraphQL API
- 定时调度：`node-cron` 或同级轻量 cron 库

## 4. Contract-first 原则

跨模块共享的数据结构只允许定义一次：

```text
docs/api-contract.md
        ↓
packages/contracts
        ↓
Backend / Frontend import
```

禁止：

- Collector 自己定义一份 Activity；
- Ingestion 再定义另一份 Activity；
- Frontend 手抄后端 Response Type；
- API controller 返回文档中不存在的临时字段。

## 5. A. Config / Bootstrap

职责：

- 建 npm workspaces；
- 初始化 Backend / Frontend / contracts package；
- 加载 typed config；
- 提供 `GET /health`；
- 提供 PostgreSQL 本地容器；
- 提供统一 build / test / typecheck 脚本。

输入：环境变量。

输出：

- `AppConfig`
- 可运行 workspace
- `@leadboard/contracts`

## 6. B. Repository Sync

职责：

- 完整分页读取 Organization repositories；
- 读取 `leadboard_group`；
- 筛掉 untracked / missing property / Fork / Private；
- 使用 GitHub repository ID 保持 rename 稳定；
- 输出完整的 `RepositorySyncResult`。

**Repository Sync 不直接写数据库。**

之后由 Ingestion 的 `applyRepositoryScope()` 在一个数据库事务里：

- upsert 当前 tracked repo；
- 更新 group；
- 将上一轮 tracked 但本轮缺失的 repo 标记为 untracked。

因此 Repository Sync 失败时，不会误把大量仓库标记为 untracked。

## 7. C. GitHub Client

统一 GitHub 访问层。

职责：

- Token 鉴权；
- REST pagination；
- Rate Limit；
- Retry；
- REST / GraphQL primitive；
- Secret-safe error。

GraphQL cursor loop 由业务 Collector 完成。

## 8. D. Collectors

三个独立 Collector：

- Commit Collector
- Pull Request Collector
- Issue Collector

输入统一：

```text
TrackedRepository + CollectRange
```

输出统一为 `GitHubActivity` discriminated union。

这样 Ingestion 只需要根据 `kind` 分发，不依赖 GitHub 原始 JSON。

## 9. E. Ingestion / Storage

拆成两个入口：

```text
applyRepositoryScope(scope)
ingestActivities(activities)
```

这样解决两个不同语义：

- Repository 是“当前 scope”
- Activity 是“历史 fact”

职责：

- Zod runtime validation；
- group / repository / contributor upsert；
- Bot 标记；
- stable ID 归并；
- activity 幂等；
- transaction。

## 10. F. Sync Orchestrator

一次 sync：

```text
create sync_run(status=running)
        ↓
Repository Sync
        ↓
applyRepositoryScope
        ↓
for each tracked repository
   ├─ collect commits
   ├─ collect PRs
   ├─ collect issues
   └─ ingest activities
        ↓
finish sync_run
```

Repository scope 失败：

```text
整个 run failed
不修改 tracked scope
```

单仓库 activity 失败：

```text
记录该 repo 失败
其他 repo 继续
部分仓库失败：最终 run = partial
全部仓库失败：最终 run = failed
```

### 增量窗口

所有窗口：`[from,to)`。

默认：

- 第一次：最近 `INITIAL_SYNC_DAYS=30`；
- 后续：从最近成功 `range_to` 向前 overlap `SYNC_OVERLAP_MINUTES=10`；
- overlap 产生的重复由幂等 upsert 消除。

## 11. G. Analytics

Analytics 只读数据库，不访问 GitHub。

负责：

- Organization summary
- Repository stats
- Group list
- Contributor leaderboard
- Contributor detail

Phase 1：

```text
total = commits + prs + issues
```

不加权。

Repository / Organization activity 包含 Bot 和 unknown contributor activity；Contributor Leaderboard 排除 Bot。

## 12. H. REST API

API controller 只负责：

- 参数解析；
- 参数校验；
- 调用 service；
- HTTP status；
- 序列化 shared response type。

不允许直接写 SQL 或重新计算排行榜。

## 13. I. Frontend

Frontend 从 `@leadboard/contracts` 导入 API response types。

页面至少包含：

- Contributor Leaderboard
- Contributor Detail
- Repository Activity
- Group filter
- 7d / 30d / 90d / all
- last sync / freshness

Frontend 不计算 `total`，只展示 Backend 返回的数据。

## 14. Freshness

默认每 6 小时同步一次。

```text
last successful sync == null
→ missing

now - last successful sync > DATA_STALE_AFTER_HOURS (default 12)
→ stale

otherwise
→ fresh
```

## 15. Integration Gates

### Gate 1 — Contracts

所有 workspace 能从同一个 `@leadboard/contracts` 编译。

### Gate 2 — Database

Migration 从空 PostgreSQL 成功执行，重复 activity 不产生重复行。

### Gate 3 — Pipeline

固定 fixture：

```text
RepositorySyncResult
+ GitHubActivity[]
→ DB
→ Analytics
```

结果确定。

### Gate 4 — API Contract

Backend API contract tests 与 shared types / docs 一致。

### Gate 5 — E2E

真实测试 Organization：

```text
GitHub
→ Sync
→ PostgreSQL
→ API
→ Dashboard
```

完整跑通。

## 16. Phase 1 明确排除

- 学生身份认证
- 用户账号认领
- 管理员人工审核
- 外部任意仓库自动发现
- 加权积分
- News feed
- 多学院 / 专业榜
- Redis
- 完整历史回填系统

`range=all` 仅代表数据库已采集的全部历史。
