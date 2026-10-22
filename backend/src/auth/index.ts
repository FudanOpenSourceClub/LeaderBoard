import {
  EmailVerificationService,
  UnavailableEmailVerificationApi,
  type EmailVerificationApi,
  type VerificationEmailSender,
} from "./email-verification.js";
import { SmtpEmailSender, UnavailableEmailSender, type SmtpConfig } from "./smtp.js";

function listDomains(value: string | undefined): string[] {
  return (value ?? "fudan.edu.cn,m.fudan.edu.cn")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function boolSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

export function smtpSender(env: NodeJS.ProcessEnv): SmtpEmailSender | UnavailableEmailSender {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.trim();
  const from = env.MAIL_FROM?.trim();
  const port = Number(env.SMTP_PORT ?? "465");
  if (!host || !user || !password || !from || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return new UnavailableEmailSender();
  }

  const secure = boolSetting(env.SMTP_SECURE, port === 465);
  const config: SmtpConfig = {
    host,
    port,
    secure,
    startTls: secure ? false : boolSetting(env.SMTP_STARTTLS, true),
    user,
    password,
    from,
  };
  return new SmtpEmailSender(config);
}

export function createEmailVerificationServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EmailVerificationApi {
  const secret = env.EMAIL_HMAC_SECRET?.trim();
  if (!secret || secret.length < 32) return new UnavailableEmailVerificationApi();

  try {
    return new EmailVerificationService({
      sender: smtpSender(env),
      hmacSecret: secret,
      allowedDomains: listDomains(env.FUDAN_EMAIL_DOMAINS),
    });
  } catch {
    return new UnavailableEmailVerificationApi();
  }
}

export {
  EmailAuthError,
  EmailVerificationService,
  UnavailableEmailVerificationApi,
  type EmailVerificationApi,
  type VerificationEmailSender,
} from "./email-verification.js";

export {
  createGitHubLinkServiceFromEnv,
  GitHubLinkError,
  GitHubOAuthLinkService,
  UnavailableGitHubLinkApi,
  type GitHubLinkApi,
  type GitHubLinkInfo,
} from "./github-link.js";
