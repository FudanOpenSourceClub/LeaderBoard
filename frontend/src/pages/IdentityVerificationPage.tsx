import { useEffect, useState, type FormEvent } from "react";
import {
  ApiErrorResponseSchema,
  EmailCodeSendResponseSchema,
  GitHubLinkInfoSchema,
  GitHubRegistrationIdentitySchema,
  type GitHubRegistrationIdentity,
  EmailCodeVerifyResponseSchema,
  RegistrationStatusSchema,
} from "@leadboard/contracts";

type Notice = { tone: "info" | "success" | "error"; text: string } | null;

function githubCallbackMessage(reason: string | null): string {
  switch (reason) {
    case "account_mismatch":
      return "请使用注册时填写的 GitHub 账号授权。";
    case "access_denied":
      return "你取消了 GitHub 授权，没有进行绑定。";
    case "already_linked":
      return "这个 GitHub 账号已经绑定到其他复旦身份。";
    case "not_configured":
      return "GitHub 绑定服务尚未配置。";
    default:
      return "GitHub 授权没有完成，请重新验证邮箱后再试。";
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

function messageFor(code: string): string {
  switch (code) {
    case "ALREADY_REGISTERED":
      return "该学号、邮箱或 GitHub 账号已注册，不能重复注册。";
    case "INVALID_REGISTRATION":
      return "请填写有效学号并完成 GitHub 授权。";
    case "GITHUB_AUTH_REQUIRED":
      return "GitHub 授权已过期，请重新授权后继续。";
    case "GITHUB_ACCOUNT_MISMATCH":
      return "GitHub 账号已变化，请重新获取邮箱验证码。";
    case "GITHUB_ACCOUNT_NOT_FOUND":
    case "INVALID_GITHUB_ACCOUNT":
      return "请填写存在的个人 GitHub 账号。";
    case "GITHUB_LOOKUP_UNAVAILABLE":
      return "暂时无法核验 GitHub 账号，请稍后再试。";
    case "REGISTRATION_SESSION_REQUIRED":
      return "没有可继续的注册，请先完成邮箱验证。";
    case "INVALID_EMAIL":
    case "INVALID_FUDAN_EMAIL":
      return "请输入有效的复旦邮箱。";
    case "EMAIL_RESEND_TOO_SOON":
      return "发送得太快了，请稍后再试。";
    case "EMAIL_RATE_LIMITED":
    case "IP_RATE_LIMITED":
      return "请求次数过多，请稍后再试。";
    case "INVALID_VERIFICATION_CODE":
      return "验证码不正确。";
    case "VERIFICATION_CODE_EXPIRED":
      return "验证码已过期，请重新获取。";
    case "VERIFICATION_CODE_USED":
      return "这个验证码已经使用过，请重新获取。";
    case "VERIFICATION_ATTEMPTS_EXCEEDED":
      return "验证码尝试次数过多，请重新获取。";
    case "EMAIL_AUTH_NOT_CONFIGURED":
      return "邮件服务尚未配置。验证系统已经就绪，配置发信邮箱后即可使用。";
    case "EMAIL_DELIVERY_FAILED":
      return "验证码邮件暂时无法发送，请稍后再试。";
    case "NETWORK_ERROR":
      return "暂时无法连接服务器，请检查网络后重试。";
    default:
      return "操作失败，请稍后再试。";
  }
}

export function IdentityVerificationPage() {
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
          setNotice({ tone: "error", text: "后台未确认注册成功，请继续邮箱验证或 GitHub 绑定。" });
        }
      })
      .catch(() => {
        if (active) setNotice({ tone: "error", text: "暂时无法确认注册状态，请刷新后重试。" });
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
      setNotice({ tone: "success", text: "验证码已发送，请检查邮箱。验证码 10 分钟内有效。" });
    } catch (error) {
      setNotice({ tone: "error", text: messageFor(error instanceof Error ? error.message : "UNKNOWN") });
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
      window.location.assign("/join");
    } catch (error) {
      setNotice({ tone: "error", text: messageFor(error instanceof Error ? error.message : "UNKNOWN") });
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
      setNotice({tone:"error",text:messageFor(error instanceof Error ? error.message : "UNKNOWN")});
    } finally { setBusy(false); }
  }

  return (
    <div className="page-canvas">
      <section className="join-hero">
        <div className="join-copy">
          <span className="hero-badge">FUDAN IDENTITY</span>
          {callbackParams.get("login")&&<p role="alert" className="verify-notice verify-notice-error">{callbackParams.get("login")==="registration_required"?"请先注册网站，再使用 GitHub 登录。":"GitHub 登录未完成，请重新尝试。"}</p>}
          <h1>我要上榜</h1>
          <p>授权 GitHub 账号，验证复旦邮箱，加入达人榜。</p>
          <div className="join-steps" aria-label="加入达人榜步骤">
            <div className={`join-step ${githubIdentity.verified ? "join-step-done" : "join-step-active"}`}><span>{githubIdentity.verified ? "✓" : "1"}</span><div><strong>授权 GitHub</strong><small>自动获取账号 ID</small></div></div>
            <div className={`join-step ${githubLinked ? "join-step-done" : githubIdentity.verified ? "join-step-active" : ""}`}><span>{githubLinked ? "✓" : "2"}</span><div><strong>验证复旦邮箱</strong><small>确认校园身份</small></div></div>
            <div className={`join-step ${githubLinked ? "join-step-done" : ""}`}><span>{githubLinked ? "✓" : "3"}</span><div><strong>加入达人榜</strong><small>关联你的公开贡献</small></div></div>
          </div>
        </div>

        <div className="verify-card">
          <div className="verify-card-head">
            <span className="verify-icon" aria-hidden="true">✦</span>
            <div><p>加入 LeaderBoard</p><h2>{githubLinked || verified ? "已加入达人榜" : !githubIdentity.verified ? "验证 GitHub 账号" : sent ? "输入邮箱验证码" : "验证复旦邮箱"}</h2></div>
          </div>

          {checkingRegistration ? <p role="status">正在向后台确认注册状态…</p> : githubLinked ? (
            <div className="verified-state" role="status">
              <span className="verified-mark" aria-hidden="true">✓</span>
              <h2>注册成功</h2>
              <p>{githubLogin ? <>已确认账号 <strong>@{githubLogin}</strong> 的归属。</> : "GitHub 账号已经成功绑定。"}</p>
              <a className="primary-button github-link-button" href="/contributors">查看达人榜</a>
            </div>
          ) : !githubIdentity.verified ? (
            <div className="github-link-state">
              <p>通过 GitHub 官方 OAuth 验证，自动读取你的账号 ID。</p>
              <a className="primary-button github-link-button" href="/api/v1/auth/github/register">使用 GitHub 授权</a>
              {notice && <p className={`verify-notice verify-notice-${notice.tone}`} role="status">{notice.text}</p>}
              {githubCallbackStatus === "error" && <p className="verify-notice verify-notice-error" role="alert">{githubCallbackMessage(githubCallbackReason)}</p>}
            </div>
          ) : (
            <>
              {githubCallbackStatus === "error" && (
                <p className="verify-notice verify-notice-error" role="status">
                  {githubCallbackMessage(githubCallbackReason)}
                </p>
              )}
              <div className="github-identity-card">
                <div><span>GitHub 账号 ID</span><strong>{githubIdentity.githubId}</strong><small>@{githubIdentity.login}</small></div>
                {!sent && <a href="/api/v1/auth/github/register">更换账号</a>}
              </div>
              <form onSubmit={sendCode}>
                <label className="form-field">
                  <span>学号</span>
                  <input type="text" inputMode="numeric" value={studentId}
                    onChange={event=>setStudentId(event.target.value.replace(/\D/g,""))}
                    pattern="[0-9]{6,20}" maxLength={20} placeholder="填写本人学号" required disabled={busy||sent} />

                </label>
                <label className="form-field">
                  <span>复旦邮箱</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@fudan.edu.cn"
                    autoComplete="email"
                    required
                    disabled={busy || sent}
                  />
                  <small>支持 fudan.edu.cn 及其子域邮箱</small>
                </label>
                <button className="primary-button" type="submit" disabled={busy || cooldown > 0 || sent}>
                  {busy && !sent ? "正在发送…" : cooldown > 0 ? `${cooldown} 秒后可重发` : sent ? "验证码已发送" : "发送验证码"}
                </button>
              </form>
              {notice?.tone === "error" && notice.text.includes("已注册") && <button className="text-button" type="button" disabled={busy} onClick={() => void resumeRegistration()}>继续上次注册</button>}

              {sent && (
                <form className="verification-form" onSubmit={verify}>
                  <label className="form-field">
                    <span>6 位验证码</span>
                    <input
                      className="code-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      required
                      autoFocus
                    />
                    <small>验证码 10 分钟内有效</small>
                  </label>
                  <button className="primary-button" type="submit" disabled={busy || code.length !== 6}>
                    {busy ? "正在验证…" : "验证并加入达人榜"}
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy || cooldown > 0}
                    onClick={() => {
                      setSent(false);
                      setCode("");
                      setNotice(null);
                    }}
                  >
                    {cooldown > 0 ? `${cooldown} 秒后可重新发送` : "更换邮箱 / 重新发送"}
                  </button>
                </form>
              )}

              {notice && (
                <p className={`verify-notice verify-notice-${notice.tone}`} role="status">
                  {notice.text}
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
