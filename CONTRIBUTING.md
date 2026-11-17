# Contributing to LeadBoard

LeadBoard 使用 **Issue → Branch → Pull Request → Review → Merge** 的协作流程。

## 1. 认领任务

1. 从[当前开放的 Issues](https://github.com/FudanOpenSourceClub/LeaderBoard/issues?q=is%3Aissue%20is%3Aopen)选择未分配任务；
2. 阅读目标、输入、输出、依赖和验收标准；
3. 单独评论“认领”或 `/claim`，等待机器人处理；有分配权限时，也可直接将 Assignees 设为自己；
4. 确认 Assignees 中出现自己的账号后开始开发。机器人未成功时请维护者分配。

取消认领可单独评论“取消认领”或 `/unclaim`。不要占用已有负责人的任务。

不要同时认领多个半天级任务。

## 2. Fork、克隆与分支

没有上游仓库写权限也可以参与。先在 GitHub 上 fork 本仓库到自己的账号，再克隆个人 fork。以下为 macOS / Linux / Git Bash 示例，先替换账号和分支名；分支中的编号应是已认领的 Issue：

```bash
GITHUB_USER=your-github-username
TASK_BRANCH=docs/123-new-member-guide

git clone "https://github.com/$GITHUB_USER/LeaderBoard.git"
cd LeaderBoard
git remote add upstream https://github.com/FudanOpenSourceClub/LeaderBoard.git
git fetch upstream
git switch -c "$TASK_BRANCH" upstream/main
```

这里 `origin` 指个人 fork，`upstream` 指原仓库。已有本地仓库时先运行 `git status` 和 `git remote -v`，保存现有工作并确认远程地址，再创建新分支；不要覆盖已有 remote。Download ZIP 适合阅读，不包含提交所需的 Git 历史。

分支名使用 `feat/<issue-number>-<short-name>`、`fix/<issue-number>-<short-name>` 或 `docs/<issue-number>-<short-name>`。安装和运行步骤见 [README](README.md)。

完成修改与验证后，只暂存本任务的文件。例如文档任务：

```bash
git status
git diff
git add README.md CONTRIBUTING.md docs/new-member-faq.md
git diff --cached
git commit -m "docs: improve new contributor guide"
git push -u origin HEAD
```

上面的 `git add` 文件列表只是示例，请按实际修改调整。推送的是个人 fork 的任务分支，之后向上游发起 PR；不要直接向上游 `main` 推送。

## 3. 接口优先

跨模块开发必须遵守：

- [docs/api-contract.md](docs/api-contract.md)
- [docs/data-model.md](docs/data-model.md)

如果发现接口需要变化，先在对应 Issue 讨论并更新文档，再修改实现。不要让两个模块各自定义一套字段。

## 4. Pull Request

在 GitHub 选择 **base repository: FudanOpenSourceClub/LeaderBoard，base: main**，**head repository: 个人 fork，compare: 本次任务分支**。先检查 Files changed 只包含本任务内容。

使用[仓库 PR 模板](.github/pull_request_template.md)，保留各章节并填写实际结果。纯文档任务可写“无新增运行时接口”“无业务上游接口”，不能留空；Integration Gate 勾选“仅文档 / 无运行时影响”。

PR 必须包含：

- 解决的问题；
- 主要改动；
- 如何测试；
- 是否修改接口或数据库；
- `Closes #<issue-number>`。

当前 [PR Policy](.github/workflows/pr-policy.yml) 要求关联一个 open 状态、已分配给 PR 作者的任务 Issue，且该 Issue 写明开发语言、使用接口、实现接口和最终产物。纯文档任务也适用，可写开发语言为 Markdown。

如果本次只完成一个大 Issue 的部分工作，先拆出独立任务；`Closes` 指向本次完整交付的任务，大 Issue 用 `Related to #编号` 补充关联，避免提前关闭其他人的工作。仅写 `Refs` 不能通过当前检查。

## 5. 最低验收

提交 PR 前至少保证：

- 能安装依赖；
- 按改动范围运行检查并如实记录；代码改动至少通过 `npm run typecheck`、`npm test`、`npm run build`（根目录没有 `lint` 脚本）；
- 文档改动检查链接、脚本名称和配置说明；无法本地验证的步骤写明条件，不勾选未完成的验证；
- 新增逻辑有基本测试；
- 没有提交 Token、密码、`.env`；
- README / docs 与行为一致。

## 6. Commit 建议

推荐 Conventional Commits：

```text
feat: ...
fix: ...
docs: ...
test: ...
refactor: ...
chore: ...
```

## 7. Issue 粒度

Phase 1 的开发 Issue 原则上控制在 **2–5 小时**，每个 Issue 只交付一个明确产物。若任务明显超过半天，应先拆分。


## 8. Shared Contracts

任何跨模块字段变化都必须先修改：

1. `docs/api-contract.md`
2. `packages/contracts`
3. 对应 contract test

然后再修改 Backend / Frontend 实现。

PR Review 时，如果发现某个模块重新定义了 `TrackedRepository`、`GitHubActivity`、API response type 等共享结构，应要求改为从 `@leadboard/contracts` 导入。

## 9. Integration Checks

涉及跨模块的 PR，至少说明它通过了哪一个 Integration Gate：

- Contracts
- Database
- Pipeline
- API Contract
- E2E

不要通过“前端临时适配字段”或“Ingestion 临时补 GitHub 数据”来掩盖接口不一致。


## 10. Pull Request 验收流程

提交 PR 后，按下面顺序验收：

```text
PR Policy
  ↓
Secret Scan
  ↓
Typecheck / Unit Test / Build
  ↓
Contract / DB / Integration / Pipeline（按模块自动启用）
  ↓
Issue 专项 Acceptance Criteria
  ↓
Maintainer Review
  ↓
Merge
```

详细规则见 [docs/acceptance.md](docs/acceptance.md)。

PR 描述必须提供：

- `Closes #<issue-number>`
- 本 PR 实现的接口
- 本 PR 使用的接口
- 实际运行的验收命令与结果
- Contract / DB 变化说明
- UI 截图（如适用）
- 风险与回滚说明

CI 红色时不要请求 Merge。

## 11. main 分支规则

推荐 Ruleset / Branch Protection 见 [docs/repository-rules.md](docs/repository-rules.md)。

关键 Required Checks：

```text
CI / Acceptance gate
PR Policy / PR metadata and linked issue
```

所有 Review thread 应在 Merge 前 resolved。

新成员常见权限、配置和提交问题见 [FAQ](docs/new-member-faq.md)。
