import { describe, expect, it } from "vitest";
import {
  EmailCodeRequestSchema,
  EmailCodeSendResponseSchema,
  EmailCodeVerifyRequestSchema,
  EmailCodeVerifyResponseSchema,
} from "../src/index.js";

describe("email verification contracts", () => {
  it("accepts normalized email requests and six-digit codes", () => {
    expect(EmailCodeRequestSchema.parse({ email: " student@fudan.edu.cn ", studentId:"26300000001", githubLogin:"octocat" })).toEqual({
      email: "student@fudan.edu.cn", studentId:"26300000001",
    });
    expect(EmailCodeVerifyRequestSchema.parse({
      email: "student@m.fudan.edu.cn",
      code: "012345",
    })).toEqual({ email: "student@m.fudan.edu.cn", code: "012345" });
  });

  it("rejects malformed email and verification codes", () => {
    expect(EmailCodeRequestSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(EmailCodeVerifyRequestSchema.safeParse({
      email: "student@fudan.edu.cn",
      code: "12345",
    }).success).toBe(false);
    expect(EmailCodeVerifyRequestSchema.safeParse({
      email: "student@fudan.edu.cn",
      code: "12345a",
    }).success).toBe(false);
  });

  it("validates response shapes", () => {
    expect(EmailCodeSendResponseSchema.parse({
      sent: true,
      retryAfterSeconds: 60,
      expiresInSeconds: 600,
    })).toEqual({ sent: true, retryAfterSeconds: 60, expiresInSeconds: 600 });
    expect(EmailCodeVerifyResponseSchema.parse({
      verified: true,
      githubLink: { available: false },
    })).toEqual({ verified: true, githubLink: { available: false } });
  });
});
