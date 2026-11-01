import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getWebsiteRole } from "./roles.js";
import type { WebsiteRole } from "@leadboard/contracts";
import { getDbPool, withTransaction } from "../db/index.js";
import { exchangeCode, fetchGitHubIdentity, type GitHubOAuthConfig, type GitHubIdentity } from "./github-link.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const random = () => randomBytes(32).toString("base64url");
const validToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);
export interface WebsiteUser { githubId: string; login: string; memberId: string | null; isAdmin: boolean; role?: WebsiteRole | null; csrfToken: string }
export interface WebsiteAuthApi {
  getSession(token: string): Promise<WebsiteUser | null>;
  startLogin(returnPath: string, intent?: "register"): Promise<{authorizeUrl: string; browserToken: string}>;
  completeLogin(code: string, state: string, browserToken: string): Promise<{sessionToken: string; returnPath: string}>;
  getRegistrationIdentity(token: string): Promise<GitHubIdentity | null>;
  fromRegistration(token: string): Promise<string | null>;
}
export class WebsiteAuthError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
export function csrfMatches(user: WebsiteUser, value: string | undefined): boolean {
  if (!value || value.length !== user.csrfToken.length) return false;
  const a=Buffer.from(value),b=Buffer.from(user.csrfToken);
  return a.length===b.length && timingSafeEqual(a,b);
}
export class WebsiteAuthService implements WebsiteAuthApi {
  constructor(private readonly config?: GitHubOAuthConfig) {}
  private async memberFor(githubId: string): Promise<string | null> {
    const result = await getDbPool().query<{id:string}>(
      `SELECT m.id::text FROM members m JOIN member_github_accounts a ON a.member_id=m.id
       WHERE a.github_id=$1 AND m.registration_github_id=$1 AND m.student_fingerprint IS NOT NULL
         AND m.verification_status='verified' AND a.is_primary=TRUE`, [githubId]);
    return result.rows.length===1 ? result.rows[0]!.id : null;
  }
  private async issue(githubId: string, login: string, ttlMinutes = 30 * 24 * 60): Promise<string> {
    const token=random();
    await getDbPool().query(`INSERT INTO website_sessions(token_hash,github_id,login,csrf_token,expires_at)
      VALUES ($1,$2,$3,$4,now()+$5*interval '1 minute')`,[hash(token),githubId,login,random(),ttlMinutes]);
    return token;
  }
  async getSession(token: string): Promise<WebsiteUser | null> {
    if (!validToken(token)) return null;
    const result=await getDbPool().query<{github_id:string;login:string;csrf_token:string}>(
      `SELECT github_id::text,login,csrf_token FROM website_sessions WHERE token_hash=$1 AND expires_at>now()`,[hash(token)]);
    const row=result.rows[0]; if(!row)return null;
    const memberId=await this.memberFor(row.github_id); const role=await getWebsiteRole(row.github_id); const isAdmin=role==="owner";
    if (!memberId && !role) return null;
    return {githubId:row.github_id,login:row.login,memberId,isAdmin,role,csrfToken:row.csrf_token};
  }
  async getRegistrationIdentity(token: string): Promise<GitHubIdentity | null> {
    if (!validToken(token)) return null;
    const result = await getDbPool().query<{github_id: string; login: string}>(
      `SELECT github_id::text, login FROM website_sessions WHERE token_hash=$1 AND expires_at>now()`, [hash(token)]);
    const row = result.rows[0];
    return row ? {githubId: row.github_id, login: row.login, avatarUrl: `https://avatars.githubusercontent.com/u/${row.github_id}?v=4`} : null;
  }
  async startLogin(returnPath: string, intent?: "register") {
    if (!this.config) throw new WebsiteAuthError("LOGIN_UNAVAILABLE",503,"GitHub 登录尚未配置");
    const state=(intent === "register" ? "register." : "login.")+random(), browserToken=random();
    const safePath=["/projects","/admin","/join"].includes(returnPath)?returnPath:"/projects";
    await getDbPool().query(`INSERT INTO website_login_states(state_hash,browser_hash,return_path,expires_at)
      VALUES ($1,$2,$3,now()+interval '10 minutes')`,[hash(state),hash(browserToken),safePath]);
    const url=new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id",this.config.clientId);url.searchParams.set("redirect_uri",this.config.callbackUrl);url.searchParams.set("state",state);
    return {authorizeUrl:url.toString(),browserToken};
  }
  async completeLogin(code: string, state: string, browserToken: string) {
    if(!this.config)throw new WebsiteAuthError("LOGIN_UNAVAILABLE",503,"GitHub 登录尚未配置");
    if(!code || code.length>1024 || !/^(login|register)\.[A-Za-z0-9_-]{43}$/.test(state) || !validToken(browserToken))
      throw new WebsiteAuthError("INVALID_LOGIN",401,"登录已过期，请重试");
    const returnPath=await withTransaction(async client=>{
      const result=await client.query<{return_path:string}>(`UPDATE website_login_states SET used_at=now()
        WHERE state_hash=$1 AND browser_hash=$2 AND used_at IS NULL AND expires_at>now() RETURNING return_path`,[hash(state),hash(browserToken)]);
      if(!result.rows[0])throw new WebsiteAuthError("INVALID_LOGIN",401,"登录已过期，请重试");
      return result.rows[0].return_path;
    });
    const identity=await fetchGitHubIdentity(await exchangeCode(this.config,code));
    const memberId=await this.memberFor(identity.githubId);
    const registering = state.startsWith("register.");
    if(!registering && !memberId && !(await getWebsiteRole(identity.githubId)))throw new WebsiteAuthError("REGISTRATION_REQUIRED",401,"请先注册 LeaderBoard");
    return {sessionToken:await this.issue(identity.githubId,identity.login,registering ? 30 : undefined),returnPath};
  }
  async fromRegistration(token: string): Promise<string | null> {
    if(!validToken(token))return null;
    const result=await getDbPool().query<{github_id:string;login:string}>(`SELECT a.github_id::text,a.login FROM members m
      JOIN member_github_accounts link ON link.member_id=m.id AND link.is_primary=TRUE
      JOIN github_accounts a ON a.github_id=link.github_id AND m.registration_github_id=a.github_id
      WHERE m.registration_session_hash=$1 AND m.registration_session_expires_at>now()
        AND m.verification_status='verified' AND m.student_fingerprint IS NOT NULL`,[hash(token)]);
    const row=result.rows[0];return row?this.issue(row.github_id,row.login):null;
  }
}
export function createWebsiteAuthFromEnv(): WebsiteAuthApi {
  const {GITHUB_OAUTH_CLIENT_ID:clientId,GITHUB_OAUTH_CLIENT_SECRET:clientSecret,GITHUB_OAUTH_CALLBACK_URL:callbackUrl}=process.env;
  return new WebsiteAuthService(clientId&&clientSecret&&callbackUrl ? {clientId,clientSecret,callbackUrl}:undefined);
}
