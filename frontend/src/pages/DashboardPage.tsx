import { useEffect, useState } from "react";
import {
  TimeRangeSchema,
  type ContributorLeaderboardResponse,
  type GroupsResponse,
  type OrganizationSummaryResponse,
  type RepositoryStatsResponse,
  type SyncStatus,
} from "@leadboard/contracts";
import { Link } from "react-router";
import type { LeadBoardApiClient } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncStates";
import { useFilters } from "../state/filters";

interface DashboardData {
  summary: OrganizationSummaryResponse;
  repositories: RepositoryStatsResponse;
  leaderboard: ContributorLeaderboardResponse;
  sync: SyncStatus;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DashboardData };

function freshnessLabel(status: SyncStatus["dataStatus"]): string {
  return status === "fresh" ? "数据已更新" : status === "stale" ? "数据可能过期" : "等待首次同步";
}

function ActivityBars({ commits, prs, issues }: { commits: number; prs: number; issues: number }) {
  const max = Math.max(commits, prs, issues, 1);
  return (
    <span className="activity-bars" aria-label={`Commit ${commits}，PR ${prs}，Issue ${issues}`}>
      {[commits, prs, issues].map((value, index) => (
        <span key={index} style={{ height: `${Math.max(18, Math.round((value / max) * 100))}%` }} />
      ))}
    </span>
  );
}

export function DashboardPage({ api, isMock = false }: { api: LeadBoardApiClient; isMock?: boolean }) {
  const { range, setRange, group, setGroup, metric } = useFilters();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [availableGroups, setAvailableGroups] = useState<GroupsResponse["items"]>([]);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoad({ status: "loading" });
    void Promise.all([
      api.getOrganizationSummary(range),
      api.getRepositories(range, group),
      api.getGroups(),
      api.getContributorLeaderboard({ range, metric, ...(group === undefined ? {} : { group }), limit: 8 }),
      api.getSyncStatus(),
    ]).then(
      ([summary, repositories, groups, leaderboard, sync]) => {
        if (active) {
          setAvailableGroups(groups.items);
          setLoad({ status: "ready", data: { summary, repositories, leaderboard, sync } });
        }
      },
      (error: unknown) => {
        if (active) setLoad({ status: "error", message: error instanceof Error ? error.message : "数据加载失败" });
      },
    );
    return () => { active = false; };
  }, [api, range, group, metric, retry]);

  return (
    <div className="page-canvas">
      <section className="hero-card" aria-labelledby="dashboard-title">
        <div className="hero-copy">
          <span className="hero-badge">FUDAN · OPEN SOURCE</span>
          <h1 id="dashboard-title">看见每一份<br /><span>微小的努力。</span></h1>
          <p>把分散在 GitHub 仓库里的贡献整理成清晰、持续更新的社区画像。</p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/contributors">查看贡献者榜单</Link>
            <Link className="button button-secondary" to="/join">加入达人榜</Link>
          </div>
          {isMock && <p className="demo-notice" role="status">当前展示模拟数据，不代表真实 GitHub 活动。</p>}
        </div>
      </section>

      <section className="filter-card" aria-label="Dashboard 筛选">
        <div>
          <span className="filter-title">数据范围</span>
          <span className="filter-caption">切换时间与仓库分组，所有模块同步更新</span>
        </div>
        <div className="filter-controls">
          <label>时间范围
            <select value={range} onChange={(event) => setRange(TimeRangeSchema.parse(event.target.value))}>
              <option value="7d">最近 7 天</option>
              <option value="30d">最近 30 天</option>
              <option value="90d">最近 90 天</option>
              <option value="all">全部历史</option>
            </select>
          </label>
          <label>分组
            <select value={group ?? ""} onChange={(event) => setGroup(event.target.value || undefined)}>
              <option value="">全部分组</option>
              {availableGroups.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="dashboard-content" aria-label="Dashboard 内容">
        {load.status === "loading" && <LoadingState />}
        {load.status === "error" && <ErrorState message={load.message} onRetry={() => setRetry((value) => value + 1)} />}
        {load.status === "ready" && (
          <>
            <div className="sync-row" data-status={load.data.sync.dataStatus}>
              <span className="sync-main"><span className="freshness-dot" aria-hidden="true" />{freshnessLabel(load.data.sync.dataStatus)}</span>
              <span>最后同步 {load.data.sync.lastSuccessfulRunAt
                ? new Date(load.data.sync.lastSuccessfulRunAt).toLocaleString()
                : "—"}</span>
            </div>

            <div className="section-title-row">
              <div>
                <p className="section-kicker">贡献者数据</p>
                <h2>组织活动概览</h2>
                <p>用最直接的数字，看见社区在这段时间发生了什么。</p>
              </div>
            </div>

            {load.data.summary.repositories === 0 && load.data.summary.total === 0 ? (
              <EmptyState />
            ) : (
              <div className="metric-grid">
                <article className="metric-card metric-purple"><span>贡献者</span><strong>{load.data.summary.contributors}</strong><small>活跃开发者</small></article>
                <article className="metric-card metric-indigo"><span>Commit</span><strong>{load.data.summary.commits}</strong><small>代码提交</small></article>
                <article className="metric-card metric-blue"><span>Pull Request</span><strong>{load.data.summary.prs}</strong><small>协作变更</small></article>
                <article className="metric-card metric-mint"><span>总活动</span><strong>{load.data.summary.total}</strong><small>{load.data.summary.repositories} 个 tracked 仓库</small></article>
              </div>
            )}

            <div className="dashboard-grid">
              <section className="panel contributor-panel">
                <div className="panel-heading">
                  <div><p className="section-kicker">本期活跃</p><h2>贡献者榜单</h2></div>
                  <Link to="/contributors">查看完整榜单 →</Link>
                </div>
                {load.data.leaderboard.items.length === 0 ? <EmptyState label="当前筛选下暂无贡献者活动" /> : (
                  <div className="mini-leaderboard">
                    {load.data.leaderboard.items.slice(0, 6).map((item) => (
                      <Link className="leader-row" key={item.login} to={`/contributors/${encodeURIComponent(item.login)}`}>
                        <span className={`rank-badge rank-${Math.min(item.rank, 4)}`}>{item.rank}</span>
                        {item.avatarUrl
                          ? <img className="avatar avatar-lg" src={item.avatarUrl} alt="" />
                          : <span className="avatar avatar-lg avatar-placeholder" aria-hidden="true">{item.login.slice(0, 1).toUpperCase()}</span>}
                        <span className="leader-person"><strong>{item.login}</strong><small>{item.commits} commits · {item.prs} PR · {item.issues} issues</small></span>
                        <ActivityBars commits={item.commits} prs={item.prs} issues={item.issues} />
                        <span className="leader-score"><strong>{item.total}</strong><small>活动</small></span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel insight-panel">
                <div className="panel-heading">
                  <div><p className="section-kicker">社区脉搏</p><h2>这段时间发生了什么</h2></div>
                </div>
                <div className="insight-list">
                  <div><span className="insight-icon">↗</span><div><strong>{load.data.summary.commits}</strong><p>次代码提交留下了可追踪的贡献记录。</p></div></div>
                  <div><span className="insight-icon">◎</span><div><strong>{load.data.summary.prs}</strong><p>个 Pull Request 参与了协作与代码审阅。</p></div></div>
                  <div><span className="insight-icon">#</span><div><strong>{load.data.summary.issues}</strong><p>个 Issue 记录需求、问题与讨论。</p></div></div>
                </div>
                <Link className="soft-cta" to="/join">验证复旦身份，加入达人榜 <span>→</span></Link>
              </section>
            </div>

            <section className="panel repository-panel">
              <div className="panel-heading">
                <div><p className="section-kicker">仓库活动</p><h2>项目贡献分布</h2><p>当前分组中的仓库活动概览。</p></div>
              </div>
              {load.data.repositories.items.length === 0 ? <EmptyState label="当前分组暂无仓库活动" /> : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>仓库</th><th>分组</th><th>Commit</th><th>PR</th><th>Issue</th><th>贡献者</th><th>总活动</th></tr></thead>
                    <tbody>{load.data.repositories.items.map((item) => (
                      <tr key={item.githubId}>
                        <td><strong>{item.fullName}</strong></td><td><span className="tag">{item.group}</span></td><td>{item.commits}</td>
                        <td>{item.prs}</td><td>{item.issues}</td><td>{item.contributors}</td><td><strong>{item.total}</strong></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}
