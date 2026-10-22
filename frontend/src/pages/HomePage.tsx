import { Link } from "react-router";
import { AppIcon } from "../components/AppIcon";

export function HomePage({ accountUrl, authenticated }: { accountUrl: string; authenticated: boolean }) {
  return (
    <div className="page-canvas home-page">
      <section className="home-hero">
        <div className="home-hero-content">
          <span className="home-overline">FUDAN / OPEN SOURCE</span>
          <h1>LeaderBoard<span className="home-dot">.</span></h1>
          <div className="home-hero-actions">
            <Link to="/contributors" className="primary-button home-hero-primary">查看达人榜 <span aria-hidden="true">↗</span></Link>
            <Link to="/projects" className="home-hero-secondary">浏览项目 <span aria-hidden="true">→</span></Link>
          </div>
        </div>
        <div className="hero-decor" aria-hidden="true">
          <div className="hero-decor-glow"/>
          <div className="hero-decor-grid"/>
        </div>
      </section>

      <div className="home-mobile-title"><h1>首页</h1></div>
      <section className="home-section" aria-label="快捷入口">
        <h2 className="home-section-heading">探索</h2>
        <div className="home-link-grid">
          <Link to="/projects" className="home-link-card">
            <span className="home-action-icon icon-project"><AppIcon name="grid" size={21}/></span>
            <span className="home-action-title">复旦开源项目</span>
            <AppIcon name="arrow" size={20}/>
          </Link>
          <Link to="/contributors" className="home-link-card">
            <span className="home-action-icon icon-leaders"><AppIcon name="users" size={21}/></span>
            <span className="home-action-title">开源达人榜</span>
            <AppIcon name="arrow" size={20}/>
          </Link>
          <Link to="/join" className="home-link-card">
            <span className="home-action-icon icon-join"><AppIcon name="plus" size={21}/></span>
            <span className="home-action-title">加入达人榜</span>
            <AppIcon name="arrow" size={20}/>
          </Link>
          <Link to={accountUrl} className="home-link-card">
            <span className="home-action-icon icon-account"><AppIcon name="user" size={21}/></span>
            <span className="home-action-title">{authenticated ? "我的档案" : "登录 / 注册"}</span>
            <AppIcon name="arrow" size={20}/>
          </Link>
        </div>
      </section>
    </div>
  );
}
