import { useEffect, useState, type FormEvent } from "react";
import {
  ApiErrorResponseSchema,
  EmailCodeSendResponseSchema,
  GitHubLinkInfoSchema,
  EmailCodeVerifyResponseSchema,
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
      return "请填写有效学号和 GitHub 用户名。";
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
  const [githubUsername, setGithubUsername] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [githubAuthorizeUrl, setGithubAuthorizeUrl] = useState<string | null>(null);
  const callbackParams = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const githubCallbackStatus = callbackParams.get("github");
  const githubLogin = callbackParams.get("login");
  const githubCallbackReason = callbackParams.get("reason");
  const githubLinked = githubCallbackStatus === "success";

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
        { email, studentId, githubLogin: githubUsername },
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

  async function resumeRegistration() {
    setBusy(true); setNotice(null);
    try {
      const link=await postJson("/api/v1/auth/github/retry",{},GitHubLinkInfoSchema);
      if (link.available) { setVerified(true); setGithubAuthorizeUrl(link.authorizeUrl); }
      else setNotice({tone:"info",text:"GitHub 绑定服务还需要管理员完成配置。"});
    } catch(error) { setNotice({tone:"error",text:messageFor(error instanceof Error?error.message:"UNKNOWN")}); }
    finally { setBusy(false); }
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
      setVerified(true);
      if (result.githubLink.available) {
        setGithubAuthorizeUrl(result.githubLink.authorizeUrl);
        setNotice({ tone: "success", text: "复旦身份验证成功。现在可以继续绑定 GitHub。" });
      } else {
        setGithubAuthorizeUrl(null);
        setNotice({ tone: "info", text: "复旦身份验证成功。GitHub 绑定服务还需要完成一次管理员配置。" });
      }
    } catch (error) {
      setNotice({ tone: "error", text: messageFor(error instanceof Error ? error.message : "UNKNOWN") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-canvas">
      <section className="join-hero">
        <div className="join-copy">
          <span className="hero-badge">FUDAN IDENTITY</span>
          <h1>把你的开源贡献<br />带回校园。</h1>
          <p>填写学号和 GitHub 账号，验证复旦邮箱后通过 GitHub 官方授权完成绑定。LeaderBoard 不保存 GitHub OAuth access token。</p>
          <div className="join-steps" aria-label="加入贡献榜步骤">
            <div className={`join-step ${verified || githubLinked ? "join-step-done" : "join-step-active"}`}><span>{verified || githubLinked ? "✓" : "1"}</span><div><strong>验证邮箱</strong><small>确认复旦身份</small></div></div>
            <div className={`join-step ${githubLinked ? "join-step-done" : verified ? "join-step-active" : ""}`}><span>{githubLinked ? "✓" : "2"}</span><div><strong>绑定 GitHub</strong><small>通过 GitHub 官方 OAuth 确认账号</small></div></div>
            <div className={`join-step ${githubLinked ? "join-step-active" : ""}`}><span>3</span><div><strong>贡献归属</strong><small>用稳定 GitHub ID 关联公开贡献</small></div></div>
          </div>
          <div className="privacy-card">
            <span className="privacy-icon" aria-hidden="true">◇</span>
            <div><strong>隐私设计</strong><p>邮箱只保存不可逆指纹；GitHub 只保存账号 ID、用户名和头像，授权 token 验证完身份后立即丢弃。</p></div>
          </div>
        </div>

        <div className="verify-card">
          <div className="verify-card-head">
            <span className="verify-icon" aria-hidden="true">✦</span>
            <div><p>加入 LeaderBoard</p><h2>{githubLinked ? "GitHub 绑定完成" : verified ? "继续绑定 GitHub" : sent ? "输入邮箱验证码" : "验证复旦邮箱"}</h2></div>
          </div>

          {githubLinked ? (
            <div className="verified-state" role="status">
              <span className="verified-mark" aria-hidden="true">✓</span>
              <h2>GitHub 绑定成功</h2>
              <p>{githubLogin ? <>已确认账号 <strong>@{githubLogin}</strong> 的归属。</> : "GitHub 账号已经成功绑定。"}</p>
              <div className="success-band">邮箱身份 + GitHub 身份已关联 · OAuth token 未保存</div>
            </div>
          ) : verified ? (
            <div className="verified-state github-link-state" role="status">
              <span className="verified-mark" aria-hidden="true">✓</span>
              <h2>邮箱验证完成</h2>
              <p>下一步会跳转到 GitHub 官方页面确认你控制的账号。</p>
              {githubAuthorizeUrl ? (
                <a className="primary-button github-link-button" href={githubAuthorizeUrl}>
                  使用 GitHub 账号授权
                </a>
              ) : (
                <div className="verify-notice verify-notice-info">
                  GitHub OAuth 还没有配置完成。邮箱身份已经验证成功。
                </div>
              )}
              {notice && <p className={`verify-notice verify-notice-${notice.tone}`}>{notice.text}</p>}
            </div>
          ) : (
            <>
              {githubCallbackStatus === "error" && (
                <p className="verify-notice verify-notice-error" role="status">
                  {githubCallbackMessage(githubCallbackReason)}
                </p>
              )}
              <form onSubmit={sendCode}>
                <label className="form-field">
                  <span>学号</span>
                  <input type="text" inputMode="numeric" value={studentId}
                    onChange={event=>setStudentId(event.target.value.replace(/\D/g,""))}
                    pattern="[0-9]{6,20}" maxLength={20} placeholder="填写本人学号" required disabled={busy||sent} />
                  <small>同一学号只能注册一次；仅保存用于去重的指纹。</small>
                </label>
                <label className="form-field">
                  <span>GitHub 用户名</span>
                  <input type="text" value={githubUsername} onChange={event=>setGithubUsername(event.target.value.trim())}
                    placeholder="例如：octocat" required maxLength={39} disabled={busy||sent} />
                  <small>同一 GitHub 账号只能绑定一个用户，后续需使用此账号授权。</small>
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
              {!sent && <button className="text-button" type="button" disabled={busy} onClick={()=>void resumeRegistration()}>继续之前的 GitHub 绑定</button>}

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
                    {busy ? "正在验证…" : "验证身份"}
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
