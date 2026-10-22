import { Link, NavLink, Route, Routes } from "react-router";
import type { LeadBoardApiClient } from "./api/client";
import { ContributorDetailPage } from "./pages/ContributorDetailPage";
import { ContributorLeaderboardPage } from "./pages/ContributorLeaderboardPage";
import { ProjectBoardPage } from "./pages/ProjectBoardPage";
import { WebsiteSessionProvider,useWebsiteSession } from "./auth/session";
import { ProjectReviewPage } from "./pages/ProjectReviewPage";
import { IdentityVerificationPage } from "./pages/IdentityVerificationPage";
import "./enhancements.css";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link nav-link-active" : "nav-link";
}

function GitHubIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 19c-4.3 1.3-4.3-2-6-2.5m12 5v-3.8a3.3 3.3 0 0 0-.9-2.6c3-.3 6.2-1.5 6.2-6.8a5.3 5.3 0 0 0-1.4-3.7 5 5 0 0 0-.1-3.6s-1.2-.4-3.8 1.4a13 13 0 0 0-7 0C5.4.6 4.2 1 4.2 1a5 5 0 0 0-.1 3.6 5.3 5.3 0 0 0-1.4 3.7c0 5.3 3.2 6.5 6.2 6.8a3.3 3.3 0 0 0-.9 2.6v3.8" /></svg>;
}

export function App({ api, isMock: _isMock = false }: { api: LeadBoardApiClient; isMock?: boolean }) {
  return <WebsiteSessionProvider><AppContent api={api}/></WebsiteSessionProvider>;
}
function AppContent({api}:{api:LeadBoardApiClient}){
  const {session}=useWebsiteSession();
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="https://github.com/swiftgorge5-eng/LeaderBoard" aria-label="LeaderBoard GitHub 仓库">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span className="brand-copy">
            <strong>LeaderBoard</strong>
            <small>复旦开源贡献可视化</small>
          </span>
        </a>

        <nav className="topnav" aria-label="主导航">
          <NavLink className={navClass} to="/projects">复旦开源项目</NavLink>
          <NavLink className={navClass} to="/contributors">复旦开源达人</NavLink>
          <NavLink className={navClass} to="/join">加入达人榜</NavLink>
          {session.authenticated?<span className="nav-link">{session.login}</span>:<a className="nav-link github-nav-link" href="/api/v1/auth/github/login?returnTo=/projects"><GitHubIcon />GitHub 登录</a>}
          {session.authenticated&&session.isAdmin&&<NavLink className={navClass} to="/admin">管理后台</NavLink>}
        </nav>

      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="侧边导航">
          <div className="sidebar-intro">
            <span>FUDAN OPEN SOURCE</span>
            <strong>探索复旦开源</strong>
            <p>发现项目，认识贡献者。</p>
          </div>
          <div className="side-section">
            <p className="side-label">发现</p>
            <NavLink className={navClass} to="/projects">
              <span className="side-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
                  <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
                  <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
                  <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
                </svg>
              </span>
              <span className="side-nav-copy"><strong>复旦开源项目</strong><small>发现优质开源项目</small></span>
              <span className="side-nav-arrow" aria-hidden="true">↗</span>
            </NavLink>
            <NavLink className={navClass} to="/contributors">
              <span className="side-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="7" r="3.2" />
                  <path d="M5.5 20v-2a6.5 6.5 0 0 1 13 0v2" />
                  <path d="m18.5 4.8 1.3.4.4 1.3-.4 1.3-1.3.4-1.3-.4-.4-1.3.4-1.3z" />
                </svg>
              </span>
              <span className="side-nav-copy"><strong>复旦开源达人</strong><small>认识活跃贡献者</small></span>
              <span className="side-nav-arrow" aria-hidden="true">↗</span>
            </NavLink>
          </div>
          <div className="side-section">
            <p className="side-label">参与</p>
            <NavLink className={navClass} to="/join">
              <span className="side-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M8 12h8m-3.5-3.5L16 12l-3.5 3.5" />
                </svg>
              </span>
              <span className="side-nav-copy"><strong>加入达人榜</strong><small>展示你的开源贡献</small></span>
              <span className="side-nav-arrow" aria-hidden="true">↗</span>
            </NavLink>
            {session.authenticated ? <div className="nav-link sidebar-account"><span className="side-nav-icon"><GitHubIcon /></span><span className="side-nav-copy"><strong>{session.login}</strong><small>已登录 GitHub</small></span></div> : (
              <a className="nav-link" href="/api/v1/auth/github/login?returnTo=/projects">
                <span className="side-nav-icon"><GitHubIcon /></span>
                <span className="side-nav-copy"><strong>GitHub 登录</strong><small>使用已绑定的账号登录</small></span>
                <span className="side-nav-arrow" aria-hidden="true">↗</span>
              </a>
            )}
            {session.authenticated && session.isAdmin && <NavLink className={navClass} to="/admin"><span className="side-nav-icon" aria-hidden="true">⚙</span><span className="side-nav-copy"><strong>管理后台</strong><small>审核仓库申请</small></span></NavLink>}
          </div>
        </aside>

        <div className="content-shell">
          <Routes>
            <Route path="/" element={<ProjectBoardPage />} />
            <Route path="/dashboard" element={<ProjectBoardPage />} />
            <Route path="/projects" element={<ProjectBoardPage />} />
            <Route path="/contributors" element={<ContributorLeaderboardPage api={api} />} />
            <Route path="/contributors/:username" element={<ContributorDetailPage api={api} />} />
            <Route path="/admin" element={<ProjectReviewPage />} />
            <Route path="/join" element={<IdentityVerificationPage />} />
            <Route path="*" element={<section className="not-found"><h1>页面不存在</h1><Link to="/projects">返回复旦开源项目</Link></section>} />
          </Routes>

          <footer>
            <span>LeaderBoard · Fudan Open Source</span>
            <span>数据来自公开 GitHub 活动</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
