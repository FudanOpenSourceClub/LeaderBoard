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
import { MotionSelect } from "../components/MotionSelect";

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
      <section className="makers-hero" aria-labelledby="makers-title">
        <div className="makers-hero-inner">
          <span className="makers-eyebrow">LEADBOARD / THE PEOPLE</span>
          <h1 id="makers-title">代码背后，<br /><em>是创造者。</em></h1>
          <p>认识复旦的开源贡献者，发现他们留下的作品与足迹。</p>
          <span className="makers-scroll-hint" aria-hidden="true">DISCOVER <span>↓</span></span>
        </div>
        <div className="makers-hero-orbit" aria-hidden="true"><span>OPEN</span><span>SOURCE</span></div>
      </section>

      <section className="filter-card leaderboard-filters" aria-label="校内开源达人筛选">
        <div>
          <span className="filter-title">浏览贡献</span>
          <span className="filter-caption">按 {metricLabel[metric]} 排序</span>
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
        <MotionSelect label="时间范围" value={range} onChange={(value) => setRange(TimeRangeSchema.parse(value))} options={[{ value: "7d", label: "最近 7 天" }, { value: "30d", label: "最近 30 天" }, { value: "90d", label: "最近 90 天" }, { value: "all", label: "全部历史" }]} />
        <MotionSelect label="分组" value={group ?? ""} onChange={(value) => setGroup(value || undefined)} options={[{ value: "", label: "全部分组" }, ...groups.map((item) => ({ value: item.name, label: item.name }))]} />
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
            <section className="maker-showcase" aria-label="本期精选贡献者">
              <div className="maker-showcase-heading">
                <div>
                  <p className="maker-overline">FEATURED CONTRIBUTORS</p>
                  <h2>开源达人<span className="maker-dot">.</span></h2>
                </div>
                <span className="maker-showcase-count">{visibleItems.length} 位贡献者 <span aria-hidden="true">↗</span></span>
              </div>
              <div className="maker-portraits">
                {visibleItems.slice(0, 3).map((item, index) => (
                  <Link className={"maker-portrait maker-portrait-" + (index + 1)} key={item.login} to={"/contributors/" + encodeURIComponent(item.login)}>
                    <div className="maker-portrait-visual">
                      <span className="maker-portrait-index">NO. {String(item.rank).padStart(2, "0")}</span>
                      {item.avatarUrl
                        ? <img className="maker-portrait-avatar" src={item.avatarUrl} alt="" loading="lazy" />
                        : <span className="maker-portrait-avatar maker-portrait-placeholder" aria-hidden="true">{item.login.slice(0, 1).toUpperCase()}</span>}
                      <span className="maker-portrait-mark" aria-hidden="true">↗</span>
                    </div>
                    <div className="maker-portrait-info">
                      <span className="maker-portrait-role">OPEN SOURCE CONTRIBUTOR</span>
                      <h3>{item.login}</h3>
                      <div className="maker-portrait-stats">
                        <span><strong>{item[metric]}</strong> {metricLabel[metric]}</span>
                        <span>{item.commits} Commit <span aria-hidden="true">·</span> {item.prs} PR <span aria-hidden="true">·</span> {item.issues} Issue</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="panel ranking-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">完整榜单</p>
                  <h2>校内开源达人</h2>
                  <p>按照所选时间与贡献指标排列</p>
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
