import { useEffect, useState } from "react";
import { TimeRangeSchema, type ContributorDetail } from "@leadboard/contracts";
import { ArrowLeft, ArrowUpRight, Check, Copy, LogOut } from "lucide-react";
import { Link, useParams } from "react-router";
import type { LeadBoardApiClient } from "../api/client";
import { useWebsiteSession } from "../auth/session";
import { AppIcon } from "../components/AppIcon";
import { EmptyState, ErrorState, LoadingState } from "../components/AsyncStates";
import { ContributionProfile } from "../components/ContributionProfile";
import { ProfileActivity } from "../components/ProfileActivity";
import { useLocalFavorites } from "../lib/favorites";
import { useFilters } from "../state/filters";
import { useCompetitionLabels, useLanguage } from "../state/language";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: ContributorDetail };

export function ContributorDetailPage({ api }: { api: LeadBoardApiClient }) {
  const { locale, t } = useLanguage();
  const competition = useCompetitionLabels();
  const { username = "" } = useParams();
  const { session } = useWebsiteSession();
  const isSelf = session.authenticated && session.login.toLowerCase() === username.toLowerCase();
  const { range, setRange } = useFilters();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [signingOut, setSigningOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const favorites = useLocalFavorites("contributors");

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void api.getContributorDetail(username, range).then(
      (detail) => { if (active) setState({ status: "ready", detail }); },
      (error: unknown) => {
        if (active) setState({ status: "error", message: error instanceof Error ? error.message : t("贡献者详情加载失败", "Could not load this profile") });
      },
    );
    return () => { active = false; };
  }, [api, username, range, retry, t]);

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  async function copyProfileLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  async function signOut() {
    if (!isSelf || !session.authenticated || signingOut) return;
    setSigningOut(true);
    setLogoutFailed(false);
    try {
      const response = await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": session.csrfToken },
      });
      if (response.status !== 204) throw new Error("Logout failed");
      window.location.replace("/login");
    } catch {
      setLogoutFailed(true);
      setSigningOut(false);
    }
  }

  const detail = state.status === "ready" ? state.detail : null;
  const login = detail?.login ?? username;
  const isFavorite = favorites.isFavorite(username);
  const number = new Intl.NumberFormat(locale);
  const copyLabel = copyStatus === "copied" ? t("已复制链接", "Link copied") : t("复制档案链接", "Copy profile link");
  const repositoryMetrics = [
    { key: "commits", label: "Commit" },
    { key: "prs", label: "PR" },
    { key: "issues", label: "Issue" },
    { key: "total", label: t("总活动", "Activity") },
    { key: "score", label: t("积分", "Points") },
  ] as const;

  return (
    <div className="contributor-page">
      <Link className="profile-back" to="/contributors">
        <ArrowLeft size={16} aria-hidden="true" />{t("贡献者榜单", "Leaderboard")}
      </Link>
      <div className="contributor-layout">
        <aside className="profile-identity">
          <div className="profile-identity-heading">
            {detail?.avatarUrl
              ? <img className="account-avatar" src={detail.avatarUrl} alt="" />
              : <span className="account-avatar account-avatar-placeholder" aria-hidden="true">{login.slice(0, 1).toUpperCase()}</span>}
            <h1>{login}</h1>
          </div>
          <a className="profile-github" href={`https://github.com/${encodeURIComponent(login)}`} target="_blank" rel="noreferrer">
            <AppIcon name="github" size={17} />
            <span>{t("GitHub 主页", "GitHub profile")}</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
          {isSelf && session.registered && (
            <Link className="profile-apply" to="/profile/outstanding">
              <AppIcon name="trophy" size={17} />
              <span>{t("申请 Outstanding", "Apply for Outstanding")}</span>
              <AppIcon name="arrow" size={15} />
            </Link>
          )}
          {isSelf && (session.canTag || session.isAdmin) && (
            <Link className="profile-admin-link" to="/admin">{t("勋章申请审核与管理", "Review badge applications")}</Link>
          )}
          <div className="profile-tools">
            <button type="button" aria-label={t("收藏档案", "Favorite profile")} title={t("收藏档案", "Favorite profile")} aria-pressed={isFavorite} onClick={() => favorites.toggle(username)}>
              <AppIcon name="star" size={17} />
            </button>
            <button type="button" aria-label={copyLabel} title={copyLabel} onClick={() => void copyProfileLink()}>
              {copyStatus === "copied" ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
              {copyStatus === "copied" ? t("已复制", "Copied") : t("复制链接", "Copy link")}
            </button>
            {isSelf && <button className="profile-signout" type="button" disabled={signingOut} onClick={() => void signOut()}>
              <LogOut size={16} aria-hidden="true" />{signingOut ? t("正在退出…", "Signing out…") : t("退出登录", "Sign out")}
            </button>}
          </div>
          {copyStatus !== "idle" && <p className="profile-feedback" role="status">
            {copyStatus === "copied" ? t("已复制档案链接", "Profile link copied") : t("复制失败，请从地址栏复制。", "Copy failed. Use your browser’s address bar to copy the link.")}
          </p>}
          {logoutFailed && <p className="profile-feedback" role="alert">{t("退出登录失败，请重试。", "Could not sign out. Please try again.")}</p>}
        </aside>

        <section className="profile-overview" aria-labelledby="profile-overview-title">
          <div className="profile-section-header">
            <div>
              <h2 id="profile-overview-title">{t("贡献概览", "Contribution overview")}</h2>
              {range === "competition" && <p>{competition.dates}{t(" · 北京时间", " · Beijing time")}</p>}
            </div>
            <select className="profile-select" aria-label={t("时间范围", "Time range")} value={range} onChange={(event) => setRange(TimeRangeSchema.parse(event.target.value))}>
              <option value="competition">{t("比赛周期", "Competition")}</option>
              <option value="7d">{t("最近 7 天", "Last 7 days")}</option>
              <option value="30d">{t("最近 30 天", "Last 30 days")}</option>
              <option value="90d">{t("最近 90 天", "Last 90 days")}</option>
              <option value="all">{t("全部历史", "All time")}</option>
            </select>
          </div>
          {state.status === "loading" && <LoadingState label={t("正在加载贡献者详情…", "Loading contributor profile…")} />}
          {state.status === "error" && <ErrorState message={state.message} onRetry={() => setRetry((value) => value + 1)} />}
          {detail && (
            <>
              <ProfileActivity detail={detail} />
              <section className="profile-surface profile-repositories" aria-labelledby="profile-repositories-title">
                <h3 id="profile-repositories-title">{t("仓库贡献", "Repository contributions")}</h3>
                {detail.repositories.length === 0 ? <EmptyState label={t("当前时间范围内没有仓库活动", "No repository activity in this period")} /> : (
                  <div className="profile-table-wrap" tabIndex={0} role="region" aria-labelledby="profile-repositories-title">
                    <table className="profile-table" role="table" aria-labelledby="profile-repositories-title">
                      <thead role="rowgroup"><tr role="row">
                        <th scope="col" role="columnheader">{t("仓库", "Repository")}</th>
                        <th scope="col" role="columnheader">{t("分组", "Group")}</th>
                        {repositoryMetrics.map(({ key, label }) => <th scope="col" role="columnheader" key={key}>{label}</th>)}
                      </tr></thead>
                      <tbody role="rowgroup">{detail.repositories.map((item) => (
                        <tr key={item.fullName} role="row">
                          <th className="profile-repo-name" scope="row" role="rowheader"><AppIcon name="repo" size={15} /><span>{item.fullName}</span></th>
                          <td className="profile-repo-group" role="cell"><span className="profile-group">{item.group}</span></td>
                          {repositoryMetrics.map(({ key, label }) => (
                            <td key={key} role="cell">
                              <span className="profile-repo-stat-label" aria-hidden="true">{label}</span>
                              {number.format(item[key] ?? 0)}
                            </td>
                          ))}
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </section>
              <ContributionProfile detail={detail} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
