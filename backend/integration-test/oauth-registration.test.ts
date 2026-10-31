import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getDbPool} from "../src/db/index.js";
import {WebsiteAuthService} from "../src/auth/website-session.js";
import {EmailVerificationService} from "../src/auth/email-verification.js";
import {GitHubOAuthLinkService,getRegistrationStatus} from "../src/auth/github-link.js";
import {AnalyticsService} from "../src/analytics/index.js";

const pool = getDbPool();
const config = {clientId:"fixture",clientSecret:"fixture-not-a-real-secret",callbackUrl:"https://example.test/api/v1/auth/github/callback"};
beforeEach(async () => {
  await pool.query("TRUNCATE contributors,members,github_accounts,email_verification_challenges,website_sessions,website_login_states RESTART IDENTITY CASCADE");
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {await pool.end();});
function oauthIdentity(id = 988001, login = "verified-user") {
  vi.stubGlobal("fetch",vi.fn(async (url:unknown) => new Response(JSON.stringify(String(url).includes("access_token")
    ? {access_token:"fixture"} : {id,login,avatar_url:null}), {status:200})));
}
async function authorize(auth:WebsiteAuthService) {
  const started = await auth.startLogin("/join","register");
  const state = new URL(started.authorizeUrl).searchParams.get("state")!;
  return auth.completeLogin("code",state,started.browserToken);
}

describe("OAuth-first campus registration and expandable ranking", () => {
  it("authenticates a stable ID before campus registration, binds the browser nonce, and rejects replay", async () => {
    oauthIdentity();
    const auth = new WebsiteAuthService(config);
    const started = await auth.startLogin("/join","register");
    const state = new URL(started.authorizeUrl).searchParams.get("state")!;
    expect(state).toMatch(/^register\./);
    await expect(auth.completeLogin("code",state,"x".repeat(43))).rejects.toMatchObject({code:"INVALID_LOGIN"});
    const result = await auth.completeLogin("code",state,started.browserToken);
    expect(await auth.getRegistrationIdentity(result.sessionToken)).toMatchObject({githubId:"988001",login:"verified-user"});
    expect(await auth.getSession(result.sessionToken)).toBeNull();
    await expect(auth.completeLogin("code",state,started.browserToken)).rejects.toMatchObject({code:"INVALID_LOGIN"});
    await pool.query("UPDATE website_sessions SET expires_at=now()-interval '1 second'");
    expect(await auth.getRegistrationIdentity(result.sessionToken)).toBeNull();
  });

  it("uses the OAuth ID, rejects account switching, completes enrollment, and blocks duplicate registration after a rename", async () => {
    oauthIdentity();
    const website = new WebsiteAuthService(config);
    const proof = await authorize(website);
    const identity = (await website.getRegistrationIdentity(proof.sessionToken))!;
    const sender = {sendVerificationCode:vi.fn().mockResolvedValue(undefined)};
    const lookup = vi.fn().mockRejectedValue(new Error("Must use the OAuth identity"));
    const email = new EmailVerificationService({sender,hmacSecret:"fixture-secret-that-is-longer-than-thirty-two-characters",allowedDomains:["fudan.edu.cn"],generateCode:()=>"012345",lookupGithubAccount:lookup});
    await email.sendCode("student@fudan.edu.cn","127.0.0.1",{studentId:"26300000001",githubId:identity.githubId,githubLogin:identity.login});
    expect(lookup).not.toHaveBeenCalled();
    await expect(email.verifyCode("student@fudan.edu.cn","012345","988002")).rejects.toMatchObject({code:"GITHUB_ACCOUNT_MISMATCH"});
    const verified = await email.verifyCode("student@fudan.edu.cn","012345",identity.githubId);
    const link = new GitHubOAuthLinkService(config);
    await link.completeVerifiedRegistration(verified.memberId,identity,verified.registrationToken!);
    expect(await getRegistrationStatus(verified.registrationToken!)).toEqual({registered:true,login:"verified-user"});
    const session = await website.fromRegistration(verified.registrationToken!);
    expect(await website.getSession(session!)).toMatchObject({githubId:"988001",memberId:verified.memberId});
    await expect(email.sendCode("another@fudan.edu.cn","127.0.0.1",{studentId:"26300000002",githubId:identity.githubId,githubLogin:"renamed-user"})).rejects.toMatchObject({code:"ALREADY_REGISTERED"});
    expect(sender.sendVerificationCode).toHaveBeenCalledTimes(1);
    const rows = await pool.query("SELECT github_id::text FROM contributors WHERE enrolled_at IS NOT NULL");
    expect(rows.rows).toEqual([{github_id:"988001"}]);
  });

  it("returns later ranks beyond ten while preserving the ordered prefix and final partial page", async () => {
    await pool.query(`INSERT INTO contributors(github_id,login,actor_type,is_bot,enrolled_at)
      SELECT 990000+n,'fixture-'||lpad(n::text,2,'0'),'User',FALSE,now() FROM generate_series(1,24) n`);
    const analytics = new AnalyticsService(pool);
    const first = await analytics.getContributorLeaderboard({range:"all",metric:"score",limit:11});
    const next = await analytics.getContributorLeaderboard({range:"all",metric:"score",limit:21});
    const final = await analytics.getContributorLeaderboard({range:"all",metric:"score",limit:31});
    expect(first).toHaveLength(11);
    expect(next).toHaveLength(21);
    expect(final).toHaveLength(24);
    expect(next.slice(0,11)).toEqual(first);
    expect(final[23]).toMatchObject({rank:24,login:"fixture-24"});
  });
});
