import { Link } from "react-router";
import { AppIcon } from "../components/AppIcon";
import { useLanguage } from "../state/language";

export function LoginPage({ githubLoginUrl }: { githubLoginUrl: string }) {
  const { t } = useLanguage();

  return (
    <main className="login-page" id="main-content">
      <div className="login-layout">
        <div className="login-intro">
          <p className="login-intro-title">{t("欢迎回来。", "Welcome back.")}</p>
          <p className="login-intro-copy">
            {t(
              "登录后，查看你的贡献记录和达人榜排名。",
              "Log in to see your contributions and leaderboard ranking.",
            )}
          </p>
        </div>
        <section className="login-card" aria-labelledby="login-heading">
          <h1 id="login-heading">{t("登录 LeaderBoard", "Log in to LeaderBoard")}</h1>
          <a className="login-github" href={githubLoginUrl}>
            <AppIcon name="github" size={20} />
            {t("使用 GitHub 继续", "Continue with GitHub")}
          </a>
          <p className="login-register">
            {t("还没有账号？", "Don't have an account?")}{" "}
            <Link to="/profile">{t("注册并加入达人榜", "Sign up")}</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
