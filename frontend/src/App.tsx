import { Link, NavLink, Route, Routes, useLocation } from "react-router";
import type { LeadBoardApiClient } from "./api/client";
import { ContributorDetailPage } from "./pages/ContributorDetailPage";
import { ContributorLeaderboardPage } from "./pages/ContributorLeaderboardPage";
import { ProjectBoardPage } from "./pages/ProjectBoardPage";
import { WebsiteSessionProvider, useWebsiteSession } from "./auth/session";
import { ProjectReviewPage } from "./pages/ProjectReviewPage";
import { IdentityVerificationPage } from "./pages/IdentityVerificationPage";
import { HomePage } from "./pages/HomePage";
import "./enhancements.css";

type IconName = "home" | "grid" | "users" | "user" | "github" | "arrow" | "plus" | "search" | "settings";

export function AppIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2"/><path d="M17 5a3 3 0 0 1 0 6m2 9v-2a6 6 0 0 0-3-5"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    github: <><path d="M9 19c-4.3 1.3-4.3-2-6-2.5m12 5v-3.8a3.3 3.3 0 0 0-.9-2.6c3-.3 6.2-1.5 6.2-6.8a5.3 5.3 0 0 0-1.4-3.7 5 5 0 0 0-.1-3.6s-1.2-.4-3.8 1.4a13 13 0 0 0-7 0C5.4.6 4.2 1 4.2 1a5 5 0 0 0-.1 3.6 5.3 5.3 0 0 0-1.4 3.7c0 5.3 3.2 6.5 6.2 6.8a3.3 3.3 0 0 0-.9 2.6v3.8"/></>,
    arrow: <><path d="m9 18 6-6-6-6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link nav-link-active" : "nav-link";
}

export function App({ api, isMock: _isMock = false }: { api: LeadBoardApiClient; isMock?: boolean }) {
  return <WebsiteSessionProvider><AppContent api={api}/></WebsiteSessionProvider>;
}

function AppContent({ api }: { api: LeadBoardApiClient }) {
  const { session } = useWebsiteSession();
  const location = useLocation();
  const accountUrl = session.authenticated && session.login
    ? `/contributors/${encodeURIComponent(session.login)}`
    : "/join";
  const loginUrl = "/api/v1/auth/github/login?returnTo=/projects";

  return (
    <div className="app-shell dark-shell">
      <header className="topbar">
        <a className="brand" href="https://github.com/swiftgorge5-eng/LeaderBoard" target="_blank" rel="noreferrer" aria-label="LeaderBoard GitHub 仓库">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span className="brand-copy"><strong>LeaderBoard</strong></span>
        </a>
        <nav className="topnav" aria-label="主导航">
          <NavLink className={navClass} to="/" end>首页</NavLink>
          <NavLink className={navClass} to="/projects">项目</NavLink>
          <NavLink className={navClass} to="/contributors">达人榜</NavLink>
          <NavLink className={navClass} to="/join">加入</NavLink>
          {session.authenticated ? <Link className="header-account" to={accountUrl}><AppIcon name="user" size={16}/>{session.login || "我的"}</Link> : <a className="header-login" href={loginUrl}><AppIcon name="github" size={17}/> GitHub 登录</a>}
          {session.authenticated && session.isAdmin && <NavLink className={navClass} to="/admin">管理</NavLink>}
        </nav>
        <div className="mobile-header-actions">
          <Link className="mobile-round-link" to={accountUrl} aria-label="我的">
            {session.authenticated && session.login
              ? <img src={`https://github.com/${encodeURIComponent(session.login)}.png?size=80`} alt="" />
              : <AppIcon name="user" size={20}/>}
          </Link>
          <Link className="mobile-round-link" to="/projects" aria-label="搜索项目"><AppIcon name="search" size={21}/></Link>
          <Link className="mobile-round-link" to="/join" aria-label="加入达人榜"><AppIcon name="plus" size={21}/></Link>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="侧边导航">
          <div className="sidebar-intro"><strong>探索</strong></div>
          <nav className="side-section" aria-label="功能导航">
            <NavLink className={navClass} to="/" end><span className="side-nav-icon"><AppIcon name="home"/></span><span className="side-nav-copy"><strong>首页</strong></span></NavLink>
            <NavLink className={navClass} to="/projects"><span className="side-nav-icon"><AppIcon name="grid"/></span><span className="side-nav-copy"><strong>复旦开源项目</strong></span></NavLink>
            <NavLink className={navClass} to="/contributors"><span className="side-nav-icon"><AppIcon name="users"/></span><span className="side-nav-copy"><strong>开源达人榜</strong></span></NavLink>
            <NavLink className={navClass} to="/join"><span className="side-nav-icon"><AppIcon name="plus"/></span><span className="side-nav-copy"><strong>加入达人榜</strong></span></NavLink>
            <NavLink className={navClass} to={accountUrl}><span className="side-nav-icon"><AppIcon name="user"/></span><span className="side-nav-copy"><strong>我的</strong></span></NavLink>
            {session.authenticated && session.isAdmin && <NavLink className={navClass} to="/admin"><span className="side-nav-icon"><AppIcon name="settings"/></span><span className="side-nav-copy"><strong>管理后台</strong></span></NavLink>}
          </nav>
        </aside>

        <main className="content-shell" id="main-content">
          <Routes>
            <Route path="/" element={<HomePage accountUrl={accountUrl} authenticated={session.authenticated} />} />
            <Route path="/dashboard" element={<HomePage accountUrl={accountUrl} authenticated={session.authenticated} />} />
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
        <NavLink to="/contributors" className={({isActive}) => isActive || location.pathname.startsWith("/contributors/") && !(session.authenticated && location.pathname === accountUrl) ? "mobile-tab mobile-tab-active" : "mobile-tab"}><AppIcon name="users" size={22}/><span>达人</span></NavLink>
        <Link to={accountUrl} className={location.pathname === accountUrl && accountUrl !== "/join" || (accountUrl === "/join" && location.pathname === "/join") ? "mobile-tab mobile-tab-active" : "mobile-tab"}><AppIcon name="user" size={22}/><span>我的</span></Link>
      </nav>
    </div>
  );
}
