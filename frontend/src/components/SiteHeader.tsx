import { useEffect, useId, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { ArrowRight, Menu, X } from "lucide-react";
import { useWebsiteSession } from "../auth/session";
import { AppIcon } from "./AppIcon";
import { LanguageToggle, useLanguage } from "../state/language";
import "@fontsource-variable/inter";

type HeaderProps = {
  profileLogin: string | null;
  accountUrl: string;
  isAccount: boolean;
  loginPageUrl: string;
  isContributorSection: boolean;
};

export function SiteHeader({ profileLogin, accountUrl, isAccount, loginPageUrl, isContributorSection }: HeaderProps) {
  const { session } = useWebsiteSession();
  const { t } = useLanguage();
  const { pathname, search } = useLocation();
  const menuRef = useRef<HTMLDialogElement>(null);
  const menuId = useId();
  const authenticated = session.authenticated;
  const isAdmin = authenticated && (session.isAdmin || session.canTag);

  useEffect(() => { menuRef.current?.close(); }, [pathname, search]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 821px)");
    const closeOnDesktop = () => { if (desktop.matches) menuRef.current?.close(); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function closeMenu() {
    menuRef.current?.close();
  }

  function navClass({ isActive }: { isActive: boolean }) {
    return isActive ? "nav-link nav-link-active" : "nav-link";
  }

  return <header className="topbar leaderboard-header">
    <Link className="brand site-brand" to="/" aria-label={t("LeaderBoard 首页", "LeaderBoard home")}>
      <img className="brand-logo" src={import.meta.env.BASE_URL + "leaderboard-mark.png"} alt="" width={34} height={34} />
      <span className="brand-copy"><strong>LeaderBoard</strong></span>
    </Link>
    <nav className="topnav" aria-label={t("主导航", "Main navigation")}>
      <NavLink className={navClass} to="/" end>{t("首页", "Home")}</NavLink>
      <NavLink className={navClass} to="/projects">{t("项目", "Projects")}</NavLink>
      <Link className={navClass({ isActive: isContributorSection })} aria-current={isContributorSection ? "page" : undefined} to="/contributors">{t("达人榜", "Leaderboard")}</Link>
      {isAdmin && <NavLink className={navClass} to="/admin">{t("管理", "Admin")}</NavLink>}
    </nav>
    <div className="site-header-actions account-header-actions">
      <LanguageToggle />
      {profileLogin ? (
        <Link className="persistent-account" to={accountUrl} aria-current={isAccount ? "page" : undefined} aria-label={t("当前登录者 " + profileLogin, "Signed in as " + profileLogin)}>
          <AppIcon name="github" size={17}/><span>{profileLogin}</span>
        </Link>
      ) : <>
        {!authenticated && <NavLink className="header-login desktop-login" to={loginPageUrl}>{t("登录", "Log in")}</NavLink>}
        <Link className="primary-button header-join" to="/profile">{t("加入达人榜", "Join leaderboard")}</Link>
      </>}
      <button className="site-menu-toggle grid place-items-center rounded-full" type="button"
        aria-label={t("打开菜单", "Open menu")} aria-haspopup="dialog" aria-controls={menuId}
        onClick={() => menuRef.current?.showModal()}>
        <Menu size={22} aria-hidden="true" />
      </button>
    </div>
    <dialog ref={menuRef} id={menuId} className="site-menu" aria-labelledby={menuId + "-title"}>
      <div className="site-menu-head flex items-center justify-between">
        <span id={menuId + "-title"}>{t("导航", "Navigation")}</span>
        <button autoFocus className="site-menu-close grid place-items-center rounded-full" type="button" aria-label={t("关闭菜单", "Close menu")} onClick={closeMenu}>
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      <nav className="site-menu-links grid" aria-label={t("移动端主导航", "Mobile main navigation")}>
        <NavLink to="/" end onClick={closeMenu}>{t("首页", "Home")} <ArrowRight size={20} aria-hidden="true" /></NavLink>
        <NavLink to="/projects" onClick={closeMenu}>{t("项目", "Projects")} <ArrowRight size={20} aria-hidden="true" /></NavLink>
        <Link to="/contributors" aria-current={isContributorSection ? "page" : undefined} onClick={closeMenu}>{t("达人榜", "Leaderboard")} <ArrowRight size={20} aria-hidden="true" /></Link>
        {isAdmin && <NavLink to="/admin" onClick={closeMenu}>{t("管理", "Admin")} <ArrowRight size={20} aria-hidden="true" /></NavLink>}
      </nav>
      <div className="site-menu-account flex flex-wrap items-center gap-3">
        {profileLogin ? <Link className="site-menu-login" to={accountUrl} aria-current={isAccount ? "page" : undefined} onClick={closeMenu}>{t("我的档案", "My profile")}</Link> : <>
          {!authenticated && <NavLink className="site-menu-login" to={loginPageUrl} onClick={closeMenu}>{t("登录", "Log in")}</NavLink>}
          <Link className="primary-button header-join" to="/profile" onClick={closeMenu}>{t("加入达人榜", "Join leaderboard")}</Link>
        </>}
      </div>
    </dialog>
  </header>;
}
