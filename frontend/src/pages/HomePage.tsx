import { useCompetitionLabels, useLanguage } from "../state/language";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CampusProjectsResponseSchema, type CampusProject, type ContributorLeaderboardResponse } from "@leadboard/contracts";
import type { LeadBoardApiClient } from "../api/client";
import { AppIcon, ExternalLinkIcon } from "../components/AppIcon";
import { useFilters } from "../state/filters";

type Resource<T> = { status: "loading" } | { status: "error" } | { status: "ready"; items: T[] };
type Contributor = ContributorLeaderboardResponse["items"][number];
const repositoryUrl = "https://github.com/swiftgorge5-eng/LeaderBoard";

export function HomePage({ api, accountUrl, authenticated }: { api: LeadBoardApiClient; accountUrl: string; authenticated: boolean }) {
  const { t } = useLanguage();
  const competition = useCompetitionLabels();
  const { range } = useFilters();
  const [contributors, setContributors] = useState<Resource<Contributor>>({ status: "loading" });
  const [projects, setProjects] = useState<Resource<CampusProject>>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setContributors({ status: "loading" });
    setProjects({ status: "loading" });
    void api.getContributorLeaderboard({ range, metric: "score", limit: 3 }).then(
      result => { if (active) setContributors({ status: "ready", items: result.items }); },
      () => { if (active) setContributors({ status: "error" }); },
    );
    void fetch("/api/v1/projects", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Projects unavailable");
      return CampusProjectsResponseSchema.parse(await response.json());
    }).then(
      result => { if (active) setProjects({ status: "ready", items: result.items }); },
      () => { if (active) setProjects({ status: "error" }); },
    );
    return () => { active = false; controller.abort(); };
  }, [api, range, retry]);

  const navigation = <>
    <Link to="/projects" className="home-work-link"><span className="home-action-icon icon-project"><AppIcon name="repo"/></span><span>{t("复旦开源项目", "Fudan open source projects")}</span><AppIcon name="arrow" size={18}/></Link>
    <Link to="/contributors" className="home-work-link"><span className="home-action-icon icon-leaders"><AppIcon name="trophy"/></span><span>{t("开源达人榜", "Open Source Leaderboard")}</span><AppIcon name="arrow" size={18}/></Link>
    <Link to="/join" className="home-work-link"><span className="home-action-icon icon-join"><AppIcon name="plus"/></span><span>{t("加入达人榜", "Join the leaderboard")}</span><AppIcon name="arrow" size={18}/></Link>
    <Link to={accountUrl} className="home-work-link"><span className="home-action-icon icon-account"><AppIcon name="user"/></span><span>{authenticated ? t("我的档案", "My profile") : t("登录 / 注册", "Sign in / Join")}</span><AppIcon name="arrow" size={18}/></Link>
  </>;

  const loading = <div className="home-loading" role="status" aria-label={t("正在加载", "Loading")}><span/><span/><span/></div>;
  const retryButton = <button className="home-retry" type="button" onClick={() => setRetry(value => value + 1)}>{t("加载失败，点击重试", "Could not load. Try again")}<span aria-hidden="true">↻</span></button>;

  return (
    <div className="page-canvas home-page">
      <section className="home-mobile-work" aria-labelledby="home-work-heading">
        <h2 id="home-work-heading">{t("我的工作", "My workspace")}</h2>
        <nav className="home-work-group" aria-label={t("快捷入口", "Quick links")}>{navigation}</nav>
      </section>

      <section className="home-window" aria-label={t("开源总览", "Open source overview")}>
        <div className="home-window-bar">
          <div className="window-dots" aria-hidden="true"><i/><i/><i/></div>
          <Link to="/">LeaderBoard</Link>
          <a href={repositoryUrl} target="_blank" rel="noreferrer" aria-label={t("查看 GitHub 仓库", "View GitHub repository")}><AppIcon name="github" size={17}/></a>
        </div>
        <div className="home-window-layout">
          <nav className="home-window-nav" aria-label={t("总览导航", "Overview navigation")}>
            <Link className="home-overview-active" to="/"><AppIcon name="home" size={17}/>{t("总览", "Overview")}</Link>
            {navigation}
            <a className="home-source-link" href={repositoryUrl} target="_blank" rel="noreferrer"><AppIcon name="github" size={17}/>GitHub<AppIcon name="external" size={13}/></a>
          </nav>
          <div className="home-live-content">
            <section className="home-panel home-contributors">
              <div className="home-panel-heading"><h2><Link to="/contributors">{t("达人榜", "Leaderboard")}<AppIcon name="arrow" size={17}/></Link></h2><Link className="home-panel-action" to="/join"><AppIcon name="plus" size={14}/>{t("加入", "Join")}</Link></div>
              {range==='competition'&&<p className="filter-caption">{t("比赛周期：", "Competition period: ")}{competition.dates}</p>}
              <div className="home-data-group">
                {contributors.status === "loading" ? loading : contributors.status === "error" ? retryButton : contributors.items.length === 0 ? <Link className="home-empty-link" to="/join">{t("成为第一位达人", "Be the first to join")}<AppIcon name="arrow" size={18}/></Link> : contributors.items.slice(0, 3).map(item => (
                  <Link className={`home-contributor home-rank-${item.rank}`} key={item.login} to={`/contributors/${encodeURIComponent(item.login)}`}>
                    <span className="home-rank">{String(item.rank).padStart(2, "0")}</span>
                    <img src={item.avatarUrl ?? `https://github.com/${encodeURIComponent(item.login)}.png?size=80`} width="36" height="36" alt="" loading="lazy"/>
                    <strong>{item.login}</strong>
                    <span className="home-score">{item.score ?? 0}<small>{t("分", "pts")}</small></span>
                    <AppIcon name="arrow" size={16}/>
                  </Link>
                ))}
              </div>
              <Link className="home-view-all" to="/contributors">{t("查看达人榜", "See the leaderboard")}<span aria-hidden="true">↗</span></Link>
            </section>
            <section className="home-panel home-projects">
              <div className="home-panel-heading"><h2><Link to="/projects">{t("复旦开源项目", "Fudan open source projects")}<AppIcon name="arrow" size={17}/></Link></h2>{projects.status === "ready" && <Link className="home-panel-count" to="/projects">{projects.items.length}</Link>}</div>
              <div className="home-data-group">
                {projects.status === "loading" ? loading : projects.status === "error" ? retryButton : projects.items.length === 0 ? <Link className="home-empty-link" to="/projects">{t("提交开源项目", "Suggest a project")}<AppIcon name="arrow" size={18}/></Link> : projects.items.slice(0, 3).map(project => (
                  <a className="home-project" key={project.repo} href={project.url} target="_blank" rel="noreferrer">
                    <span className="home-project-icon"><ExternalLinkIcon href={project.url} size={18}/></span><span className="home-project-copy"><strong>{project.name}</strong><small>{project.repo}</small></span><AppIcon name="external" size={14}/>
                  </a>
                ))}
              </div>
              <Link className="home-view-all" to="/projects">{t("浏览全部项目", "Browse all projects")}<span aria-hidden="true">↗</span></Link>
            </section>
          </div>
        </div>
      </section>
      <a className="home-mobile-repository" href={repositoryUrl} target="_blank" rel="noreferrer"><AppIcon name="github" size={27}/><span><small>swiftgorge5-eng</small><strong>LeaderBoard</strong></span><AppIcon name="arrow" size={19}/></a>
    </div>
  );
}
