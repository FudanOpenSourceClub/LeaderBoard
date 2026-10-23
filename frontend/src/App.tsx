import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router";
import type { LeadBoardApiClient } from "./api/client";
import { ContributorDetailPage } from "./pages/ContributorDetailPage";
import { ContributorLeaderboardPage } from "./pages/ContributorLeaderboardPage";
import { ProjectBoardPage } from "./pages/ProjectBoardPage";
import { WebsiteSessionProvider, useWebsiteSession } from "./auth/session";
import { ProjectReviewPage } from "./pages/ProjectReviewPage";
import { IdentityVerificationPage } from "./pages/IdentityVerificationPage";
import { HomePage } from "./pages/HomePage";
import { AppIcon } from "./components/AppIcon";


function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link nav-link-active" : "nav-link";
}

export function App({ api, isMock: _isMock = false }: { api: LeadBoardApiClient; isMock?: boolean }) {
  return <WebsiteSessionProvider><AppContent api={api}/></WebsiteSessionProvider>;
}

function AppContent({ api }: { api: LeadBoardApiClient }) {
  const { session } = useWebsiteSession();
  const location = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [location.pathname]);
  const accountUrl = session.authenticated && session.login
    ? `/contributors/${encodeURIComponent(session.login)}`
    : "/join";
  const loginUrl = "/api/v1/auth/github/login?returnTo=/projects";
  const isHome = location.pathname === "/" || location.pathname === "/dashboard";

  return (
    <div className={`app-shell dark-shell${isHome ? " home-shell" : ""}`}>
      <a className="skip-link" href="#main-content">跳至内容</a>
      <header className="topbar">
        <a className="brand" href="https://github.com/swiftgorge5-eng/LeaderBoard" target="_blank" rel="noreferrer" aria-label="LeaderBoard GitHub 仓库">
          <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 5v14h14M11 5v8h8" stroke="currentColor" strokeWidth="3" strokeLinecap="square"/></svg></span>
          <span className="brand-copy"><strong>LeaderBoard</strong></span>
        </a>
        <nav className="topnav" aria-label="主导航">
          <NavLink className={navClass} to="/" end>首页</NavLink>
          <NavLink className={navClass} to="/projects">项目</NavLink>
          <NavLink className={navClass} to="/contributors">达人榜</NavLink>
          {session.authenticated ? <Link className="header-account" to={accountUrl}><AppIcon name="user" size={16}/>{session.login || "我的"}</Link> : <a className="header-login" href={loginUrl}><AppIcon name="github" size={17}/> GitHub 登录</a>}
          {session.authenticated && session.isAdmin && <NavLink className={navClass} to="/admin">管理</NavLink>}
        </nav>
        <div className="mobile-header-actions">
          <Link className="mobile-round-link" to={accountUrl} aria-label="我的">
            {session.authenticated && session.login
              ? <img src={`https://github.com/${encodeURIComponent(session.login)}.png?size=80`} alt="" />
              : <AppIcon name="user" size={20}/>}
          </Link>
          <Link className="mobile-home-brand" to="/">LeaderBoard</Link>
          <Link className="mobile-round-link" to="/join" aria-label="加入达人榜"><AppIcon name="plus" size={21}/></Link>
          <Link className="mobile-round-link" to="/projects?search=1" aria-label="搜索项目"><AppIcon name="search" size={21}/></Link>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="侧边导航">
          <nav className="side-section" aria-label="功能导航">
            <NavLink className={navClass} to="/" end><span className="side-nav-icon"><AppIcon name="home"/></span><span className="side-nav-copy"><strong>首页</strong></span></NavLink>
            <NavLink className={navClass} to="/projects"><span className="side-nav-icon"><AppIcon name="grid"/></span><span className="side-nav-copy"><strong>复旦开源项目</strong></span></NavLink>
            <NavLink className={navClass} to="/contributors"><span className="side-nav-icon"><AppIcon name="users"/></span><span className="side-nav-copy"><strong>开源达人榜</strong></span></NavLink>
            <NavLink className={navClass} to="/join"><span className="side-nav-icon"><AppIcon name="plus"/></span><span className="side-nav-copy"><strong>加入达人榜</strong></span></NavLink>
            <NavLink className={navClass} to={accountUrl}><span className="side-nav-icon"><AppIcon name="user"/></span><span className="side-nav-copy"><strong>我的</strong></span></NavLink>
            {session.authenticated && session.isAdmin && <NavLink className={navClass} to="/admin"><span className="side-nav-icon"><AppIcon name="settings"/></span><span className="side-nav-copy"><strong>管理后台</strong></span></NavLink>}
          </nav>
        </aside>

        <main className="content-shell" id="main-content" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<HomePage api={api} accountUrl={accountUrl} authenticated={session.authenticated} />} />
            <Route path="/dashboard" element={<HomePage api={api} accountUrl={accountUrl} authenticated={session.authenticated} />} />
            <Route path="/projects" element={<ProjectBoardPage />} />
            <Route path="/contributors" element={<ContributorLeaderboardPage api={api} />} />
            <Route path="/contributors/:username" element={<ContributorDetailPage api={api} />} />
            <Route path="/admin" element={<ProjectReviewPage />} />
            <Route path="/join" element={<IdentityVerificationPage />} />
            <Route path="*" element={<section className="not-found"><h1>页面不存在</h1><Link to="/">返回首页</Link></section>} />
          </Routes>
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="底部导航">
        <NavLink to="/" end className={({isActive}) => isActive ? "mobile-tab mobile-tab-active" : "mobile-tab"}><AppIcon name="home" size={22}/><span>首页</span></NavLink>
        <NavLink to="/projects" className={({isActive}) => isActive ? "mobile-tab mobile-tab-active" : "mobile-tab"}><AppIcon name="grid" size={22}/><span>项目</span></NavLink>
        <NavLink to="/contributors" className={() => location.pathname === "/contributors" || (location.pathname.startsWith("/contributors/") && location.pathname !== accountUrl) ? "mobile-tab mobile-tab-active" : "mobile-tab"}><AppIcon name="users" size={22}/><span>达人</span></NavLink>
        <Link to={accountUrl} className={location.pathname === accountUrl ? "mobile-tab mobile-tab-active" : "mobile-tab"}><AppIcon name="user" size={22}/><span>我的</span></Link>
      </nav>
    </div>
  );
}
