import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { getDbPool, withTransaction } from "../db/index.js";

const CODE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const EMAIL_HOURLY_LIMIT = 5;
const IP_HOURLY_LIMIT = 20;
const MAX_ATTEMPTS = 5;

export interface VerificationEmailSender {
  sendVerificationCode(input: {
    to: string;
    code: string;
    expiresInMinutes: number;
  }): Promise<void>;
}

export interface RegistrationInput { studentId: string; githubLogin: string }
export interface EmailVerificationApi {
  sendCode(email: string, requesterIp: string, registration: RegistrationInput): Promise<{
    sent: true;
    retryAfterSeconds: number;
    expiresInSeconds: number;
  }>;
  verifyCode(email: string, code: string): Promise<{ verified: true; memberId: string; registrationToken?: string }>;
  resumeRegistration?(token: string): Promise<string>;
}

export class EmailAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EmailAuthError";
  }
}

export class UnavailableEmailVerificationApi implements EmailVerificationApi {
  async sendCode(): Promise<never> {
    throw new EmailAuthError("EMAIL_AUTH_NOT_CONFIGURED", 503, "邮箱验证服务尚未配置");
  }

  async verifyCode(): Promise<never> {
    throw new EmailAuthError("EMAIL_AUTH_NOT_CONFIGURED", 503, "邮箱验证服务尚未配置");
  }
}

export interface EmailVerificationOptions {
  sender: VerificationEmailSender;
  hmacSecret: string;
  allowedDomains: string[];
  now?: () => Date;
  generateCode?: () => string;
  lookupGithubAccount?: (login: string) => Promise<{ githubId: string; login: string }>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

function isAllowedDomain(domain: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function hmacFingerprint(secret: string, prefix: string, value: string): string {
  return createHmac("sha256", secret).update(`${prefix}:${value}`).digest("hex");
}

function hashCode(code: string, salt: string): Buffer {
  return scryptSync(code, salt, 32);
}

function safeCodeMatches(code: string, salt: string, expectedHex: string): boolean {
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  const actual = hashCode(code, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function lockFingerprint(client: PoolClient, fingerprint: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [fingerprint]);
}

export class EmailVerificationService implements EmailVerificationApi {
  private readonly now: () => Date;
  private readonly generateCode: () => string;
  private readonly domains: string[];

  constructor(private readonly options: EmailVerificationOptions) {
    if (options.hmacSecret.length < 32) {
      throw new Error("EMAIL_HMAC_SECRET must be at least 32 characters");
    }
    this.domains = options.allowedDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
    if (this.domains.length === 0) throw new Error("At least one Fudan email domain is required");
    this.now = options.now ?? (() => new Date());
    this.generateCode = options.generateCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  }

  private async lookupGithubAccount(login: string): Promise<{ githubId: string; login: string }> {
    if (this.options.lookupGithubAccount) return this.options.lookupGithubAccount(login);
    const token=process.env.GITHUB_TOKEN?.trim();
    let response: Response;
    try {
      response=await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
        headers: { Accept:"application/vnd.github+json", "User-Agent":"LeaderBoard", ...(token ? {Authorization:`Bearer ${token}`} : {}) },
        signal:AbortSignal.timeout(12000),
      });
    } catch { throw new EmailAuthError("GITHUB_LOOKUP_UNAVAILABLE",503,"暂时无法核验 GitHub 账号"); }
    if (response.status===404) throw new EmailAuthError("GITHUB_ACCOUNT_NOT_FOUND",400,"GitHub 账号不存在");
    if (!response.ok) throw new EmailAuthError("GITHUB_LOOKUP_UNAVAILABLE",503,"暂时无法核验 GitHub 账号");
    const account=await response.json() as {id?:unknown;login?:unknown;type?:unknown};
    if (typeof account.id!=="number" || !Number.isSafeInteger(account.id) || account.id<=0
        || typeof account.login!=="string" || account.login.toLowerCase()!==login.toLowerCase() || account.type!=="User") {
      throw new EmailAuthError("INVALID_GITHUB_ACCOUNT",400,"请填写个人 GitHub 账号");
    }
    return {githubId:String(account.id),login:account.login};
  }

  private async ensureAvailable(client: PoolClient, email: string, student: string, githubId: string): Promise<void> {
    const duplicate=await client.query(
      `SELECT 1 FROM members WHERE email_fingerprint=$1 OR student_fingerprint=$2 OR registration_github_id=$3
       UNION ALL SELECT 1 FROM github_accounts WHERE github_id=$3
       UNION ALL SELECT 1 FROM contributors WHERE github_id=$3 AND enrolled_at IS NOT NULL LIMIT 1`,
      [email,student,githubId],
    );
    if (duplicate.rows.length) throw new EmailAuthError("ALREADY_REGISTERED",409,"该学号、邮箱或 GitHub 账号已经注册，不能重复注册");
  }

  async resumeRegistration(token: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new EmailAuthError("REGISTRATION_SESSION_REQUIRED",401,"请先完成邮箱验证");
    const hash=createHash("sha256").update(token).digest("hex");
    const result=await getDbPool().query<{id:string}>(
      `SELECT m.id::text FROM members m WHERE m.registration_session_hash=$1
       AND m.registration_session_expires_at>$2
       AND NOT EXISTS (SELECT 1 FROM member_github_accounts a WHERE a.member_id=m.id)`,[hash,this.now()],
    );
    if (!result.rows[0]) throw new EmailAuthError("REGISTRATION_SESSION_REQUIRED",401,"没有可继续的注册，请先完成邮箱验证");
    return result.rows[0].id;
  }

  async sendCode(rawEmail: string, requesterIp: string, registration: RegistrationInput): Promise<{
    sent: true;
    retryAfterSeconds: number;
    expiresInSeconds: number;
  }> {
    const email = normalizeEmail(rawEmail);
    const domain = emailDomain(email);
    if (!email.includes("@") || !isAllowedDomain(domain, this.domains)) {
      throw new EmailAuthError("INVALID_FUDAN_EMAIL", 400, "请输入有效的复旦邮箱");
    }

    if (!registration || !/^[0-9]{6,20}$/.test(registration.studentId.trim())
        || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(registration.githubLogin.trim())) {
      throw new EmailAuthError("INVALID_REGISTRATION", 400, "请填写学号和 GitHub 用户名");
    }
    const identity = await this.lookupGithubAccount(registration.githubLogin.trim());
    const studentFingerprint = hmacFingerprint(this.options.hmacSecret, "student", registration.studentId.trim());
    const now = this.now();
    const fingerprint = hmacFingerprint(this.options.hmacSecret, "email", email);
    const ipFingerprint = hmacFingerprint(this.options.hmacSecret, "ip", requesterIp || "unknown");
    const hourStart = new Date(now.getTime() - 60 * 60_000);
    const code = this.generateCode();
    if (!/^\d{6}$/.test(code)) throw new Error("Verification code generator must return six digits");
    const salt = randomBytes(16).toString("hex");
    const codeHash = hashCode(code, salt).toString("hex");
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

    const challengeId = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(1279411270)");
      await lockFingerprint(client, fingerprint);
      await this.ensureAvailable(client, fingerprint, studentFingerprint, identity.githubId);

      const latest = await client.query<{ created_at: Date }>(
        `SELECT created_at
           FROM email_verification_challenges
          WHERE email_fingerprint=$1
            AND delivery_status IN ('pending','sent')
          ORDER BY created_at DESC
          LIMIT 1`,
        [fingerprint],
      );
      const latestAt = latest.rows[0]?.created_at;
      if (latestAt && now.getTime() - latestAt.getTime() < RESEND_COOLDOWN_MS) {
        const seconds = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - latestAt.getTime())) / 1000));
        throw new EmailAuthError("EMAIL_RESEND_TOO_SOON", 429, `请在 ${seconds} 秒后重新发送`);
      }

      const emailCount = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM email_verification_challenges
          WHERE email_fingerprint=$1
            AND created_at >= $2
            AND delivery_status IN ('pending','sent')`,
        [fingerprint, hourStart],
      );
      if ((emailCount.rows[0]?.count ?? 0) >= EMAIL_HOURLY_LIMIT) {
        throw new EmailAuthError("EMAIL_RATE_LIMITED", 429, "该邮箱发送过于频繁，请稍后再试");
      }

      const ipCount = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM email_verification_challenges
          WHERE requester_ip_fingerprint=$1
            AND created_at >= $2
            AND delivery_status IN ('pending','sent')`,
        [ipFingerprint, hourStart],
      );
      if ((ipCount.rows[0]?.count ?? 0) >= IP_HOURLY_LIMIT) {
        throw new EmailAuthError("IP_RATE_LIMITED", 429, "请求过于频繁，请稍后再试");
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO email_verification_challenges
           (email_fingerprint, email_domain, requester_ip_fingerprint, code_hash, code_salt,
            expires_at, attempt_count, delivery_status, created_at,
            student_fingerprint, requested_github_id, requested_github_login)
         VALUES ($1,$2,$3,$4,$5,$6,0,'pending',$7,$8,$9,$10)
         RETURNING id::text`,
        [fingerprint, domain, ipFingerprint, codeHash, salt, expiresAt, now, studentFingerprint, identity.githubId, identity.login],
      );
      return inserted.rows[0]!.id;
    });

    try {
      await this.options.sender.sendVerificationCode({ to: email, code, expiresInMinutes: 10 });
      await getDbPool().query(
        "UPDATE email_verification_challenges SET delivery_status='sent', sent_at=$2 WHERE id=$1",
        [challengeId, this.now()],
      );
    } catch {
      await getDbPool().query(
        "UPDATE email_verification_challenges SET delivery_status='failed' WHERE id=$1",
        [challengeId],
      ).catch(() => undefined);
      throw new EmailAuthError("EMAIL_DELIVERY_FAILED", 503, "验证码邮件暂时无法发送，请稍后再试");
    }

    return { sent: true, retryAfterSeconds: 60, expiresInSeconds: 600 };
  }

  async verifyCode(rawEmail: string, code: string): Promise<{ verified: true; memberId: string; registrationToken?: string }> {
    const email = normalizeEmail(rawEmail);
    const domain = emailDomain(email);
    if (!email.includes("@") || !isAllowedDomain(domain, this.domains)) {
      throw new EmailAuthError("INVALID_FUDAN_EMAIL", 400, "请输入有效的复旦邮箱");
    }
    if (!/^\d{6}$/.test(code)) {
      throw new EmailAuthError("INVALID_VERIFICATION_CODE", 400, "请输入 6 位数字验证码");
    }

    const now = this.now();
    const fingerprint = hmacFingerprint(this.options.hmacSecret, "email", email);

    const registrationToken = randomBytes(32).toString("base64url");
    const sessionHash = createHash("sha256").update(registrationToken).digest("hex");
    const result = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(1279411270)");
      await lockFingerprint(client, fingerprint);
      const found = await client.query<{
        id: string;
        code_hash: string;
        code_salt: string;
        expires_at: Date;
        attempt_count: number;
        used_at: Date | null;
        student_fingerprint: string | null;
        requested_github_id: string | null;
      }>(
        `SELECT id::text, code_hash, code_salt, expires_at, attempt_count, used_at,
                  student_fingerprint, requested_github_id::text
           FROM email_verification_challenges
          WHERE email_fingerprint=$1
            AND delivery_status IN ('pending','sent')
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [fingerprint],
      );
      const challenge = found.rows[0];
      if (!challenge) return { kind: "invalid" as const };
      if (challenge.used_at) return { kind: "used" as const };
      if (challenge.expires_at.getTime() <= now.getTime()) return { kind: "expired" as const };
      if (challenge.attempt_count >= MAX_ATTEMPTS) return { kind: "locked" as const };

      if (!safeCodeMatches(code, challenge.code_salt, challenge.code_hash)) {
        const nextAttempts = challenge.attempt_count + 1;
        await client.query(
          "UPDATE email_verification_challenges SET attempt_count=$2 WHERE id=$1",
          [challenge.id, nextAttempts],
        );
        return { kind: nextAttempts >= MAX_ATTEMPTS ? "locked" as const : "invalid" as const };
      }

      if (!challenge.student_fingerprint || !challenge.requested_github_id) {
        throw new EmailAuthError("INVALID_REGISTRATION", 400, "请重新填写注册信息并获取验证码");
      }
      await this.ensureAvailable(client, fingerprint, challenge.student_fingerprint, challenge.requested_github_id);
      await client.query(
        "UPDATE email_verification_challenges SET used_at=$2 WHERE id=$1",
        [challenge.id, now],
      );
      const member = await client.query<{ id: string }>(
        `INSERT INTO members
           (email_fingerprint, email_domain, verification_status, verified_at, last_reverified_at, created_at, updated_at,
            student_fingerprint, registration_github_id, registration_session_hash, registration_session_expires_at)
         VALUES ($1,$2,'verified',$3,$3,$3,$3,$4,$5,$6,$7)
         RETURNING id::text`,
        [fingerprint, domain, now, challenge.student_fingerprint, challenge.requested_github_id,
          sessionHash, new Date(now.getTime()+7*86400000)],
      );
      return { kind: "verified" as const, memberId: member.rows[0]!.id };
    });

    switch (result.kind) {
      case "verified": return { verified: true, memberId: result.memberId, registrationToken };
      case "used": throw new EmailAuthError("VERIFICATION_CODE_USED", 400, "该验证码已使用，请重新获取");
      case "expired": throw new EmailAuthError("VERIFICATION_CODE_EXPIRED", 400, "验证码已过期，请重新获取");
      case "locked": throw new EmailAuthError("VERIFICATION_ATTEMPTS_EXCEEDED", 429, "验证码尝试次数过多，请重新获取");
      default: throw new EmailAuthError("INVALID_VERIFICATION_CODE", 400, "验证码错误");
    }
  }
}
