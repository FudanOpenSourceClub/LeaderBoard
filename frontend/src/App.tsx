import { Link, NavLink, Route, Routes } from "react-router";
import type { LeadBoardApiClient } from "./api/client";
import { ContributorDetailPage } from "./pages/ContributorDetailPage";
import { ContributorLeaderboardPage } from "./pages/ContributorLeaderboardPage";
import { ProjectBoardPage } from "./pages/ProjectBoardPage";
import { IdentityVerificationPage } from "./pages/IdentityVerificationPage";
import "./enhancements.css";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link nav-link-active" : "nav-link";
}

export function App({ api, isMock: _isMock = false }: { api: LeadBoardApiClient; isMock?: boolean }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="https://github.com/swiftgorge5-eng/LeadBoard" aria-label="LeaderBoard GitHub 仓库">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span className="brand-copy">
            <strong>LeaderBoard</strong>
            <small>复旦开源贡献可视化</small>
          </span>
        </a>

        <nav className="topnav" aria-label="主导航">
          <NavLink className={navClass} to="/projects">校内开源项目</NavLink>
          <NavLink className={navClass} to="/contributors">校内开源达人</NavLink>
          <NavLink className={navClass} to="/join">加入贡献榜</NavLink>
        </nav>

      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="侧边导航">
          <div className="side-section">
            <p className="side-label">校内看板</p>
            <NavLink className={navClass} to="/projects"><span aria-hidden="true">◇</span> 校内开源项目</NavLink>
            <NavLink className={navClass} to="/contributors"><span aria-hidden="true">🏆</span> 校内开源达人</NavLink>
          </div>
          <div className="side-section">
            <p className="side-label">社区</p>
            <NavLink className={navClass} to="/join"><span aria-hidden="true">✦</span> 加入贡献榜</NavLink>
          </div>
        </aside>

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
            <span>LeaderBoard · Fudan Open Source</span>
            <span>数据来自公开 GitHub 活动</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
