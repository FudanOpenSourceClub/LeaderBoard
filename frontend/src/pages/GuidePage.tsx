import { COMPETITION_PERIOD } from "@leadboard/contracts";
import { Link } from "react-router";

export function GuidePage() {
  return (
    <div className="page-canvas">
      <section className="page-hero">
        <div>
          <h1>新手指南</h1>
          <p className="filter-caption">找到想参与的开源项目，开始第一次贡献。</p>
        </div>
      </section>

      <div className="dashboard-content guide-sections">
        <section className="panel guide-panel" aria-labelledby="guide-getting-started">
          <div className="panel-heading"><h2 id="guide-getting-started">开始使用 LeaderBoard</h2></div>
          <ol>
            <li>已有账号可以使用 GitHub 登录。首次使用请前往注册页，先授权 GitHub，再验证复旦邮箱并绑定身份。</li>
            <li>在项目页面按方向和来源查找仓库。收藏会保存在当前浏览器里，方便之后继续查看。</li>
            <li>登录后可以在达人榜查看自己的档案。注册成员也可以提交复旦项目提议，审核通过后加入复旦目录。</li>
          </ol>
          <div className="profile-actions">
            <Link className="primary-button" to="/join">注册并加入达人榜</Link>
            <Link className="profile-action-link" to="/projects">浏览开源项目</Link>
          </div>
        </section>

        <section className="panel guide-panel" aria-labelledby="guide-first-contribution">
          <div className="panel-heading"><h2 id="guide-first-contribution">完成第一次贡献</h2></div>
          <ol>
            <li>打开仓库的 README、贡献指南和 Issues，找一项可以独立验证的文档、示例、测试或代码改动。</li>
            <li>查看 issue 的讨论和关联 PR，按项目约定和维护者沟通。Fork 仓库，在本地新建分支，完成改动和验证。</li>
            <li>把分支推到自己的 Fork，向原仓库提交 PR，写清楚改了什么、如何复现或测试。</li>
          </ol>
        </section>

        <section className="panel guide-panel" aria-labelledby="guide-stats">
          <div className="panel-heading"><h2 id="guide-stats">了解贡献统计</h2></div>
          <p>贡献记录来自 LeaderBoard 已采集的 GitHub 数据。切换时间或分组会改变统计范围，比赛周期为 {COMPETITION_PERIOD.label}（北京时间）。</p>
          <p>个人档案分别展示 Commit、PR、Issue 和积分。PR 计分取决于仓库是否在积分白名单中，项目推荐和复旦目录用于发现仓库。新活动在同步后才会显示。</p>
          <Link className="profile-action-link" to="/contributors">前往达人榜查看积分规则</Link>
        </section>
      </div>
    </div>
  );
}
