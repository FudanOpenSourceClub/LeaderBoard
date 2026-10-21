import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDbPool } from "../src/db/index.js";
import {
  EmailAuthError,
  EmailVerificationService,
  GitHubOAuthLinkService,
  type VerificationEmailSender,
} from "../src/auth/index.js";

const pool = getDbPool();
let now = new Date("2026-10-01T12:00:00.000Z");
let nextCode = "123456";

class FakeSender implements VerificationEmailSender {
  sent: Array<{ to: string; code: string; expiresInMinutes: number }> = [];
  fail = false;

  async sendVerificationCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void> {
    if (this.fail) throw new Error("fixture delivery failure");
    this.sent.push(input);
  }
}

function service(sender: FakeSender, lookup = async (login:string)=>({githubId:"123456789",login})) {
  return new EmailVerificationService({
    sender,
    hmacSecret: "fixture-secret-that-is-longer-than-thirty-two-characters",
    allowedDomains: ["fudan.edu.cn", "m.fudan.edu.cn"],
    now: () => new Date(now),
    generateCode: () => nextCode,
    lookupGithubAccount: lookup,
  });
}

async function expectAuthError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error("Expected EmailAuthError");
  } catch (error) {
    expect(error).toBeInstanceOf(EmailAuthError);
    expect((error as EmailAuthError).code).toBe(code);
  }
}

beforeEach(async () => {
  now = new Date("2026-10-01T12:00:00.000Z");
  nextCode = "123456";
  await pool.query("DELETE FROM contributors WHERE github_id=123456789");
  await pool.query(
    "TRUNCATE member_github_accounts, github_accounts, email_verification_challenges, members RESTART IDENTITY CASCADE",
  );
});

afterAll(async () => {
  await pool.end();
});
afterEach(()=>vi.unstubAllGlobals());

describe("Fudan email verification integration", () => {
  it("rejects duplicate student numbers and stable GitHub IDs before sending email",async()=>{
    const sender=new FakeSender();
    const auth=service(sender,async login=>({githubId:login==="new-account"?"987654321":"123456789",login}));
    await auth.sendCode("first@fudan.edu.cn","203.0.113.1",{studentId:"26300000001",githubLogin:"octocat"});
    const verified=await auth.verifyCode("first@fudan.edu.cn","123456");
    const before=sender.sent.length;
    await expectAuthError(auth.sendCode("second@fudan.edu.cn","203.0.113.1",{studentId:"26300000001",githubLogin:"new-account"}),"ALREADY_REGISTERED");
    await expectAuthError(auth.sendCode("third@fudan.edu.cn","203.0.113.1",{studentId:"26300000002",githubLogin:"renamed-account"}),"ALREADY_REGISTERED");
    expect(sender.sent).toHaveLength(before);
    expect(verified.registrationToken).toBeTruthy();
    await expect(auth.resumeRegistration(verified.registrationToken!)).resolves.toBe(verified.memberId);
    const stored=(await pool.query("SELECT student_fingerprint FROM members")).rows[0].student_fingerprint;
    expect(stored).toHaveLength(64);
    expect(stored).not.toContain("26300000001");
  });

  it("allows only one registration when two verified challenges race for one GitHub ID",async()=>{
    const auth=service(new FakeSender());
    await auth.sendCode("first@fudan.edu.cn","203.0.113.1",{studentId:"26300000001",githubLogin:"octocat"});
    await auth.sendCode("second@fudan.edu.cn","203.0.113.2",{studentId:"26300000002",githubLogin:"renamed"});
    const result=await Promise.allSettled([auth.verifyCode("first@fudan.edu.cn","123456"),auth.verifyCode("second@fudan.edu.cn","123456")]);
    expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM members")).rows[0].count).toBe(1);
  });

  it("requires OAuth to match the reserved account and enforces one account per user",async()=>{
    const auth=service(new FakeSender());
    await auth.sendCode("first@fudan.edu.cn","203.0.113.1",{studentId:"26300000001",githubLogin:"octocat"});
    const verified=await auth.verifyCode("first@fudan.edu.cn","123456");
    const github=new GitHubOAuthLinkService({clientId:"test",clientSecret:"fixture",callbackUrl:"https://example.test/api/v1/auth/github/callback"});
    let id=987654321;
    vi.stubGlobal("fetch",vi.fn(async (url:unknown)=>new Response(JSON.stringify(String(url).includes("access_token")
      ? {access_token:"fixture-token"} : {id,login:"octocat",avatar_url:"https://example.test/avatar.png"}),{status:200})));
    const wrong=await github.createAuthorization(verified.memberId);
    if (!wrong.available) throw new Error("Expected OAuth URL");
    await expect(github.completeAuthorization("code",new URL(wrong.authorizeUrl).searchParams.get("state")!))
      .rejects.toMatchObject({code:"GITHUB_ACCOUNT_MISMATCH"});
    expect((await pool.query("SELECT * FROM member_github_accounts")).rows).toHaveLength(0);
    id=123456789;
    const right=await github.createAuthorization(verified.memberId);
    if (!right.available) throw new Error("Expected OAuth URL");
    await expect(github.completeAuthorization("code",new URL(right.authorizeUrl).searchParams.get("state")!)).resolves.toEqual({login:"octocat"});
    expect((await pool.query("SELECT * FROM member_github_accounts")).rows).toHaveLength(1);
    await expectAuthError(auth.resumeRegistration(verified.registrationToken!),"REGISTRATION_SESSION_REQUIRED");
    await expect(pool.query("INSERT INTO member_github_accounts(member_id,github_id) VALUES ($1,$2)",[verified.memberId,"123456789"]))
      .rejects.toMatchObject({code:"23505"});
  });
  it("stores no plaintext email/code and creates one verified member", async () => {
    const sender = new FakeSender();
    const auth = service(sender);

    await expect(auth.sendCode("Student@M.FUDAN.EDU.CN", "203.0.113.9", {studentId:"26300000001",githubLogin:"octocat"})).resolves.toEqual({
      sent: true,
      retryAfterSeconds: 60,
      expiresInSeconds: 600,
    });
    expect(sender.sent).toEqual([{
      to: "student@m.fudan.edu.cn",
      code: "123456",
      expiresInMinutes: 10,
    }]);

    const challenge = await pool.query(
      "SELECT email_fingerprint, requester_ip_fingerprint, code_hash, code_salt, delivery_status FROM email_verification_challenges",
    );
    expect(challenge.rows[0].email_fingerprint).not.toContain("student");
    expect(challenge.rows[0].requester_ip_fingerprint).not.toContain("203.0.113.9");
    expect(challenge.rows[0].code_hash).not.toBe("123456");
    expect(challenge.rows[0].code_salt).not.toBe("");
    expect(challenge.rows[0].delivery_status).toBe("sent");

    await expect(auth.verifyCode("student@m.fudan.edu.cn", "123456"))
      .resolves.toMatchObject({ verified: true, memberId: "1" });

    const member = await pool.query(
      "SELECT email_domain, verification_status, count(*) OVER ()::int AS total FROM members",
    );
    expect(member.rows).toEqual([{
      email_domain: "m.fudan.edu.cn",
      verification_status: "verified",
      total: 1,
    }]);

    await expectAuthError(
      auth.verifyCode("student@m.fudan.edu.cn", "123456"),
      "VERIFICATION_CODE_USED",
    );

    now = new Date(now.getTime() + 61_000);
    nextCode = "654321";
    await expectAuthError(auth.sendCode("student@m.fudan.edu.cn", "203.0.113.9", {studentId:"26300000001",githubLogin:"octocat"}),"ALREADY_REGISTERED");
    const count = await pool.query<{ count: string }>("SELECT count(*) AS count FROM members");
    expect(count.rows[0]?.count).toBe("1");
  });

  it("enforces resend cooldown and the five-attempt limit", async () => {
    const sender = new FakeSender();
    const auth = service(sender);
    await auth.sendCode("student@fudan.edu.cn", "203.0.113.10", {studentId:"26300000001",githubLogin:"octocat"});

    await expectAuthError(
      auth.sendCode("student@fudan.edu.cn", "203.0.113.10", {studentId:"26300000001",githubLogin:"octocat"}),
      "EMAIL_RESEND_TOO_SOON",
    );

    for (let attempt = 0; attempt < 4; attempt++) {
      await expectAuthError(
        auth.verifyCode("student@fudan.edu.cn", "000000"),
        "INVALID_VERIFICATION_CODE",
      );
    }
    await expectAuthError(
      auth.verifyCode("student@fudan.edu.cn", "000000"),
      "VERIFICATION_ATTEMPTS_EXCEEDED",
    );
    await expectAuthError(
      auth.verifyCode("student@fudan.edu.cn", "123456"),
      "VERIFICATION_ATTEMPTS_EXCEEDED",
    );
  });

  it("rejects expired codes and non-Fudan domains", async () => {
    const sender = new FakeSender();
    const auth = service(sender);

    await expectAuthError(
      auth.sendCode("student@example.com", "203.0.113.11", {studentId:"26300000001",githubLogin:"octocat"}),
      "INVALID_FUDAN_EMAIL",
    );

    await auth.sendCode("student@fudan.edu.cn", "203.0.113.11", {studentId:"26300000001",githubLogin:"octocat"});
    now = new Date(now.getTime() + 11 * 60_000);
    await expectAuthError(
      auth.verifyCode("student@fudan.edu.cn", "123456"),
      "VERIFICATION_CODE_EXPIRED",
    );
  });

  it("marks failed deliveries and allows an immediate retry", async () => {
    const sender = new FakeSender();
    const auth = service(sender);
    sender.fail = true;

    await expectAuthError(
      auth.sendCode("student@fudan.edu.cn", "203.0.113.12", {studentId:"26300000001",githubLogin:"octocat"}),
      "EMAIL_DELIVERY_FAILED",
    );
    const failed = await pool.query("SELECT delivery_status FROM email_verification_challenges");
    expect(failed.rows[0]?.delivery_status).toBe("failed");

    sender.fail = false;
    await expect(auth.sendCode("student@fudan.edu.cn", "203.0.113.12", {studentId:"26300000001",githubLogin:"octocat"}))
      .resolves.toMatchObject({ sent: true });
  });
});
