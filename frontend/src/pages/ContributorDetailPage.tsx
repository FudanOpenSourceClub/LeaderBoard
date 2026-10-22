import { useEffect, useState } from "react";
import { TimeRangeSchema, type ContributorDetail } from "@leadboard/contracts";
import { Link, useParams } from "react-router";
import type { LeadBoardApiClient } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncStates";
import { useLocalFavorites } from "../lib/favorites";
import { useFilters } from "../state/filters";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: ContributorDetail };

export function ContributorDetailPage({ api }: { api: LeadBoardApiClient }) {
  const params = useParams();
  const username = params.username ?? "";
  const { range, setRange } = useFilters();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState(false);
  const favorites = useLocalFavorites("contributors");

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    if (!username) {
      setState({ status: "error", message: "贡献者名称缺失" });
      return () => { active = false; };
    }
    void api.getContributorDetail(username, range).then(
      (detail) => { if (active) setState({ status: "ready", detail }); },
      (error: unknown) => {
        if (active) setState({ status: "error", message: error instanceof Error ? error.message : "贡献者详情加载失败" });
      },
    );
    return () => { active = false; };
  }, [api, username, range, retry]);

  async function copyProfileLink() {
    if (typeof window === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="page-canvas">
      <section className="profile-hero">
        <Link className="back-link" to="/contributors">← 返回贡献者榜单</Link>
        {state.status === "ready" && state.detail.avatarUrl
          ? <img className="profile-avatar" src={state.detail.avatarUrl} alt="" />
          : <span className="profile-avatar avatar-placeholder" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>}
        <div className="profile-copy">
          <h1>{username || "贡献者详情"}</h1>
           
          {username && (
            <div className="profile-actions">
              <a
                className="profile-action-link"
                href={`https://github.com/${encodeURIComponent(username)}`}
                target="_blank"
                rel="noreferrer"
              >
                GitHub ↗
              </a>

              <button
                className="profile-action-button"
                type="button"
                aria-pressed={favorites.isFavorite(username)}
                onClick={() => favorites.toggle(username)}
              >
                {favorites.isFavorite(username) ? "★ 已收藏" : "☆ 收藏"}
              </button>
              <button className="profile-action-button" type="button" onClick={() => void copyProfileLink()}>
                {copied ? "✓ 已复制" : "复制档案链接"}
              </button>
            </div>
          )}
        </div>
        <label className="profile-range">时间范围
          <select value={range} onChange={(event) => setRange(TimeRangeSchema.parse(event.target.value))}>
            <option value="7d">最近 7 天</option><option value="30d">最近 30 天</option>
            <option value="90d">最近 90 天</option><option value="all">全部历史</option>
          </select>
        </label>
      </section>

      <section className="dashboard-content">
        {state.status === "loading" && <LoadingState label="正在加载贡献者详情…" />}
        {state.status === "error" && <ErrorState message={state.message} onRetry={() => setRetry((value) => value + 1)} />}
        {state.status === "ready" && (
          <>
            <div className="metric-grid detail-metrics">
              <article className="metric-card metric-purple"><span>Commit</span><strong>{state.detail.commits}</strong></article>
              <article className="metric-card metric-indigo"><span>PR</span><strong>{state.detail.prs}</strong></article>
              <article className="metric-card metric-blue"><span>Issue</span><strong>{state.detail.issues}</strong></article>
              <article className="metric-card metric-mint"><span>积分</span><strong>{state.detail.score ?? 0}</strong></article>
            </div>

            <details className="score-breakdown"><summary>积分明细</summary><p className="filter-caption">Commit / Issue：{state.detail.commitIssueScore ?? 0} · PR：{state.detail.prOpenedScore ?? 0} · 合并 PR：{state.detail.prMergedScore ?? 0} · 开发奖励：{state.detail.bonusScore ?? 0}</p></details>
            <section className="panel repository-panel">
              <div className="panel-heading">
                <div><h2>仓库贡献</h2></div>
              </div>
              {state.detail.repositories.length === 0 ? <EmptyState label="当前时间范围内没有仓库活动" /> : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>仓库</th><th>分组</th><th>Commit</th><th>PR</th><th>Issue</th><th>总活动</th><th>积分</th></tr></thead>
                    <tbody>{state.detail.repositories.map((item) => (
                      <tr key={item.fullName}><td><strong>{item.fullName}</strong></td><td><span className="tag">{item.group}</span></td>
                        <td>{item.commits}</td><td>{item.prs}</td><td>{item.issues}</td><td><strong>{item.total}</strong></td><td><strong>{item.score ?? 0}</strong></td></tr>
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
