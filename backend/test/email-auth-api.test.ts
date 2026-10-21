import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createApiRouter } from "../src/api/router.js";
import { EmailAuthError } from "../src/auth/index.js";

function emailDependencies() {
  return {
    emailVerification: {
      sendCode: vi.fn().mockResolvedValue({
        sent: true as const,
        retryAfterSeconds: 60,
        expiresInSeconds: 600,
      }),
      verifyCode: vi.fn().mockResolvedValue({ verified: true as const, memberId: "42" }),
    },
  };
}

function routerWithEmail(emailVerification?: ReturnType<typeof emailDependencies>["emailVerification"]) {
  return createApiRouter({
    analytics: {
      async getGroups() { return []; },
      async getOrganizationActivitySummary(range) {
        return { range, repositories: 0, contributors: 0, commits: 0, prs: 0, issues: 0, total: 0 };
      },
      async getRepositoryStats() { return []; },
      async getContributorLeaderboard() { return []; },
      async getContributorDetail() { return null; },
    },
    async getSyncStatus() {
      return {
        lastSuccessfulRunAt: null,
        lastRunStatus: null,
        nextScheduledRunAt: null,
        dataStatus: "missing" as const,
      };
    },
    ...(emailVerification === undefined ? {} : { emailVerification }),
  });
}

describe("email verification HTTP API", () => {
  it("sends a code through the shared response contract", async () => {
    const deps = emailDependencies();
    const app = createApp({ apiRouter: routerWithEmail(deps.emailVerification) });
    const response = await request(app)
      .post("/api/v1/auth/email/send-code")
      .send({ email: "student@fudan.edu.cn", studentId:"26300000001", githubLogin:"octocat" })
      .expect(202);

    expect(response.body).toEqual({
      sent: true,
      retryAfterSeconds: 60,
      expiresInSeconds: 600,
    });
    expect(deps.emailVerification.sendCode).toHaveBeenCalledWith(
      "student@fudan.edu.cn",
      expect.any(String),
      {studentId:"26300000001",githubLogin:"octocat"},
    );
  });

  it("verifies a six-digit code", async () => {
    const deps = emailDependencies();
    const app = createApp({ apiRouter: routerWithEmail(deps.emailVerification) });
    await request(app)
      .post("/api/v1/auth/email/verify")
      .send({ email: "student@m.fudan.edu.cn", code: "012345" })
      .expect(200, { verified: true, githubLink: { available: false } });

    expect(deps.emailVerification.verifyCode).toHaveBeenCalledWith(
      "student@m.fudan.edu.cn",
      "012345",
    );
  });

  it("rejects malformed input before calling the service", async () => {
    const deps = emailDependencies();
    const app = createApp({ apiRouter: routerWithEmail(deps.emailVerification) });
    const badEmail = await request(app)
      .post("/api/v1/auth/email/send-code")
      .send({ email: "bad" })
      .expect(400);
    expect(badEmail.body.error.code).toBe("INVALID_EMAIL");

    const badCode = await request(app)
      .post("/api/v1/auth/email/verify")
      .send({ email: "student@fudan.edu.cn", code: "12" })
      .expect(400);
    expect(badCode.body.error.code).toBe("INVALID_VERIFICATION_CODE");
    expect(deps.emailVerification.sendCode).not.toHaveBeenCalled();
    expect(deps.emailVerification.verifyCode).not.toHaveBeenCalled();
  });

  it("maps safe authentication errors without leaking internals", async () => {
    const deps = emailDependencies();
    deps.emailVerification.sendCode.mockRejectedValueOnce(
      new EmailAuthError("EMAIL_RATE_LIMITED", 429, "该邮箱发送过于频繁，请稍后再试"),
    );
    const app = createApp({ apiRouter: routerWithEmail(deps.emailVerification) });
    const response = await request(app)
      .post("/api/v1/auth/email/send-code")
      .send({ email: "student@fudan.edu.cn", studentId:"26300000001", githubLogin:"octocat" })
      .expect(429);

    expect(response.body).toEqual({
      error: { code: "EMAIL_RATE_LIMITED", message: "该邮箱发送过于频繁，请稍后再试" },
    });
  });

  it("returns service unavailable when email verification is not configured", async () => {
    const app = createApp({ apiRouter: routerWithEmail() });
    const response = await request(app)
      .post("/api/v1/auth/email/send-code")
      .send({ email: "student@fudan.edu.cn", studentId:"26300000001", githubLogin:"octocat" })
      .expect(503);
    expect(response.body.error.code).toBe("EMAIL_AUTH_NOT_CONFIGURED");
  });
});


describe("GitHub linking HTTP API", () => {
  it("returns an authorization URL after email verification when configured", async () => {
    const deps = emailDependencies();
    const githubLink = {
      createAuthorization: vi.fn().mockResolvedValue({
        available: true as const,
        authorizeUrl: "https://github.com/login/oauth/authorize?client_id=test&state=abc",
      }),
      completeAuthorization: vi.fn(),
    };
    const app = createApp({
      apiRouter: createApiRouter({
        analytics: {
          async getGroups() { return []; },
          async getOrganizationActivitySummary(range) {
            return { range, repositories: 0, contributors: 0, commits: 0, prs: 0, issues: 0, total: 0 };
          },
          async getRepositoryStats() { return []; },
          async getContributorLeaderboard() { return []; },
          async getContributorDetail() { return null; },
        },
        async getSyncStatus() {
          return {
            lastSuccessfulRunAt: null,
            lastRunStatus: null,
            nextScheduledRunAt: null,
            dataStatus: "missing" as const,
          };
        },
        emailVerification: deps.emailVerification,
        githubLink,
      }),
    });

    const response = await request(app)
      .post("/api/v1/auth/email/verify")
      .send({ email: "student@fudan.edu.cn", code: "012345" })
      .expect(200);

    expect(response.body).toEqual({
      verified: true,
      githubLink: {
        available: true,
        authorizeUrl: "https://github.com/login/oauth/authorize?client_id=test&state=abc",
      },
    });
    expect(githubLink.createAuthorization).toHaveBeenCalledWith("42");
  });

  it("redirects a successful GitHub callback back to the join page", async () => {
    const githubLink = {
      createAuthorization: vi.fn(),
      completeAuthorization: vi.fn().mockResolvedValue({ login: "octocat" }),
    };
    const app = createApp({
      apiRouter: createApiRouter({
        analytics: {
          async getGroups() { return []; },
          async getOrganizationActivitySummary(range) {
            return { range, repositories: 0, contributors: 0, commits: 0, prs: 0, issues: 0, total: 0 };
          },
          async getRepositoryStats() { return []; },
          async getContributorLeaderboard() { return []; },
          async getContributorDetail() { return null; },
        },
        async getSyncStatus() {
          return {
            lastSuccessfulRunAt: null,
            lastRunStatus: null,
            nextScheduledRunAt: null,
            dataStatus: "missing" as const,
          };
        },
        githubLink,
      }),
    });

    const response = await request(app)
      .get("/api/v1/auth/github/callback?code=abc&state=xyz")
      .expect(303);

    expect(response.headers.location).toBe("/join?github=success&login=octocat");
    expect(githubLink.completeAuthorization).toHaveBeenCalledWith("abc", "xyz");
  });
});
