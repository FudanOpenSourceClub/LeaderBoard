import { useEffect } from "react";
import { Link, Navigate, NavLink, Route, Routes, matchPath, useLocation } from "react-router";
import type { LeadBoardApiClient } from "./api/client";
import { ContributorDetailPage } from "./pages/ContributorDetailPage";
import { ContributorLeaderboardPage } from "./pages/ContributorLeaderboardPage";
import { ProjectBoardPage } from "./pages/ProjectBoardPage";
import { WebsiteSessionProvider, useWebsiteSession } from "./auth/session";
import { ProjectReviewPage } from "./pages/ProjectReviewPage";
import { IdentityVerificationPage } from "./pages/IdentityVerificationPage";
import { HomePage } from "./pages/HomePage";
import { HomeHero } from "./components/HomeHero";
import { SiteHeader } from "./components/SiteHeader";
import { AppIcon } from "./components/AppIcon";
import { LoginPage } from "./pages/LoginPage";
import { OutstandingApplicationPage } from "./pages/OutstandingApplicationPage";
import { LanguageProvider, useLanguage } from "./state/language";


function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-link nav-link-active" : "nav-link";
}

export function App({ api, isMock: _isMock = false }: { api: LeadBoardApiClient; isMock?: boolean }) {
  return <LanguageProvider><WebsiteSessionProvider><AppContent api={api}/></WebsiteSessionProvider></LanguageProvider>;
}

function AppContent({ api }: { api: LeadBoardApiClient }) {
  const { t } = useLanguage();
  const { session, loading } = useWebsiteSession();
  const location = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [location.pathname]);
  const registered = session.authenticated && session.registered;
  const profileLogin = session.authenticated && (session.registered || session.isAdmin || session.canTag)
    ? session.login : null;
  const accountUrl = profileLogin
    ? `/contributors/${encodeURIComponent(profileLogin)}`
    : "/profile";
  const isOutstandingApplication = matchPath("/profile/outstanding", location.pathname) !== null;
  const isContributorProfile = matchPath("/contributors/:username", location.pathname) !== null;
  const isProfileLayout = isContributorProfile || isOutstandingApplication;
  const isAccount = matchPath(accountUrl, location.pathname) !== null || (registered && isOutstandingApplication);
  const isContributorSection = !isAccount && matchPath("/contributors/*", location.pathname) !== null;
  const isJoin = matchPath("/join", location.pathname) !== null;
  const isProfile = matchPath("/profile", location.pathname) !== null;
  const isLogin = matchPath("/login", location.pathname) !== null;
  const isProjects = matchPath("/projects", location.pathname) !== null;
  const isRanking = matchPath("/contributors", location.pathname) !== null;
  const isAdminPage = matchPath("/admin", location.pathname) !== null;
  const wideSection = isProfile ? "registration" : isProjects ? "projects" : isProfileLayout ? "profile" : isRanking ? "ranking" : isAdminPage ? "admin" : null;
  const loginReturn = isLogin
    ? new URLSearchParams(location.search).get("returnTo") ?? "/"
    : (isProfile || isOutstandingApplication) ? "/join" : location.pathname + location.search;
  const returnQuery = "?returnTo=" + encodeURIComponent(loginReturn);
  const isHome = location.pathname === "/" || location.pathname === "/dashboard";

  if(loading)return <main className="login-gate" role="status">{t("正在确认登录状态…", "Checking sign-in status…")}</main>;
  // Keep the existing OAuth callback and bookmarked /join links working.
  if (isJoin) return <Navigate to={{ pathname: registered ? accountUrl : "/profile", search: registered ? "" : location.search }} replace />;

  const header = <SiteHeader profileLogin={profileLogin} accountUrl={accountUrl} isAccount={isAccount} loginPageUrl={"/login" + returnQuery} isContributorSection={isContributorSection} />;
  if (!session.authenticated && isHome) return (
    <div className="app-shell dark-shell home-shell">
      <a className="skip-link" href="#main-content">{t("跳至内容", "Skip to content")}</a>
      {header}
      <main id="main-content" tabIndex={-1}><HomeHero startedHref="/profile" /></main>
    </div>
  );

  if (!session.authenticated) return (
    <div className={isProfile ? "app-shell dark-shell registration-shell" : "app-shell dark-shell login-shell"}>
      {header}
      {isProfile ? (
        <main className="registration-main" id="main-content"><IdentityVerificationPage /></main>
      ) : (
        <LoginPage githubLoginUrl={"/api/v1/auth/github/login" + returnQuery} />
      )}
    </div>
  );

  return (
    <div className={`app-shell dark-shell${isHome ? " home-shell" : wideSection ? ` ${wideSection}-shell` : ""}`}>
      <a className="skip-link" href="#main-content">{t("跳至内容", "Skip to content")}</a>
      {header}
      <div className={wideSection ? `workspace ${wideSection}-workspace` : "workspace"}>
        {!wideSection && <aside className="sidebar" aria-label={t("侧边导航", "Sidebar")}>
          <nav className="side-section" aria-label={t("功能导航", "Section navigation")}>
            <NavLink className={navClass} to="/" end><span className="side-nav-icon"><AppIcon name="home"/></span><span className="side-nav-copy"><strong>{t("首页", "Home")}</strong></span></NavLink>
            <NavLink className={navClass} to="/projects"><span className="side-nav-icon"><AppIcon name="grid"/></span><span className="side-nav-copy"><strong>{t("复旦开源项目", "Fudan open source projects")}</strong></span></NavLink>
            <Link className={navClass({ isActive: isContributorSection })} aria-current={isContributorSection ? "page" : undefined} to="/contributors"><span className="side-nav-icon"><AppIcon name="users"/></span><span className="side-nav-copy"><strong>{t("开源达人榜", "Open Source Leaderboard")}</strong></span></Link>
            <Link className={navClass({ isActive: isAccount })} aria-current={isAccount ? "page" : undefined} to={accountUrl}><span className="side-nav-icon"><AppIcon name="user"/></span><span className="side-nav-copy"><strong>{t("我的", "Profile")}</strong></span></Link>
            {session.authenticated && (session.isAdmin||session.canTag) && <NavLink className={navClass} to="/admin"><span className="side-nav-icon"><AppIcon name="settings"/></span><span className="side-nav-copy"><strong>{t("管理后台", "Admin dashboard")}</strong></span></NavLink>}
          </nav>
        </aside>}

        <main className={isHome ? undefined : wideSection ? `${wideSection}-main` : "content-shell"} id="main-content" tabIndex={-1}>
          {isHome && <HomeHero startedHref={registered ? "/contributors" : "/profile"} />}
          <div className={isHome ? "content-shell home-below-hero" : undefined}>
            <Routes>
              <Route path="/" element={<HomePage api={api} accountUrl={accountUrl} authenticated={session.authenticated} />} />
              <Route path="/dashboard" element={<HomePage api={api} accountUrl={accountUrl} authenticated={session.authenticated} />} />
              <Route path="/projects" element={<ProjectBoardPage />} />
              <Route path="/contributors" element={<ContributorLeaderboardPage api={api} />} />
              <Route path="/contributors/:username" element={<ContributorDetailPage api={api} />} />
              <Route path="/admin" element={<ProjectReviewPage />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/profile/outstanding" element={registered
                ? <OutstandingApplicationPage profileUrl={accountUrl} csrfToken={session.csrfToken} />
                : <Navigate to="/profile" replace />} />
              <Route path="/profile" element={registered ? <Navigate to={accountUrl} replace /> : <IdentityVerificationPage />} />
              <Route path="*" element={<section className="not-found"><h1>{t("页面不存在", "Page not found")}</h1><Link to="/">{t("返回首页", "Back to home")}</Link></section>} />
            </Routes>
          </div>
        </main>
      </div>

      {!isHome && !isProfile && <nav className="mobile-bottom-nav" aria-label={t("底部导航", "Bottom navigation")}>
        <NavLink to="/" end className={({isActive}) => isActive ? "mobile-tab mobile-tab-active" : "mobile-tab"}><AppIcon name="home" size={22}/><span>{t("首页", "Home")}</span></NavLink>
        <NavLink to="/projects" className={({isActive}) => isActive ? "mobile-tab mobile-tab-active" : "mobile-tab"}><AppIcon name="grid" size={22}/><span>{t("项目", "Projects")}</span></NavLink>
        <Link to="/contributors" aria-current={isContributorSection ? "page" : undefined} className={isContributorSection ? "mobile-tab mobile-tab-active" : "mobile-tab"}><AppIcon name="users" size={22}/><span>{t("达人", "Ranks")}</span></Link>
        <Link to={accountUrl} aria-current={isAccount ? "page" : undefined} className={isAccount ? "mobile-tab mobile-tab-active" : "mobile-tab"}><AppIcon name="user" size={22}/><span>{t("我的", "Profile")}</span></Link>
      </nav>}
    </div>
  );
}
