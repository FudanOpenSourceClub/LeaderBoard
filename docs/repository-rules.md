# Repository Rules / Branch Protection

LeaderBoard 的 CI 和 PR Policy 已经放在仓库中，但 GitHub 的 Ruleset / Branch Protection 属于仓库管理设置，需要 Maintainer 在 GitHub Settings 中启用。

## 推荐 main 规则

目标分支：

```text
main
```

建议开启：

- Require a pull request before merging
- Required approvals: 1
- Dismiss stale pull request approvals when new commits are pushed
- Require review from Code Owners
- Require conversation resolution before merging
- Require status checks to pass before merging
- Require branches to be up to date before merging
- Block force pushes
- Block deletions

Required status checks：

```text
CI / Acceptance gate
PR Policy / PR metadata and linked issue
```

其中 `CI / Acceptance gate` 会汇总适用于当前仓库阶段的：

- Repository policy
- Secret scan
- Node quality
- Shared contracts
- Docker Compose config
- Database migration
- Database integration
- Pipeline fixture
- Mock E2E

未进入对应开发阶段的 Job 会被 skip；对应模块一旦出现，Job 会自动成为实际验收 Gate。

## Merge 权限

建议只允许 Maintainer 合并到 main。

开发者流程：

```text
Issue
→ feature branch
→ Pull Request
→ CI
→ Review
→ Merge
```

不要直接向 main push 功能代码。

## Live E2E

Live GitHub E2E 不应该成为每个普通 PR 的自动检查，因为它需要真实 GitHub Token / Organization，且会访问 GitHub API。

使用：

```text
Actions
→ Live E2E
→ Run workflow
```

并配置 Repository Secrets：

```text
LEADBOARD_E2E_GITHUB_TOKEN
LEADBOARD_E2E_GITHUB_ORG
```

只使用专用测试 Organization，Token 使用最小只读权限。

## CODEOWNERS

仓库已配置 `.github/CODEOWNERS`。

Contract、Database Model、Migration、Acceptance、CI 等关键文件都会自动要求 Maintainer 关注。启用 “Require review from Code Owners” 后才能形成强制 Gate。
