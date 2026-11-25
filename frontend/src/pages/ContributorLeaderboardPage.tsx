import { useEffect, useRef, useState } from "react";
import {
  COMPETITION_PERIOD,
  TimeRangeSchema,
  type ContributorLeaderboardResponse,
  type GroupsResponse,
  type OrganizationSummary,
} from "@leadboard/contracts";
import { Link } from "react-router";
import type { LeadBoardApiClient } from "../api/client";
import { AppIcon } from "../components/AppIcon";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncStates";
import { ContributionBadges } from "../components/ContributionProfile";
import { ContributorAvatar } from "../components/ContributorAvatar";
import { OutstandingBoards } from "../components/OutstandingBoards";
import { Button, Input } from "../components/ui/primitives";
import { useLocalFavorites } from "../lib/favorites";
import { useFilters } from "../state/filters";

const pageSize = 10;
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; leaderboard: ContributorLeaderboardResponse; groups: GroupsResponse["items"] };

function RankingSummary({ api }: { api: LeadBoardApiClient }) {
  const { range } = useFilters();
  const [summary, setSummary] = useState<OrganizationSummary | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setError(false);
    void api.getOrganizationSummary(range).then(
      value => { if (active) setSummary(value); },
      () => { if (active) setError(true); },
    );
    return () => { active = false; };
  }, [api, range, retry]);

  const current = !error && summary?.range === range ? summary : null;
  const format = new Intl.NumberFormat("zh-CN");
  const metrics = [
    { label: "活跃贡献者", value: current?.contributors, icon: <AppIcon name="users" size={17} /> },
    { label: "Commit", value: current?.commits, icon: <AppIcon name="commit" size={17} /> },
    { label: "PR", value: current?.prs, icon: <AppIcon name="pull-request" size={17} /> },
    { label: "Issue", value: current?.issues, icon: <AppIcon name="issue" size={17} /> },
  ];

  return (
    <section className="rank-surface rank-summary" aria-labelledby="rank-summary-title" aria-busy={!current && !error}>
      <div className="rank-summary-heading">
        <h2 id="rank-summary-title">{"全站贡献概览"}</h2>
        {error && <button type="button" onClick={() => setRetry(value => value + 1)}>{"概览加载失败 · 重试"}</button>}
      </div>
      <dl>
        {metrics.map(({ label, value, icon }) => (
          <div key={label}>
            <dt>{icon}<span>{label}</span></dt>
            <dd>{value === undefined ? "—" : format.format(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ContributorLeaderboardPage({ api }: { api: LeadBoardApiClient }) {
  const { range, setRange, group, setGroup } = useFilters();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const generation = useRef(0);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favorites = useLocalFavorites("contributors");

  useEffect(() => {
    let active = true;
    setVisibleCount(pageSize);
    setLoadingMore(false);
    setMoreError(null);
    setState({ status: "loading" });
    void Promise.all([
      api.getContributorLeaderboard({ range, metric: "score", ...(group === undefined ? {} : { group }), limit: pageSize + 1 }),
      api.getGroups(),
    ]).then(
      ([leaderboard, groups]) => { if (active) setState({ status: "ready", leaderboard, groups: groups.items }); },
      (error: unknown) => {
        if (active) setState({ status: "error", message: error instanceof Error ? error.message : "排行榜加载失败" });
      },
    );
    return () => { active = false; generation.current += 1; };
  }, [api, range, group, retry]);

  const groups = state.status === "ready" ? state.groups : [];
  const loadedItems = state.status === "ready" ? state.leaderboard.items.slice(0, visibleCount) : [];
  const normalized = query.trim().toLowerCase();
  const filtered = Boolean(normalized || favoritesOnly);
  const visibleItems = loadedItems.filter(item =>
    item.login.toLowerCase().includes(normalized) && (!favoritesOnly || favorites.isFavorite(item.login))
  );

  async function showMore() {
    if (loadingMore || state.status !== "ready") return;
    const currentGeneration = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const leaderboard = await api.getContributorLeaderboard({ range, metric: "score", ...(group === undefined ? {} : { group }), limit: visibleCount + pageSize + 1 });
      if (generation.current !== currentGeneration) return;
      setState({ ...state, leaderboard });
      setVisibleCount(value => value + pageSize);
    } catch (error) {
      if (generation.current === currentGeneration) setMoreError(error instanceof Error ? error.message : "加载失败，请重试");
    } finally {
      if (generation.current === currentGeneration) setLoadingMore(false);
    }
  }

  const hasMore = state.status === "ready" && state.leaderboard.items.length > visibleCount;
  const number = new Intl.NumberFormat("zh-CN");

  return (
    <div className="rank-page">
      <header className="rank-page-heading">
        <div>
          <h1><AppIcon name="trophy" size={24} />{"开源达人榜"}</h1>
          <p data-testid="competition-period">{"比赛计分周期"} · {COMPETITION_PERIOD.label}（北京时间，含首尾两天）</p>
        </div>
        <a className="rank-honor-jump" href="#monthly-honors">{"本月荣誉榜"}<AppIcon name="chevron-down" size={14} /></a>
        <details className="rank-rules">
          <summary>{"积分规则"}<AppIcon name="chevron-down" size={15} /></summary>
          <p>{"Commit 不计分。仓库 Star ≥ 100 时，Issue 每次 5 分，每人每自然月最多计 10 次，每仓库每自然月最多计 3 次。白名单仓库的 PR 提交得 20 分，合并另加 30 分。Outstanding 勋章可在个人档案申请，每枚 15 分，审核通过后有效一个月，可累加。复旦开源仓库必吃榜的仓库收录申请通过后加 20 分。"}</p>
        </details>
      </header>

      <div className="rank-layout">
        <div className="rank-primary">
          <RankingSummary api={api} />
          <section className="rank-surface rank-list-panel" aria-label={"贡献者排名"}>
            <div className="rank-toolbar" role="group" aria-label={"贡献者搜索和筛选"}>
              <div className="rank-search">
                <AppIcon name="search" size={17} />
                <Input
                  aria-label={"搜索 GitHub 用户名"}
                  aria-describedby={filtered && hasMore ? "rank-search-scope" : undefined}
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={"搜索 GitHub 用户名"}
                />
              </div>
              <div className="rank-filter-controls">
                <label className="rank-select rank-time">
                  <AppIcon name="calendar" size={16} />
                  <select value={range} onChange={event => setRange(TimeRangeSchema.parse(event.target.value))} aria-label={"时间范围"}>
                    <option value="competition">{"比赛周期"}</option>
                    <option value="7d">{"最近 7 天"}</option>
                    <option value="30d">{"最近 30 天"}</option>
                    <option value="90d">{"最近 90 天"}</option>
                    <option value="all">{"全部历史"}</option>
                  </select>
                  <AppIcon name="chevron-down" size={14} />
                </label>
                <label className="rank-select rank-group">
                  <select value={group ?? ""} onChange={event => setGroup(event.target.value || undefined)} aria-label={"分组"}>
                    <option value="">{"全部分组"}</option>
                    {group && !groups.some(item => item.name === group) && <option value={group}>{group}</option>}
                    {groups.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
                  </select>
                  <AppIcon name="chevron-down" size={14} />
                </label>
                <button className="rank-favorites-filter" type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}>
                  <AppIcon name="star" size={16} />{"仅收藏"}
                </button>
              </div>
            </div>
            {filtered && hasMore && <p className="rank-search-scope" id="rank-search-scope">{"在已加载的排名中筛选，可继续加载查找更多贡献者。"}</p>}

            {state.status === "loading" && <LoadingState label={"正在加载贡献者排行榜…"} />}
            {state.status === "error" && <ErrorState message={state.message} onRetry={() => setRetry(value => value + 1)} />}
            {state.status === "ready" && loadedItems.length === 0 && <EmptyState label={"当前筛选下没有贡献者活动"} />}
            {state.status === "ready" && loadedItems.length > 0 && visibleItems.length === 0 && (
              <div className="async-state rank-no-match" role="status">
                {"没有匹配的达人。"}
                <button type="button" onClick={() => { setQuery(""); setFavoritesOnly(false); }}>{"清除筛选"}</button>
              </div>
            )}
            {visibleItems.length > 0 && (
              <table className="rank-table">
                <thead><tr>
                  <th scope="col" className="rank-position" aria-label={"排名"}>#</th>
                  <th scope="col" className="rank-person-heading">{"贡献者"}</th>
                  <th scope="col" className="rank-number rank-score-heading" aria-sort="descending">{"积分"}<AppIcon name="chevron-down" size={13} /></th>
                  <th scope="col" className="rank-number rank-activity">Commit</th>
                  <th scope="col" className="rank-number rank-activity">PR</th>
                  <th scope="col" className="rank-number rank-activity">Issue</th>
                  <th scope="col" className="rank-favorite-cell" aria-label={"收藏"}><AppIcon name="star" size={14} /></th>
                </tr></thead>
                <tbody>{visibleItems.map(item => {
                  const favorite = favorites.isFavorite(item.login);
                  const profileUrl = `/contributors/${encodeURIComponent(item.login)}`;
                  return (
                    <tr key={item.login}>
                      <td className="rank-position"><span className="rank-place" data-place={item.rank <= 3 ? item.rank : undefined}>{item.rank}</span></td>
                      <th className="rank-person-cell" scope="row">
                        <div className="rank-person">
                          <Link to={profileUrl} className="rank-person-link">
                            <ContributorAvatar login={item.login} src={item.avatarUrl} />
                            <strong>{item.login}</strong>
                          </Link>
                          {item.communityTags && item.communityTags.length > 0 && (
                            <div className="rank-row-badges"><ContributionBadges tags={item.communityTags} /></div>
                          )}
                          <div className="rank-mobile-activity">
                            <span>{number.format(item.commits)} Commit</span><span>{number.format(item.prs)} PR</span><span>{number.format(item.issues)} Issue</span>
                          </div>
                        </div>
                      </th>
                      <td className="rank-number"><span className="rank-score">{number.format(item.score ?? 0)}</span></td>
                      <td className="rank-number rank-activity">{number.format(item.commits)}</td>
                      <td className="rank-number rank-activity">{number.format(item.prs)}</td>
                      <td className="rank-number rank-activity">{number.format(item.issues)}</td>
                      <td className="rank-favorite-cell">
                        <button
                          className="favorite-button rank-favorite"
                          type="button"
                          aria-label={favorite ? `取消收藏 ${item.login}` : `收藏 ${item.login}`}
                          aria-pressed={favorite}
                          onClick={() => favorites.toggle(item.login)}
                        >
                          <AppIcon name="star" size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
            {state.status === "ready" && loadedItems.length > 0 && (
              <footer className="rank-list-footer">
                <p role="status">{filtered
                  ? `已加载 ${number.format(loadedItems.length)} 人 · 匹配 ${number.format(visibleItems.length)} 人`
                  : `已显示 ${number.format(visibleItems.length)} 人`}</p>
                {moreError && <p className="rank-more-error" role="alert">{moreError}</p>}
                {hasMore && <Button className="rank-more" variant="outline" disabled={loadingMore} onClick={() => void showMore()}>{loadingMore ? "正在加载…" : "显示更多"}<AppIcon name="chevron-down" size={14} /></Button>}
              </footer>
            )}
          </section>
        </div>
        <OutstandingBoards api={api} />
      </div>
    </div>
  );
}
