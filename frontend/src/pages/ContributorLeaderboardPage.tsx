import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, CircleDot, GitCommitHorizontal, GitPullRequest } from "lucide-react";
import {
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
import { useCompetitionLabels, useLanguage } from "../state/language";

const pageSize = 10;
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; leaderboard: ContributorLeaderboardResponse; groups: GroupsResponse["items"] };

function RankingSummary({ api }: { api: LeadBoardApiClient }) {
  const { locale, t } = useLanguage();
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
  const format = new Intl.NumberFormat(locale);
  const metrics = [
    { label: t("活跃贡献者", "Active contributors"), value: current?.contributors, icon: <AppIcon name="users" size={17} /> },
    { label: "Commit", value: current?.commits, icon: <GitCommitHorizontal size={17} aria-hidden="true" /> },
    { label: "PR", value: current?.prs, icon: <GitPullRequest size={17} aria-hidden="true" /> },
    { label: "Issue", value: current?.issues, icon: <CircleDot size={17} aria-hidden="true" /> },
  ];

  return (
    <section className="rank-surface rank-summary" aria-labelledby="rank-summary-title" aria-busy={!current && !error}>
      <div className="rank-summary-heading">
        <h2 id="rank-summary-title">{t("全站贡献概览", "Site-wide activity")}</h2>
        {error && <button type="button" onClick={() => setRetry(value => value + 1)}>{t("概览加载失败 · 重试", "Activity unavailable · Retry")}</button>}
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
  const { locale, t } = useLanguage();
  const competition = useCompetitionLabels();
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
        if (active) setState({ status: "error", message: error instanceof Error ? error.message : t("排行榜加载失败", "Could not load the leaderboard") });
      },
    );
    return () => { active = false; generation.current += 1; };
  }, [api, range, group, retry, t]);

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
      if (generation.current === currentGeneration) setMoreError(error instanceof Error ? error.message : t("加载失败，请重试", "Could not load. Try again"));
    } finally {
      if (generation.current === currentGeneration) setLoadingMore(false);
    }
  }

  const hasMore = state.status === "ready" && state.leaderboard.items.length > visibleCount;
  const number = new Intl.NumberFormat(locale);

  return (
    <div className="rank-page">
      <header className="rank-page-heading">
        <div>
          <h1><AppIcon name="trophy" size={24} />{t("开源达人榜", "Open Source Leaderboard")}</h1>
          <p data-testid="competition-period">{t("比赛计分周期", "Scoring period")} · {competition.dates}{t("（北京时间，含首尾两天）", " (Beijing time, inclusive)")}</p>
        </div>
        <a className="rank-honor-jump" href="#monthly-honors">{t("本月荣誉榜", "Monthly honors")}<ChevronDown size={14} aria-hidden="true" /></a>
        <details className="rank-rules">
          <summary>{t("积分规则", "Scoring rules")}<ChevronDown size={15} aria-hidden="true" /></summary>
          <p>{t("Commit 不计分。仓库 Star ≥ 100 时，Issue 每次 5 分，每人每自然月最多计 10 次，每仓库每自然月最多计 3 次。白名单仓库的 PR 提交得 20 分，合并另加 30 分。Outstanding 勋章可在个人档案申请，每枚 15 分，审核通过后有效一个月，可累加。精选开源仓库收录通过后加 20 分。", "Commits do not earn points. Issues earn 5 points in repositories with at least 100 stars, up to 10 issues per person and 3 per repository each calendar month. In listed repositories, opening a PR earns 20 points and merging it earns 30 more. Apply for Outstanding badges from your profile. Each approved badge earns 15 points for one month, and awards add up. Approved project suggestions earn 20 points.")}</p>
        </details>
      </header>

      <div className="rank-layout">
        <div className="rank-primary">
          <RankingSummary api={api} />
          <section className="rank-surface rank-list-panel" aria-label={t("贡献者排名", "Contributor rankings")}>
            <div className="rank-toolbar" role="group" aria-label={t("贡献者搜索和筛选", "Contributor search and filters")}>
              <div className="rank-search">
                <AppIcon name="search" size={17} />
                <Input
                  aria-label={t("搜索 GitHub 用户名", "Search by GitHub username")}
                  aria-describedby={filtered && hasMore ? "rank-search-scope" : undefined}
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={t("搜索 GitHub 用户名", "Search by GitHub username")}
                />
              </div>
              <div className="rank-filter-controls">
                <label className="rank-select rank-time">
                  <CalendarDays size={16} aria-hidden="true" />
                  <select value={range} onChange={event => setRange(TimeRangeSchema.parse(event.target.value))} aria-label={t("时间范围", "Time range")}>
                    <option value="competition">{t("比赛周期", "Competition")}</option>
                    <option value="7d">{t("最近 7 天", "Last 7 days")}</option>
                    <option value="30d">{t("最近 30 天", "Last 30 days")}</option>
                    <option value="90d">{t("最近 90 天", "Last 90 days")}</option>
                    <option value="all">{t("全部历史", "All time")}</option>
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </label>
                <label className="rank-select rank-group">
                  <select value={group ?? ""} onChange={event => setGroup(event.target.value || undefined)} aria-label={t("分组", "Group")}>
                    <option value="">{t("全部分组", "All groups")}</option>
                    {group && !groups.some(item => item.name === group) && <option value={group}>{group}</option>}
                    {groups.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </label>
                <button className="rank-favorites-filter" type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}>
                  <AppIcon name="star" size={16} />{t("仅收藏", "Favorites")}
                </button>
              </div>
            </div>
            {filtered && hasMore && <p className="rank-search-scope" id="rank-search-scope">{t("在已加载的排名中筛选，可继续加载查找更多贡献者。", "Filters apply to loaded ranks. Show more to search additional contributors.")}</p>}

            {state.status === "loading" && <LoadingState label={t("正在加载贡献者排行榜…", "Loading contributors…")} />}
            {state.status === "error" && <ErrorState message={state.message} onRetry={() => setRetry(value => value + 1)} />}
            {state.status === "ready" && loadedItems.length === 0 && <EmptyState label={t("当前筛选下没有贡献者活动", "No contributor activity matches these filters")} />}
            {state.status === "ready" && loadedItems.length > 0 && visibleItems.length === 0 && (
              <div className="async-state rank-no-match" role="status">
                {t("没有匹配的达人。", "No matching contributors.")}
                <button type="button" onClick={() => { setQuery(""); setFavoritesOnly(false); }}>{t("清除筛选", "Clear filters")}</button>
              </div>
            )}
            {visibleItems.length > 0 && (
              <table className="rank-table">
                <thead><tr>
                  <th scope="col" className="rank-position" aria-label={t("排名", "Rank")}>#</th>
                  <th scope="col" className="rank-person-heading">{t("贡献者", "Contributor")}</th>
                  <th scope="col" className="rank-number rank-score-heading" aria-sort="descending">{t("积分", "Points")}<ChevronDown size={13} aria-hidden="true" /></th>
                  <th scope="col" className="rank-number rank-activity">Commit</th>
                  <th scope="col" className="rank-number rank-activity">PR</th>
                  <th scope="col" className="rank-number rank-activity">Issue</th>
                  <th scope="col" className="rank-favorite-cell" aria-label={t("收藏", "Favorite")}><AppIcon name="star" size={14} /></th>
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
                          aria-label={favorite ? t(`取消收藏 ${item.login}`, `Remove ${item.login} from favorites`) : t(`收藏 ${item.login}`, `Add ${item.login} to favorites`)}
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
                  ? t(`已加载 ${number.format(loadedItems.length)} 人 · 匹配 ${number.format(visibleItems.length)} 人`, `${number.format(loadedItems.length)} loaded · ${number.format(visibleItems.length)} matched`)
                  : t(`已显示 ${number.format(visibleItems.length)} 人`, `${number.format(visibleItems.length)} shown`)}</p>
                {moreError && <p className="rank-more-error" role="alert">{moreError}</p>}
                {hasMore && <Button className="rank-more" variant="outline" disabled={loadingMore} onClick={() => void showMore()}>{loadingMore ? t("正在加载…", "Loading…") : t("显示更多", "Show more")}<ChevronDown size={14} aria-hidden="true" /></Button>}
              </footer>
            )}
          </section>
        </div>
        <OutstandingBoards api={api} />
      </div>
    </div>
  );
}
