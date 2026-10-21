import { useEffect, useMemo, useState } from "react";
import {
  TimeRangeSchema,
  type ContributorLeaderboardResponse,
  type GroupsResponse,
} from "@leadboard/contracts";
import { Link } from "react-router";
import type { LeadBoardApiClient } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncStates";
import { downloadCsv } from "../lib/download";
import { useLocalFavorites } from "../lib/favorites";
import { useFilters } from "../state/filters";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; leaderboard: ContributorLeaderboardResponse; groups: GroupsResponse["items"] };

const metricLabel = {
  total: "总活动",
  commits: "Commit",
  prs: "Pull Request",
  issues: "Issue",
} as const;

const metricEntries = Object.entries(metricLabel) as Array<[keyof typeof metricLabel, string]>;

export function ContributorLeaderboardPage({ api }: { api: LeadBoardApiClient }) {
  const { range, setRange, metric, setMetric, group, setGroup } = useFilters();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favorites = useLocalFavorites("contributors");

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void Promise.all([
      api.getContributorLeaderboard({ range, metric, ...(group === undefined ? {} : { group }), limit: 50 }),
      api.getGroups(),
    ]).then(
      ([leaderboard, groups]) => { if (active) setState({ status: "ready", leaderboard, groups: groups.items }); },
      (error: unknown) => {
        if (active) setState({ status: "error", message: error instanceof Error ? error.message : "排行榜加载失败" });
      },
    );
    return () => { active = false; };
  }, [api, range, metric, group, retry]);

  const groups = state.status === "ready" ? state.groups : [];
  const visibleItems = useMemo(() => {
    if (state.status !== "ready") return [];
    const normalized = query.trim().toLowerCase();
    return state.leaderboard.items.filter((item) => {
      const matchesQuery = !normalized || item.login.toLowerCase().includes(normalized);
      const matchesFavorite = !favoritesOnly || favorites.isFavorite(item.login);
      return matchesQuery && matchesFavorite;
    });
  }, [state, query, favoritesOnly, favorites.items]);

  function exportVisibleRows() {
    if (state.status !== "ready") return;
    downloadCsv(
      `leadboard-${range}-${metric}.csv`,
      [
        ["排名", "GitHub", "Commit", "Pull Request", "Issue", "总活动", "时间范围", "分组"],
        ...visibleItems.map((item) => [
          item.rank,
          item.login,
          item.commits,
          item.prs,
          item.issues,
          item.total,
          range,
          group ?? "全部分组",
        ]),
      ],
    );
  }

  return (
    <div className="page-canvas">
      <section className="page-hero compact-hero">
        <div>
          <span className="hero-badge">CAMPUS MAKERS</span>
          <h1>校内开源达人</h1>
          <p>每一次提交、协作和讨论，都会在这里留下清晰的记录。</p>
        </div>
        <div className="hero-stamp" aria-hidden="true">🏆</div>
      </section>

      <section className="filter-card leaderboard-filters" aria-label="校内开源达人筛选">
        <div>
          <span className="filter-title">四种贡献视角</span>
          <span className="filter-caption">当前按 {metricLabel[metric]} 排序</span>
        </div>
        <div className="segmented-metrics" role="group" aria-label="排行榜指标">
          {metricEntries.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={metric === value}
              onClick={() => setMetric(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="toolbar-card" aria-label="贡献者搜索和操作">
        <label className="search-box" aria-label="搜索贡献者">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 GitHub 用户名"
          />
        </label>
        <select
          className="toolbar-select"
          value={range}
          onChange={(event) => setRange(TimeRangeSchema.parse(event.target.value))}
          aria-label="时间范围"
        >
          <option value="7d">最近 7 天</option>
          <option value="30d">最近 30 天</option>
          <option value="90d">最近 90 天</option>
          <option value="all">全部历史</option>
        </select>
        <select
          className="toolbar-select"
          value={group ?? ""}
          onChange={(event) => setGroup(event.target.value || undefined)}
          aria-label="分组"
        >
          <option value="">全部分组</option>
          {groups.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
        <button
          className="toolbar-button"
          type="button"
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((value) => !value)}
        >
          {favoritesOnly ? "★ 只看收藏" : "☆ 只看收藏"}
        </button>
        <button
          className="toolbar-button"
          type="button"
          onClick={exportVisibleRows}
          disabled={state.status !== "ready" || visibleItems.length === 0}
        >
          导出 CSV
        </button>
      </section>

      <section className="dashboard-content">
        {state.status === "loading" && <LoadingState label="正在加载贡献者排行榜…" />}
        {state.status === "error" && <ErrorState message={state.message} onRetry={() => setRetry((value) => value + 1)} />}
        {state.status === "ready" && state.leaderboard.items.length === 0 && <EmptyState label="当前筛选下没有贡献者活动" />}
        {state.status === "ready" && state.leaderboard.items.length > 0 && visibleItems.length === 0 && (
          <div className="empty-filter-state">没有匹配的贡献者。换个用户名，或者关闭“只看收藏”。</div>
        )}
        {state.status === "ready" && visibleItems.length > 0 && (
          <>
            <div className="section-title-row">
              <div>
                <p className="section-kicker">OPEN SOURCE MAKERS</p>
                <h2>本期活跃达人</h2>
                <p>排名依据公开 GitHub 活动统计，不代表对个人能力的评价。</p>
              </div>
              <span className="count-pill">{visibleItems.length} 位贡献者</span>
            </div>

            <div className="podium-grid">
              {visibleItems.slice(0, 3).map((item) => (
                <Link className={`podium-card podium-${Math.min(item.rank, 3)}`} key={item.login} to={`/contributors/${encodeURIComponent(item.login)}`}>
                  <span className="podium-rank">#{item.rank}</span>
                  {item.avatarUrl
                    ? <img className="podium-avatar" src={item.avatarUrl} alt="" />
                    : <span className="podium-avatar avatar-placeholder" aria-hidden="true">{item.login.slice(0, 1).toUpperCase()}</span>}
                  <strong className="podium-name">{item.login}</strong>
                  <span className="podium-score">{item[metric]}<small> {metricLabel[metric]}</small></span>
                  <div className="podium-meta">
                    <span><b>{item.commits}</b> Commit</span>
                    <span><b>{item.prs}</b> PR</span>
                    <span><b>{item.issues}</b> Issue</span>
                  </div>
                </Link>
              ))}
            </div>

            <section className="panel ranking-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">完整榜单</p>
                  <h2>校内开源达人</h2>
                  <p>搜索、收藏和导出都只影响你的当前视图，不改变榜单原始数据。</p>
                </div>
              </div>
              <div className="ranking-list">
                {visibleItems.map((item) => (
                  <div className="ranking-row ranking-row-with-favorite" key={item.login}>
                    <span className={`rank-badge rank-${Math.min(item.rank, 4)}`}>{item.rank}</span>
                    {item.avatarUrl
                      ? <img className="avatar avatar-xl" src={item.avatarUrl} alt="" />
                      : <span className="avatar avatar-xl avatar-placeholder" aria-hidden="true">{item.login.slice(0, 1).toUpperCase()}</span>}
                    <Link className="ranking-person" to={`/contributors/${encodeURIComponent(item.login)}`}>
                      <strong>{item.login}</strong>
                      <span className="tag-row">
                        <span className="tag tag-purple">{item.commits} Commit</span>
                        <span className="tag tag-blue">{item.prs} PR</span>
                        <span className="tag tag-gold">{item.issues} Issue</span>
                      </span>
                    </Link>
                    <span className="ranking-metrics">
                      <span><small>Commit</small><b>{item.commits}</b></span>
                      <span><small>PR</small><b>{item.prs}</b></span>
                      <span><small>Issue</small><b>{item.issues}</b></span>
                    </span>
                    <span className="ranking-total"><strong>{item[metric]}</strong><small>{metricLabel[metric]}</small></span>
                    <button
                      className="favorite-button"
                      type="button"
                      aria-label={favorites.isFavorite(item.login) ? `取消收藏 ${item.login}` : `收藏 ${item.login}`}
                      aria-pressed={favorites.isFavorite(item.login)}
                      onClick={() => favorites.toggle(item.login)}
                      title="收藏只保存在当前浏览器"
                    >
                      {favorites.isFavorite(item.login) ? "★" : "☆"}
                    </button>
                    <Link className="row-arrow" to={`/contributors/${encodeURIComponent(item.login)}`} aria-label={`查看 ${item.login} 详情`}>→</Link>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}
