import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CampusProjectsResponseSchema, type CampusProject, type ContributorLeaderboardResponse } from "@leadboard/contracts";
import type { LeadBoardApiClient } from "../api/client";
import { AppIcon } from "../components/AppIcon";
import { useFilters } from "../state/filters";

type Resource<T> = { status: "loading" } | { status: "error" } | { status: "ready"; items: T[] };
type Contributor = ContributorLeaderboardResponse["items"][number];
const repositoryUrl = "https://github.com/swiftgorge5-eng/LeaderBoard";

export function HomePage({ api, accountUrl, authenticated }: { api: LeadBoardApiClient; accountUrl: string; authenticated: boolean }) {
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
    <Link to="/projects" className="home-work-link"><span className="home-action-icon icon-project"><AppIcon name="repo"/></span><span>复旦开源项目</span><AppIcon name="arrow" size={18}/></Link>
    <Link to="/contributors" className="home-work-link"><span className="home-action-icon icon-leaders"><AppIcon name="trophy"/></span><span>开源达人榜</span><AppIcon name="arrow" size={18}/></Link>
    <Link to="/join" className="home-work-link"><span className="home-action-icon icon-join"><AppIcon name="plus"/></span><span>加入达人榜</span><AppIcon name="arrow" size={18}/></Link>
    <Link to={accountUrl} className="home-work-link"><span className="home-action-icon icon-account"><AppIcon name="user"/></span><span>{authenticated ? "我的档案" : "登录 / 注册"}</span><AppIcon name="arrow" size={18}/></Link>
  </>;

  const loading = <div className="home-loading" role="status" aria-label="正在加载"><span/><span/><span/></div>;
  const retryButton = <button className="home-retry" type="button" onClick={() => setRetry(value => value + 1)}>加载失败，点击重试 <span aria-hidden="true">↻</span></button>;

  return (
    <div className="page-canvas home-page">
      <section className="home-hero">
        <Link to="/projects" className="home-eyebrow"><AppIcon name="repo" size={13}/>复旦开源<AppIcon name="arrow" size={13}/></Link>
        <h1>Leader<span>Board.</span></h1>
        <div className="home-hero-actions">
          <Link to="/join" className="primary-button">加入达人榜 <span aria-hidden="true">↗</span></Link>
          <Link to="/projects" className="home-hero-secondary">浏览开源项目 <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="home-mobile-work" aria-labelledby="home-work-heading">
        <h1 id="home-work-heading">我的工作</h1>
        <nav className="home-work-group" aria-label="快捷入口">{navigation}</nav>
      </section>

      <section className="home-window" aria-label="开源总览">
        <div className="home-window-bar">
          <div className="window-dots" aria-hidden="true"><i/><i/><i/></div>
          <Link to="/">LeaderBoard</Link>
          <a href={repositoryUrl} target="_blank" rel="noreferrer" aria-label="查看 GitHub 仓库"><AppIcon name="github" size={17}/></a>
        </div>
        <div className="home-window-layout">
          <nav className="home-window-nav" aria-label="总览导航">
            <Link className="home-overview-active" to="/"><AppIcon name="home" size={17}/>总览</Link>
            {navigation}
            <a className="home-source-link" href={repositoryUrl} target="_blank" rel="noreferrer"><AppIcon name="github" size={17}/>GitHub<AppIcon name="external" size={13}/></a>
          </nav>
          <div className="home-live-content">
            <section className="home-panel home-contributors">
              <div className="home-panel-heading"><h2><Link to="/contributors">达人榜<AppIcon name="arrow" size={17}/></Link></h2><Link className="home-panel-action" to="/join"><AppIcon name="plus" size={14}/>加入</Link></div>
              <div className="home-data-group">
                {contributors.status === "loading" ? loading : contributors.status === "error" ? retryButton : contributors.items.length === 0 ? <Link className="home-empty-link" to="/join">成为第一位达人 <AppIcon name="arrow" size={18}/></Link> : contributors.items.slice(0, 3).map(item => (
                  <Link className={`home-contributor home-rank-${item.rank}`} key={item.login} to={`/contributors/${encodeURIComponent(item.login)}`}>
                    <span className="home-rank">{String(item.rank).padStart(2, "0")}</span>
                    <img src={item.avatarUrl ?? `https://github.com/${encodeURIComponent(item.login)}.png?size=80`} width="36" height="36" alt="" loading="lazy"/>
                    <strong>{item.login}</strong>
                    <span className="home-score">{item.score ?? 0}<small>分</small></span>
                    <AppIcon name="arrow" size={16}/>
                  </Link>
                ))}
              </div>
              <Link className="home-view-all" to="/contributors">查看达人榜 <span aria-hidden="true">↗</span></Link>
            </section>
            <section className="home-panel home-projects">
              <div className="home-panel-heading"><h2><Link to="/projects">复旦开源项目<AppIcon name="arrow" size={17}/></Link></h2>{projects.status === "ready" && <Link className="home-panel-count" to="/projects">{projects.items.length}</Link>}</div>
              <div className="home-data-group">
                {projects.status === "loading" ? loading : projects.status === "error" ? retryButton : projects.items.length === 0 ? <Link className="home-empty-link" to="/projects">提交开源项目 <AppIcon name="arrow" size={18}/></Link> : projects.items.slice(0, 3).map(project => (
                  <a className="home-project" key={project.repo} href={project.url} target="_blank" rel="noreferrer">
                    <span className="home-project-icon"><AppIcon name="repo" size={18}/></span><span className="home-project-copy"><strong>{project.name}</strong><small>{project.repo}</small></span><AppIcon name="external" size={14}/>
                  </a>
                ))}
              </div>
              <Link className="home-view-all" to="/projects">浏览全部项目 <span aria-hidden="true">↗</span></Link>
            </section>
          </div>
        </div>
      </section>
      <a className="home-mobile-repository" href={repositoryUrl} target="_blank" rel="noreferrer"><AppIcon name="github" size={27}/><span><small>swiftgorge5-eng</small><strong>LeaderBoard</strong></span><AppIcon name="arrow" size={19}/></a>
    </div>
  );
}
