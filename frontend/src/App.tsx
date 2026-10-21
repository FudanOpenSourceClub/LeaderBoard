import { Link, NavLink, Route, Routes } from "react-router";
import type { LeadBoardApiClient } from "./api/client";
import { ContributorDetailPage } from "./pages/ContributorDetailPage";
import { ContributorLeaderboardPage } from "./pages/ContributorLeaderboardPage";
import { ProjectBoardPage } from "./pages/ProjectBoardPage";
import { IdentityVerificationPage } from "./pages/IdentityVerificationPage";
import "./enhancements.css";
import "./premium.css";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link nav-link-active" : "nav-link";
}

export function App({ api, isMock: _isMock = false }: { api: LeadBoardApiClient; isMock?: boolean }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/projects" aria-label="LeadBoard 首页">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span className="brand-copy">
            <strong>LeadBoard</strong>
            <small>Fudan Open Source</small>
          </span>
        </Link>
        <nav className="topnav" aria-label="主导航">
          <NavLink className={navClass} to="/projects">校内开源项目</NavLink>
          <NavLink className={navClass} to="/contributors">开源达人</NavLink>
          <NavLink className={navClass} to="/join">加入贡献榜</NavLink>
        </nav>
        <a className="header-github" href="https://github.com/swiftgorge5-eng/LeadBoard" target="_blank" rel="noreferrer">
          GitHub <span aria-hidden="true">↗</span>
        </a>
      </header>
      <div className="workspace">
        <div className="content-shell">
          <Routes>
            <Route path="/" element={<ProjectBoardPage />} />
            <Route path="/dashboard" element={<ProjectBoardPage />} />
            <Route path="/projects" element={<ProjectBoardPage />} />
            <Route path="/contributors" element={<ContributorLeaderboardPage api={api} />} />
            <Route path="/contributors/:username" element={<ContributorDetailPage api={api} />} />
            <Route path="/join" element={<IdentityVerificationPage />} />
            <Route path="*" element={<section className="not-found"><h1>页面不存在</h1><Link to="/projects">返回校内开源项目</Link></section>} />
          </Routes>
          <footer>
            <span>LeadBoard · Fudan Open Source</span>
            <span>基于公开 GitHub 活动</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
