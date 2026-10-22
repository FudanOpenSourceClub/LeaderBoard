# 2026-09-25 全仓库集成审查

审查基线：`ba29cde`。覆盖全部现有源码、测试、workspace 配置、锁文件结构、Docker 配置、GitHub Actions、接口/数据模型/验收文档及正式任务说明。

## 结论

现有代码是可启动的工程基础，不是已完成的贡献榜单。原始版本通过类型检查、88 项测试和构建，但仍存在跨 Issue 的接入风险。本次修复不代替待认领业务任务，也不能保证尚未编写的实现正确。

## 已修复

| 问题 | 影响 | 修复 |
|---|---|---|
| PR Policy 查找旧 Issue 标题 | 当前模板提交的任务可能无法通过 PR 验收 | 支持当前/旧版完整标题组合，保留认领与其他检查；增加回归测试 |
| Issue 与共享导出名称不一致 | #13–#18 按任务说明 import 会失败 | 补查询/同步类型，增加同 schema 的返回值别名和测试 |
| createApp 的 404 已封住后续路由 | 在返回 app 后追加路由会始终 404 | 增加 apiRouter 注入点，验证真实请求可达及 JSON 错误处理 |
| 独立 DB/集成 CI 未编译 contracts | 干净安装后 dist 导出不存在 | 相关 job 先编译共享包；E2E 先完成完整构建 |
| Live E2E 变量与 #18 命名不一致 | 测试入口可能读不到凭据 | 同时提供应用名和专用测试名，来自相同 Secrets |
| Mock E2E 缺少应用必填配置 | 启动真实后端会在配置检查处退出 | 给 mock job 提供明确的测试占位值 |
| CI 允许业务模块尚未开发时跳过 | 容易把基础 CI 绿色误认为整站完成 | 新增阶段依赖检查和严格完成检查，E2E 出现后强制检查完整入口 |
| 测试未实际验证编译后前后端连接 | 各包单测成功不代表启动和代理正常 | 增加真实进程启动、网页资源、health/API 代理 smoke |

## 后续任务必须衔接的地方

- #3：数据库公共连接与事务工具，固定表/唯一键/索引，根命令读根 .env；普通单元测试不依赖数据库。
- #8：每次写入的事务失败必须上报，不能让同步器误记为成功；同批重放不增加事实行。
- #13：实际 server 启动调度器、提供 sync:once、跨进程锁、关闭调度/连接；明确 running 与公共状态的差别，新仓库初始采集不能漏用初始窗口。
- #15：真实路由挂载、默认参数与 JSON 错误映射，验证通过实际 server 可以请求六个接口。
- #16/#17：共享包导入，模拟和真实数据同一结构，切真实 transport 不改页面字段。
- #18：冻结 mock 时间并验证数字，空库完整链路、重复同步、实际进程/浏览器/详情刷新，以及有授权的真实 GitHub 验收。

这些要求同步补充到对应 Issue，不要求认领者从本报告自行推断接口。

## 验证记录

- 干净 `npm ci`：通过。
- `npm audit --omit=dev --audit-level=high`：通过，0 vulnerabilities。
- 工作流 YAML 解析：通过；本地环境没有 Docker，PostgreSQL 容器启动由 PR 的 GitHub CI 验证。
- `npm run typecheck`：通过。
- `npm test`：93 项通过（contracts 66、backend 22、frontend 5）。
- `npm run test:tooling`：8 项通过。
- `npm run build`：通过。
- `npm run test:bootstrap`：真实启动编译后后端和网页预览，静态 JS、health 代理、API JSON 404 全部通过；不包含浏览器交互。
- `npm run check:integration`：通过，明确列出尚未实现阶段。
- `npm run check:phase1`：按预期失败，列出缺少的数据库、GitHub、仓库筛选、采集、入库、同步、统计、API、E2E 实现。它不是项目完成的证据。
- 修复 PR #26 的 GitHub CI（e18bcce）：[CI 通过](https://github.com/swiftgorge5-eng/LeaderBoard/actions/runs/36103612815)，包括 Docker PostgreSQL 启动与 SQL 连接；[PR Policy 通过](https://github.com/swiftgorge5-eng/LeaderBoard/actions/runs/36103612774)。数据库业务/集成/Pipeline/E2E 仍是未实现阶段，不能据此称业务链路已通过。

## 尚不能证明的部分

没有业务数据库表、采集/统计/API/榜单实现，也没有完整 E2E 或本次真实测试组织凭据。必须等实现后通过数据库集成、Pipeline、Mock E2E 和 Live E2E 才能确认整个榜单跑通。

当前增量窗口只保证已采集事实：旧 PR/Issue 状态的后续更新、早 authored_at 的迟到 Commit、force-push 后撤回都没有完整维护机制。单组织数据库不得混用不同组织快照。若要扩展这些语义，另立任务与测试。

长期公网运行还缺正式部署方案；当前 Compose 仅运行 PostgreSQL，Vite preview 仅供本地预览。
