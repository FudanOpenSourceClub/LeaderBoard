import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createApiRouter, type ApiDependencies } from "../src/api/router.js";
import { EmailAuthError } from "../src/auth/index.js";

const identity = {githubId:"123456789", login:"octocat", avatarUrl:null};
const receipt = "a".repeat(43);
function fixture(overrides: Partial<ApiDependencies> = {}) {
  const emailVerification = {
    sendCode: vi.fn().mockResolvedValue({sent:true,retryAfterSeconds:60,expiresInSeconds:600}),
    verifyCode: vi.fn().mockResolvedValue({verified:true,memberId:"42",registrationToken:receipt}),
  };
  const githubLink = {
    createAuthorization: vi.fn(),
    completeAuthorization: vi.fn().mockResolvedValue({login:"octocat"}),
    completeVerifiedRegistration: vi.fn().mockResolvedValue({login:"octocat"}),
  };
  const websiteAuth = {
    getSession: vi.fn().mockResolvedValue(null),
    getRegistrationIdentity: vi.fn(async token => token === "proof" ? identity : null),
    fromRegistration: vi.fn().mockResolvedValue("new-session"),
    startLogin: vi.fn().mockResolvedValue({authorizeUrl:"https://github.com/login/oauth/authorize?state=register.fixture",browserToken:"nonce"}),
    completeLogin: vi.fn().mockResolvedValue({sessionToken:"proof",returnPath:"/join"}),
  };
  const registrationStatus = vi.fn(async token => token === receipt ? {registered:true as const,login:"octocat"} : {registered:false as const});
  const analytics = {getGroups:vi.fn(),getOrganizationActivitySummary:vi.fn(),getRepositoryStats:vi.fn(),getContributorLeaderboard:vi.fn(),getContributorDetail:vi.fn()};
  const app = createApp({apiRouter:createApiRouter({analytics,emailVerification,githubLink,websiteAuth,registrationStatus,...overrides})});
  return {app,emailVerification,githubLink,websiteAuth,registrationStatus};
}

const registration = {email:"student@fudan.edu.cn",studentId:"26300000001"};
describe("OAuth-backed registration HTTP API", () => {
  it("redirects registration to official OAuth and sets a protected browser nonce", async () => {
    const {app,websiteAuth} = fixture();
    const response = await request(app).get("/api/v1/auth/github/register").expect(303);
    expect(websiteAuth.startLogin).toHaveBeenCalledWith("/join","register");
    expect(response.headers.location).toMatch(/^https:\/\/github.com\/login\/oauth\/authorize/);
    expect(String(response.headers["set-cookie"])).toMatch(/leaderboard_login=nonce.*HttpOnly.*Secure.*SameSite=Lax/);
  });

  it("completes registration OAuth without requiring an existing campus membership", async () => {
    const {app,websiteAuth} = fixture();
    const response = await request(app).get("/api/v1/auth/github/callback?code=abc&state=register.fixture")
      .set("Cookie","leaderboard_login=nonce").expect(303);
    expect(websiteAuth.completeLogin).toHaveBeenCalledWith("abc","register.fixture","nonce");
    expect(response.headers.location).toBe("/join");
    expect(String(response.headers["set-cookie"])).toContain("leaderboard_session=proof");
  });

  it("requires OAuth before sending mail and ignores forged client account fields", async () => {
    const {app,emailVerification} = fixture();
    await request(app).post("/api/v1/auth/email/send-code").send({...registration,githubId:"999",githubLogin:"attacker"})
      .expect(401).expect(res => expect(res.body.error.code).toBe("GITHUB_AUTH_REQUIRED"));
    expect(emailVerification.sendCode).not.toHaveBeenCalled();
    await request(app).post("/api/v1/auth/email/send-code").set("Cookie","leaderboard_session=proof")
      .send({...registration,githubId:"999",githubLogin:"attacker"}).expect(202);
    expect(emailVerification.sendCode).toHaveBeenCalledWith(registration.email,expect.any(String),{studentId:registration.studentId,githubId:identity.githubId,githubLogin:identity.login});
  });

  it("binds the verified email to the OAuth ID and reports success only after the committed record is confirmed", async () => {
    const {app,emailVerification,githubLink,registrationStatus,websiteAuth} = fixture();
    const response = await request(app).post("/api/v1/auth/email/verify").set("Cookie","leaderboard_session=proof")
      .send({email:registration.email,code:"012345"}).expect(200);
    expect(response.body).toEqual({verified:true,registered:true,githubLink:{available:false}});
    expect(emailVerification.verifyCode).toHaveBeenCalledWith(registration.email,"012345",identity.githubId);
    expect(githubLink.completeVerifiedRegistration).toHaveBeenCalledWith("42",identity,receipt);
    expect(registrationStatus).toHaveBeenCalledAfter(githubLink.completeVerifiedRegistration);
    expect(websiteAuth.fromRegistration).toHaveBeenCalledWith(receipt);
    expect(githubLink.createAuthorization).not.toHaveBeenCalled();
    expect(response.text).not.toMatch(/studentId|26300000001|fingerprint|memberId/);
  });

  it("rejects verification without OAuth and malformed requests before sending mail", async () => {
    const {app,emailVerification} = fixture();
    await request(app).post("/api/v1/auth/email/verify").send({email:registration.email,code:"012345"}).expect(401);
    await request(app).post("/api/v1/auth/email/send-code").send({email:"bad"}).expect(400);
    await request(app).post("/api/v1/auth/email/verify").send({email:registration.email,code:"12"}).expect(400);
    expect(emailVerification.sendCode).not.toHaveBeenCalled();
    expect(emailVerification.verifyCode).not.toHaveBeenCalled();
  });

  it("does not report success if the database cannot confirm the binding", async () => {
    const {app} = fixture({registrationStatus:vi.fn().mockResolvedValue({registered:false})});
    await request(app).post("/api/v1/auth/email/verify").set("Cookie","leaderboard_session=proof")
      .send({email:registration.email,code:"012345"}).expect(500)
      .expect(res => expect(res.body.error.code).toBe("REGISTRATION_WRITE_NOT_CONFIRMED"));
  });

  it("maps duplicate and rate-limit errors without exposing internal data", async () => {
    const {app,emailVerification} = fixture();
    emailVerification.sendCode.mockRejectedValueOnce(new EmailAuthError("ALREADY_REGISTERED",409,"该账号已经注册"));
    await request(app).post("/api/v1/auth/email/send-code").set("Cookie","leaderboard_session=proof")
      .send(registration).expect(409,{error:{code:"ALREADY_REGISTERED",message:"该账号已经注册"}});
  });

  it("returns only the verified public GitHub identity and disables caching", async () => {
    const {app,websiteAuth} = fixture();
    websiteAuth.getRegistrationIdentity.mockResolvedValueOnce({...identity,studentId:"private",name:"private"} as typeof identity);
    await request(app).get("/api/v1/auth/github/registration").set("Cookie","leaderboard_session=proof")
      .expect("Cache-Control","no-store").expect(200,{verified:true,githubId:identity.githubId,login:identity.login});
    await request(app).get("/api/v1/auth/github/registration?githubId=999").expect(200,{verified:false});
  });

  it("does not infer registered status from forged URL parameters or an older account's receipt", async () => {
    const {app} = fixture();
    await request(app).get("/api/v1/auth/registration/status?github=success&login=octocat")
      .expect("Cache-Control","no-store").expect(200,{registered:false});
    await request(app).get("/api/v1/auth/registration/status")
      .set("Cookie",`leaderboard_session=proof; leaderboard_registration=${receipt}`).expect(200,{registered:false});
  });

  it("continues previously issued email-first registration callbacks", async () => {
    const {app,githubLink} = fixture();
    const response = await request(app).get("/api/v1/auth/github/callback?code=abc&state=legacy-state")
      .set("Cookie",`leaderboard_registration=${receipt}`).expect(303);
    expect(githubLink.completeAuthorization).toHaveBeenCalledWith("abc","legacy-state",receipt);
    expect(response.headers.location).toBe("/join?github=success");
  });
});
