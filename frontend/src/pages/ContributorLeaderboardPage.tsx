import { useEffect, useMemo, useRef, useState } from "react";
import {
  TimeRangeSchema,
  type ContributorLeaderboardResponse,
  type GroupsResponse,
} from "@leadboard/contracts";
import { Link } from "react-router";
import type { LeadBoardApiClient } from "../api/client";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncStates";
import { useLocalFavorites } from "../lib/favorites";
import { useFilters } from "../state/filters";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; leaderboard: ContributorLeaderboardResponse; groups: GroupsResponse["items"] };

export function ContributorLeaderboardPage({ api }: { api: LeadBoardApiClient }) {
  const { range, setRange, group, setGroup } = useFilters();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(10);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const generation = useRef(0);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favorites = useLocalFavorites("contributors");

  useEffect(() => {
    let active = true;
    generation.current += 1;
    setVisibleCount(10);
    setLoadingMore(false);
    setMoreError(null);
    setState({ status: "loading" });
    void Promise.all([
      api.getContributorLeaderboard({ range, metric: "score", ...(group === undefined ? {} : { group }), limit: 11 }),
      api.getGroups(),
    ]).then(
      ([leaderboard, groups]) => { if (active) setState({ status: "ready", leaderboard, groups: groups.items }); },
      (error: unknown) => {
        if (active) setState({ status: "error", message: error instanceof Error ? error.message : "排行榜加载失败" });
      },
    );
    return () => { active = false; };
  }, [api, range, group, retry]);

  const groups = state.status === "ready" ? state.groups : [];
  const visibleItems = useMemo(() => {
    if (state.status !== "ready") return [];
    const normalized = query.trim().toLowerCase();
    return state.leaderboard.items.slice(0, visibleCount).filter((item) => {
      const matchesQuery = !normalized || item.login.toLowerCase().includes(normalized);
      const matchesFavorite = !favoritesOnly || favorites.isFavorite(item.login);
      return matchesQuery && matchesFavorite;
    });
  }, [state, query, favoritesOnly, favorites.items, visibleCount]);


  async function showMore() {
    if (loadingMore || state.status !== "ready") return;
    const currentGeneration = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const leaderboard = await api.getContributorLeaderboard({range, metric:"score", ...(group === undefined ? {} : {group}), limit:visibleCount + 11});
      if (generation.current !== currentGeneration) return;
      setState({...state, leaderboard});
      setVisibleCount(value => value + 10);
    } catch (error) {
      if (generation.current === currentGeneration) setMoreError(error instanceof Error ? error.message : "加载失败，请重试");
    } finally {
      if (generation.current === currentGeneration) setLoadingMore(false);
    }
  }
  const hasMore = state.status === "ready" && state.leaderboard.items.length > visibleCount;


  return (
    <div className="page-canvas">
      <section className="page-hero compact-hero">
        <div>
          <span className="hero-badge">FUDAN CONTRIBUTORS</span>
          <h1>复旦开源达人</h1>
          <p>每一次提交、协作和讨论，都会在这里留下清晰的记录。</p>
        </div>
        <div className="hero-stamp" aria-hidden="true">🏆</div>
      </section>

      <section className="filter-card leaderboard-filters" aria-label="积分规则">
        <div>
          <span className="filter-title">贡献积分规则</span>
          <p className="filter-caption">Commit 与 Issue 仅在仓库 Star ≥ 10 时计分，不受白名单限制，自己的仓库也适用；两者合计每月最多 10 次、同一仓库每月最多 3 次，每次 1 分。PR 仅在白名单仓库计分：提交得 20 分，合并再加 30 分。Star 数按每日同步结果判断。LeaderBoard 开发者另有一次性 50 分开发贡献奖励。</p>
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

      </section>

      <section className="dashboard-content">
        {state.status === "loading" && <LoadingState label="正在加载贡献者排行榜…" />}
        {state.status === "error" && <ErrorState message={state.message} onRetry={() => setRetry((value) => value + 1)} />}
        {state.status === "ready" && state.leaderboard.items.length === 0 && <EmptyState label="当前筛选下没有贡献者活动" />}
        {state.status === "ready" && state.leaderboard.items.length > 0 && visibleItems.length === 0 && (
          <div className="empty-filter-state">没有匹配的贡献者。换个用户名，或者关闭“只看收藏”。</div>
        )}
        {state.status === "ready" && state.leaderboard.items.length > 0 && (
          <>
            <div className="section-title-row">
              <div>
                <p className="section-kicker">OPEN SOURCE MAKERS</p>
                <h2>达人榜</h2>
                <p>按贡献积分排序，保留全部历史积分。</p>
              </div>
              <span className="count-pill">{Math.min(visibleCount, state.leaderboard.items.length)} 位达人</span>
            </div>

            <section className="panel ranking-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">CONTRIBUTOR RANKING</p>
                  <h2>贡献排行榜</h2>
                </div>
              </div>
              <div className="ranking-list">
                {visibleItems.map((item) => (
                  <div className={`ranking-row ranking-row-with-favorite ${item.rank <= 3 ? `ranking-medalist ranking-medalist-${item.rank}` : ""}`} key={item.login}>
                    {item.rank <= 3 ? <span className={`rank-medal rank-medal-${item.rank}`} role="img" aria-label={`${["金牌", "银牌", "铜牌"][item.rank - 1]}，第 ${item.rank} 名`}><svg viewBox="0 0 40 48" aria-hidden="true"><path className="medal-ribbon" d="M9 4h9l7 18-8 4zM31 4h-9l-7 18 8 4z"/><circle cx="20" cy="30" r="15" fill="currentColor"/><circle cx="20" cy="30" r="11.5" fill="none" stroke="white" strokeOpacity=".65"/><text x="20" y="35" textAnchor="middle" fill="white" fontSize="15" fontWeight="800">{item.rank}</text></svg></span> : <span className="rank-badge rank-4">{item.rank}</span>}
                    <img className="avatar avatar-xl"
                      src={item.avatarUrl ?? `https://github.com/${encodeURIComponent(item.login)}.png?size=96`}
                      alt={`${item.login} 的头像`} loading="lazy" />
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
                    <span className="ranking-total"><strong>{item.score ?? 0}</strong><small>积分</small></span>
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
              <div className="ranking-more">
                {moreError && <p role="alert">{moreError}</p>}
                <button className="toolbar-button" type="button" disabled={loadingMore || !hasMore} onClick={() => void showMore()}>{loadingMore ? "正在加载…" : hasMore ? "显示更多" : "已显示全部达人"}<span aria-hidden="true">{hasMore ? "↓" : "✓"}</span></button>
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}
