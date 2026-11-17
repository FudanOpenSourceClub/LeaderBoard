# 新成员 FAQ

参与步骤见[贡献指南](../CONTRIBUTING.md)，本地配置见 [README](../README.md)。

## 1. 从哪个任务开始，怎样认领？

从[开放的 Issues](https://github.com/FudanOpenSourceClub/LeaderBoard/issues?q=is%3Aissue%20is%3Aopen)选择未分配任务，先阅读目标、依赖和验收条件。README 中的早期任务表用于理解模块划分，不代表当前待办。

单独评论“认领”或 `/claim`；有权限时也可以直接分配给自己。以 Assignees 中是否出现自己的账号为准。机器人未成功时请维护者处理；退出任务可评论“取消认领”或 `/unclaim`。

## 2. 没有写权限，为什么不能 push？

Read / Triage 权限不包含向上游推送代码的权限。使用个人 fork，在自己的任务分支开发，再向上游 `main` 提 PR。具体命令见[贡献指南](../CONTRIBUTING.md)。

已有仓库先执行 `git remote -v`：remote 名称可以不同，关键是推送地址应指向个人 fork。不要为解决权限问题直接覆盖已有远程配置。

## 3. 没有生产配置，可以做什么？

Node.js 24.x、npm 11 或以上即可在根目录执行：

```bash
npm ci
npm run typecheck
npm test
npm run build
```

这些检查不需要生产凭据，普通单元测试不连接数据库。数据库测试和完整网页联调需要额外的开发配置；不必获取生产服务器权限才能参与文档或代码修改。

## 4. 提示 `.env: not found` 怎么办？

确认当前目录是项目根目录。若没有 `.env`，复制 `.env.example` 并改名为 `.env`；不要覆盖已有文件。复制后仍需填写自己的开发配置，不会自动获得生产连接信息。

运行某个脚本前，确认它实际存在于当前分支，并检查其环境要求。不要把密码、Token 或真实 `.env` 提交到 Git。

## 5. `/health` 正常，为什么进不了页面？

`/health` 只确认后端进程可响应。当前业务页面需要登录：

- `401 LOGIN_REQUIRED`：请求没有有效的网站登录会话。
- `503 LOGIN_UNAVAILABLE`：GitHub OAuth 登录尚未配置。
- `401 REGISTRATION_REQUIRED`：当前本地库中没有符合条件的注册记录，需先访问 `/join` 注册；网站角色也会影响准入。

OAuth 登录、邮箱验证和数据采集是不同配置。占位 Token 不提供登录能力，线上账号也不会自动出现在本地空库中。按 README 配置开发用 OAuth App、数据库及注册所需邮件服务。

## 6. 开启 mock 能跳过登录吗？

不能。`VITE_LEADBOARD_API_MODE=mock` 仅切换部分统计请求的数据源，网站会话仍由后端提供，项目和注册等页面也有真实接口请求。它不是免登录演示模式；没有联调配置时，可先做类型检查、单元测试和构建。

## 7. OAuth 回调后页面不对，怎么检查？

通过 `http://localhost:5173` 开发时，OAuth App 和 `.env` 中的回调应一致设为 `http://localhost:5173/api/v1/auth/github/callback`。Vite 代理到后端后，回调中的相对跳转会回到前端站点。

`.env.example` 默认是后端端口 `3000`，前后端分开启动时需要调整。不要混用 `localhost` 与 `127.0.0.1`；改用构建预览端口时也要同步修改回调并重启。

## 8. 安装或数据库启动失败，先检查什么？

| 情况 | 检查方法 |
| --- | --- |
| 找不到 `node` / `npm` | 安装 Node.js 24 后重新打开终端，运行 `node -v`、`npm -v`。 |
| Windows 禁止运行 `npm.ps1` | 在编辑器中新建 Command Prompt 终端后重试。 |
| 找不到 `package.json` | 切换到包含根目录 `package.json` 的项目文件夹。 |
| 找不到 `lint` 脚本 | 根目录没有该脚本，使用已提供的 typecheck、test、build。 |
| `EADDRINUSE` | 检查是否重复启动服务；默认前端 5173、后端 3000。 |
| 无法访问 Docker | 确认 Docker 已启动且当前终端有访问权限。 |
| PostgreSQL 连接失败 | 检查数据库是否启动、5432 是否被占用、`DATABASE_URL` 是否指向本地库。 |
| 数据库表不存在 | 先对开发库运行 `npm run db:migrate` 和 `npm run db:verify`。 |

求助时附执行命令、运行目录、版本和脱敏报错，不要只写“启动不了”。

## 9. 文档 PR 也需要 Issue 和模板吗？

需要。当前 [PR Policy](../.github/workflows/pr-policy.yml) 要求 PR 指向 `main`，用 `Closes #编号`（也接受 Fixes / Resolves）关联 open 的任务 Issue；普通贡献者必须是该 Issue 的 Assignee。任务需写明开发语言、使用接口、实现接口和最终产物。

保留 [PR 模板](../.github/pull_request_template.md)各章节，接口不适用时直接说明，填写实际验证证据，至少勾选一项已完成的检查。仅完成大任务的一部分时，拆出独立 Issue，将大任务作为补充关联，避免误关闭它。

## 10. CI 通过就代表线上已经修好了吗？

还需评审、合并、部署，并核对线上行为。`check:phase1` 只检查入口是否齐全，不证明实际同步成功。

`test:bootstrap` 是早期进程冒烟脚本，仍断言匿名访问不存在的 API 返回 404；当前鉴权会先返回 401，可能因此失败。现有 CI 在检测到同步模块后跳过该脚本。若遇到这个差异，应记录命令和报错，按当前业务测试验收；不要为了让旧断言通过而取消鉴权。
