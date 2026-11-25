import { useLanguage, type Translate } from "../state/language";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ArrowRight, Check } from "lucide-react";
import {
  ApiErrorResponseSchema,
  EmailCodeSendResponseSchema,
  GitHubLinkInfoSchema,
  GitHubRegistrationIdentitySchema,
  type GitHubRegistrationIdentity,
  EmailCodeVerifyResponseSchema,
  RegistrationStatusSchema,
} from "@leadboard/contracts";
import { Button, Input } from "../components/ui/primitives";
import { AppIcon } from "../components/AppIcon";

type Notice = { tone: "info" | "success" | "error"; code: string } | null;

function githubCallbackMessage(reason: string | null, t: Translate): string {
  switch (reason) {
    case "account_mismatch":
      return t("请使用注册时填写的 GitHub 账号授权。", "Authorize the GitHub account you used when you registered.");
    case "access_denied":
      return t("你取消了 GitHub 授权，没有进行绑定。", "GitHub authorization was canceled. No account was linked.");
    case "already_linked":
      return t("这个 GitHub 账号已经绑定到其他复旦身份。", "This GitHub account is already linked to another Fudan identity.");
    case "not_configured":
      return t("GitHub 绑定服务尚未配置。", "GitHub linking is not configured.");
    default:
      return t("GitHub 授权没有完成，请重新验证邮箱后再试。", "GitHub authorization did not finish. Verify your email and try again.");
  }
}

async function postJson<T>(
  path: string,
  body: unknown,
  schema: { parse(value: unknown): T },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("NETWORK_ERROR");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorResponseSchema.safeParse(payload);
    throw new Error(parsed.success ? parsed.data.error.code : "HTTP_ERROR");
  }
  return schema.parse(payload);
}

function messageFor(code: string, t: Translate): string {
  switch (code) {
    case "UNCONFIRMED_REGISTRATION":
      return t("后台未确认注册成功，请继续邮箱验证或 GitHub 绑定。", "The server has not confirmed your registration. Continue with email verification or GitHub linking.");
    case "REGISTRATION_STATUS_UNAVAILABLE":
      return t("暂时无法确认注册状态，请刷新后重试。", "Could not confirm your registration. Refresh to try again.");
    case "CODE_SENT":
      return t("验证码已发送，请检查邮箱。验证码 10 分钟内有效。", "Check your email for the verification code. It expires in 10 minutes.");
    case "ALREADY_REGISTERED":
      return t("该学号、邮箱或 GitHub 账号已注册，不能重复注册。", "This student ID, email, or GitHub account is already registered.");
    case "INVALID_REGISTRATION":
      return t("请填写有效学号并完成 GitHub 授权。", "Enter a valid student ID and authorize GitHub.");
    case "GITHUB_AUTH_REQUIRED":
      return t("GitHub 授权已过期，请重新授权后继续。", "GitHub authorization expired. Authorize again to continue.");
    case "GITHUB_ACCOUNT_MISMATCH":
      return t("GitHub 账号已变化，请重新获取邮箱验证码。", "The GitHub account has changed. Request a new email code.");
    case "GITHUB_ACCOUNT_NOT_FOUND":
    case "INVALID_GITHUB_ACCOUNT":
      return t("请填写存在的个人 GitHub 账号。", "Enter a valid personal GitHub account.");
    case "GITHUB_LOOKUP_UNAVAILABLE":
      return t("暂时无法核验 GitHub 账号，请稍后再试。", "Could not verify the GitHub account for now. Try again later.");
    case "REGISTRATION_SESSION_REQUIRED":
      return t("没有可继续的注册，请先完成邮箱验证。", "There is no registration to resume. Verify your email first.");
    case "INVALID_EMAIL":
    case "INVALID_FUDAN_EMAIL":
      return t("请输入有效的复旦邮箱。", "Enter a valid Fudan email address.");
    case "EMAIL_RESEND_TOO_SOON":
      return t("发送得太快了，请稍后再试。", "Please wait before requesting another code.");
    case "EMAIL_RATE_LIMITED":
    case "IP_RATE_LIMITED":
      return t("请求次数过多，请稍后再试。", "Too many requests. Try again later.");
    case "INVALID_VERIFICATION_CODE":
      return t("验证码不正确。", "The verification code is incorrect.");
    case "VERIFICATION_CODE_EXPIRED":
      return t("验证码已过期，请重新获取。", "The verification code expired. Request a new one.");
    case "VERIFICATION_CODE_USED":
      return t("这个验证码已经使用过，请重新获取。", "This verification code was already used. Request a new one.");
    case "VERIFICATION_ATTEMPTS_EXCEEDED":
      return t("验证码尝试次数过多，请重新获取。", "Too many attempts. Request a new verification code.");
    case "EMAIL_AUTH_NOT_CONFIGURED":
      return t("邮件服务暂不可用，请稍后再试。", "Email service is unavailable. Try again later.");
    case "EMAIL_DELIVERY_FAILED":
      return t("验证码邮件暂时无法发送，请稍后再试。", "The verification email could not be sent. Try again later.");
    case "NETWORK_ERROR":
      return t("暂时无法连接服务器，请检查网络后重试。", "Could not reach the server. Check your connection and try again.");
    default:
      return t("操作失败，请稍后再试。", "The operation failed. Try again later.");
  }
}

export function IdentityVerificationPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [studentId, setStudentId] = useState("");
  const [githubIdentity, setGithubIdentity] = useState<GitHubRegistrationIdentity>({ verified: false });
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);

  const callbackParams = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const githubCallbackStatus = callbackParams.get("github");
  const [githubLogin, setGithubLogin] = useState<string | null>(null);
  const githubCallbackReason = callbackParams.get("reason");
  const [githubLinked, setGithubLinked] = useState(false);
  const [checkingRegistration, setCheckingRegistration] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/v1/auth/registration/status", {cache:"no-store",credentials:"same-origin"}).then(async response => {
        if (!response.ok) throw new Error("Registration confirmation unavailable");
        return RegistrationStatusSchema.parse(await response.json());
      }),
      fetch("/api/v1/auth/github/registration", {cache:"no-store",credentials:"same-origin"}).then(async response => {
        if (!response.ok) throw new Error("GitHub identity unavailable");
        return GitHubRegistrationIdentitySchema.parse(await response.json());
      }),
    ]).then(([status, identity]) => {
        if (!active) return;
          setGithubIdentity(identity);
        setGithubLinked(status.registered);
        setGithubLogin(status.registered ? status.login : null);
        if (!status.registered && githubCallbackStatus === "success") {
          setNotice({ tone: "error", code: "UNCONFIRMED_REGISTRATION" });
        }
      })
      .catch(() => {
        if (active) setNotice({ tone: "error", code: "REGISTRATION_STATUS_UNAVAILABLE" });
      })
      .finally(() => { if (active) setCheckingRegistration(false); });
    return () => { active = false; };
  }, [githubCallbackStatus]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (busy || cooldown > 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await postJson(
        "/api/v1/auth/email/send-code",
        { email, studentId },
        EmailCodeSendResponseSchema,
      );
      setSent(true);
      setCooldown(result.retryAfterSeconds);
      setNotice({ tone: "success", code: "CODE_SENT" });
    } catch (error) {
      setNotice({ tone: "error", code: error instanceof Error ? error.message : "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await postJson(
        "/api/v1/auth/email/verify",
        { email, code },
        EmailCodeVerifyResponseSchema,
      );
      if (!result.registered) throw new Error("REGISTRATION_WRITE_NOT_CONFIRMED");
      setVerified(true);
      window.location.assign("/profile");
    } catch (error) {
      setNotice({ tone: "error", code: error instanceof Error ? error.message : "UNKNOWN" });
    } finally {
      setBusy(false);
    }
  }

  async function resumeRegistration() {
    setBusy(true);
    setNotice(null);
    try {
      const link = await postJson("/api/v1/auth/github/retry", {}, GitHubLinkInfoSchema);
      if (link.available) window.location.assign(link.authorizeUrl);
      else throw new Error("GITHUB_AUTH_REQUIRED");
    } catch (error) {
      setNotice({tone:"error",code:error instanceof Error ? error.message : "UNKNOWN"});
    } finally { setBusy(false); }
  }

  const complete = githubLinked || verified;
  const step = checkingRegistration || complete ? null : githubIdentity.verified ? "email" : "github";
  const stepLabels = [
    { id: "github", label: t("GitHub 授权", "GitHub authorization"), done: complete || githubIdentity.verified },
    { id: "email", label: t("复旦邮箱", "Fudan email"), done: complete },
  ] as const;
  const loginCallback = callbackParams.get("login");

  return (
    <div className="registration-page">
      <header className="registration-heading">
        <h1>{complete ? t("身份验证完成", "Verification complete") : t("加入开源达人榜", "Join the leaderboard")}</h1>
        {!complete && <p>{t("授权 GitHub 并验证复旦邮箱，即可创建你的贡献者档案。", "Authorize GitHub and verify your Fudan email to create your contributor profile.")}</p>}
      </header>

      <section className="registration-panel" aria-labelledby="registration-step-title" aria-busy={checkingRegistration}>
        <ol className="registration-steps" aria-label={t("注册进度", "Registration progress")}>
          {stepLabels.map(({ id, label, done }, index) => (
            <li key={id} aria-current={step === id ? "step" : undefined} data-complete={done || undefined}>
              <span className="registration-step-number">
                {done ? <Check size={14} aria-label={t("已完成", "Complete")} role="img" /> : index + 1}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>

        <div className="registration-content">
          <h2 id="registration-step-title">
            {checkingRegistration ? t("正在确认注册状态…", "Checking registration…")
              : complete ? t("注册成功", "Registration complete")
              : githubIdentity.verified ? sent ? t("输入邮箱验证码", "Enter your email code") : t("验证复旦邮箱", "Verify your Fudan email")
              : t("授权 GitHub 账号", "Authorize your GitHub account")}
          </h2>

          {loginCallback && <p className="registration-feedback" role="alert">
            {loginCallback === "registration_required"
              ? t("请先完成注册，再使用 GitHub 登录。", "Complete registration before signing in with GitHub.")
              : t("GitHub 登录未完成，请重新尝试。", "GitHub sign-in did not finish. Try again.")}
          </p>}
          {githubCallbackStatus === "error" && <p className="registration-feedback" role="alert">{githubCallbackMessage(githubCallbackReason, t)}</p>}

          {checkingRegistration ? <div className="registration-loading" role="status" aria-label={t("正在加载", "Loading")}><span className="spinner" aria-hidden="true" /></div> : complete ? (
            <div className="registration-fields">
              <p className="registration-help">{githubLogin ? `@${githubLogin}` : t("GitHub 账号和复旦邮箱已验证。", "Your GitHub account and Fudan email are verified.")}</p>
              <a className="registration-action" href={githubLogin ? `/contributors/${encodeURIComponent(githubLogin)}` : "/profile"}>{t("查看个人档案", "View your profile")}<ArrowRight size={16} aria-hidden="true" /></a>
            </div>
          ) : !githubIdentity.verified ? (
            <div className="registration-fields">
              <p className="registration-help">{t("使用你希望在榜单上展示开源贡献的 GitHub 账号。", "Use the GitHub account whose contributions you want to show on the leaderboard.")}</p>
              <a className="registration-action" href="/api/v1/auth/github/register"><AppIcon name="github" size={18} />{t("使用 GitHub 授权", "Authorize GitHub")}</a>
            </div>
          ) : (
            <>
              {!sent && <div className="registration-account">
                <span><AppIcon name="github" size={16} /><strong>@{githubIdentity.login}</strong></span>
                <a href="/api/v1/auth/github/register">{t("更换账号", "Switch account")}</a>
              </div>}
              {sent ? (
                <form key="verification-code" className="registration-fields" onSubmit={verify}>
                  <p className="registration-help registration-email">{t("发送至", "Sent to")} <strong>{email}</strong></p>
                  <label className="registration-field">
                    {t("6 位验证码", "6-digit verification code")}
                    <Input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      required
                      autoFocus
                      disabled={busy}
                    />
                  </label>
                  <Button className="registration-action" type="submit" disabled={busy || code.length !== 6}>
                    {busy ? t("正在验证…", "Verifying…") : t("验证并加入达人榜", "Verify and join")}
                  </Button>
                  <button
                    className="registration-text-button"
                    type="button"
                    disabled={busy || cooldown > 0}
                    onClick={() => {
                      setSent(false);
                      setCode("");
                      setNotice(null);
                    }}
                  >
                    {cooldown > 0 ? t(`${cooldown} 秒后可重发`, `Resend in ${cooldown}s`) : t("更换邮箱或重发验证码", "Change email or resend")}
                  </button>
                </form>
              ) : (
                <form key="email-details" className="registration-fields" onSubmit={sendCode}>
                  <label className="registration-field">
                    {t("学号", "Student ID")}
                    <Input inputMode="numeric" value={studentId}
                      onChange={event => setStudentId(event.target.value.replace(/\D/g, ""))}
                      pattern="[0-9]{6,20}" maxLength={20} placeholder={t("填写本人学号", "Enter your student ID")} required disabled={busy}
                    />
                  </label>
                  <label className="registration-field">
                    {t("复旦邮箱", "Fudan email")}
                    <Input type="email" value={email} onChange={event => setEmail(event.target.value)}
                      placeholder="name@fudan.edu.cn" autoComplete="email" required disabled={busy}
                    />
                  </label>
                  <Button className="registration-action" type="submit" disabled={busy || cooldown > 0}>
                    {busy ? t("正在发送…", "Sending…") : cooldown > 0 ? t(`${cooldown} 秒后可重发`, `Resend in ${cooldown}s`) : t("发送验证码", "Send verification code")}
                  </Button>
                </form>
              )}
              {notice?.code === "ALREADY_REGISTERED" && <button className="registration-text-button" type="button" disabled={busy} onClick={() => void resumeRegistration()}>
                {t("继续上次注册", "Resume registration")}
              </button>}
            </>
          )}

          {notice && <p className="registration-feedback" role={notice.tone === "error" ? "alert" : "status"}>{messageFor(notice.code, t)}</p>}
        </div>

        {!checkingRegistration && !complete && !githubIdentity.verified && <p className="registration-login">
          {t("已有账号？", "Already registered?")}{" "}<Link to="/login?returnTo=%2Fprojects">{t("前往登录", "Log in")}</Link>
        </p>}
      </section>
    </div>
  );
}
