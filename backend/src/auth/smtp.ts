import { once } from "node:events";
import { hostname } from "node:os";
import { connect as connectNet, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import type { VerificationEmailSender } from "./email-verification.js";

type SmtpSocket = Socket | TLSSocket;

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  startTls: boolean;
  user: string;
  password: string;
  from: string;
}

interface SmtpResponse {
  code: number;
  text: string;
}

class ResponseReader {
  private buffer = "";
  private currentLines: string[] = [];
  private currentCode: string | null = null;
  private readonly queued: SmtpResponse[] = [];
  private readonly waiters: Array<{
    resolve(value: SmtpResponse): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(private readonly socket: SmtpSocket) {
    socket.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("SMTP connection closed")));
  }

  next(timeoutMs = 15_000): Promise<SmtpResponse> {
    const queued = this.queued.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("SMTP response timed out"));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const raw = this.buffer.slice(0, newline + 1);
      this.buffer = this.buffer.slice(newline + 1);
      const line = raw.replace(/\r?\n$/, "");
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) {
        if (this.currentCode) this.currentLines.push(line);
        continue;
      }
      if (this.currentCode === null) this.currentCode = match[1]!;
      this.currentLines.push(line);
      if (match[2] === " " && match[1] === this.currentCode) {
        this.push({ code: Number(match[1]), text: this.currentLines.join("\n") });
        this.currentLines = [];
        this.currentCode = null;
      }
    }
  }

  private push(response: SmtpResponse): void {
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.queued.push(response);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(response);
  }

  private fail(error: Error): void {
    while (this.waiters.length) {
      const waiter = this.waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

function expectCode(response: SmtpResponse, expected: number | number[]): void {
  const values = Array.isArray(expected) ? expected : [expected];
  if (!values.includes(response.code)) {
    throw new Error(`SMTP command failed with status ${response.code}`);
  }
}

async function command(
  socket: SmtpSocket,
  reader: ResponseReader,
  line: string,
  expected: number | number[],
): Promise<SmtpResponse> {
  socket.write(`${line}\r\n`);
  const response = await reader.next();
  expectCode(response, expected);
  return response;
}

function envelopeAddress(from: string): string {
  if (/[\r\n]/.test(from)) throw new Error("Invalid MAIL_FROM");
  const angle = /<([^<>]+)>/.exec(from);
  const value = (angle?.[1] ?? from).trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(value)) throw new Error("Invalid MAIL_FROM");
  return value;
}

function headerValue(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Invalid email header");
  return value;
}

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function wrapBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export class SmtpEmailSender implements VerificationEmailSender {
  constructor(private readonly config: SmtpConfig) {}

  async sendVerificationCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void> {
    let socket: SmtpSocket;
    let reader: ResponseReader;

    if (this.config.secure) {
      const secureSocket = connectTls({
        host: this.config.host,
        port: this.config.port,
        servername: this.config.host,
        minVersion: "TLSv1.2",
      });
      await once(secureSocket, "secureConnect");
      socket = secureSocket;
      reader = new ResponseReader(socket);
    } else {
      const plainSocket = connectNet({ host: this.config.host, port: this.config.port });
      await once(plainSocket, "connect");
      socket = plainSocket;
      reader = new ResponseReader(socket);
    }

    try {
      expectCode(await reader.next(), 220);
      await command(socket, reader, `EHLO ${hostname() || "leadboard"}`, 250);

      if (!this.config.secure && this.config.startTls) {
        await command(socket, reader, "STARTTLS", 220);
        const secureSocket = connectTls({
          socket: socket as Socket,
          servername: this.config.host,
          minVersion: "TLSv1.2",
        });
        await once(secureSocket, "secureConnect");
        socket = secureSocket;
        reader = new ResponseReader(socket);
        await command(socket, reader, `EHLO ${hostname() || "leadboard"}`, 250);
      }

      await command(socket, reader, "AUTH LOGIN", 334);
      await command(socket, reader, Buffer.from(this.config.user).toString("base64"), 334);
      await command(socket, reader, Buffer.from(this.config.password).toString("base64"), 235);

      const fromAddress = envelopeAddress(this.config.from);
      await command(socket, reader, `MAIL FROM:<${fromAddress}>`, 250);
      await command(socket, reader, `RCPT TO:<${headerValue(input.to)}>`, [250, 251]);
      await command(socket, reader, "DATA", 354);

      const subject = encodeSubject("LeaderBoard 复旦身份验证码");
      const body = `你的 LeaderBoard 验证码是：${input.code}\n\n验证码 ${input.expiresInMinutes} 分钟内有效，请勿转发给他人。\n\n如果这不是你的操作，可以忽略此邮件。`;
      const message = [
        `From: ${headerValue(this.config.from)}`,
        `To: ${headerValue(input.to)}`,
        `Subject: ${subject}`,
        `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(body),
      ].join("\r\n");

      socket.write(`${message}\r\n.\r\n`);
      expectCode(await reader.next(), 250);
      await command(socket, reader, "QUIT", 221).catch(() => undefined);
    } finally {
      socket.destroy();
    }
  }
}

export class UnavailableEmailSender implements VerificationEmailSender {
  async sendVerificationCode(): Promise<never> {
    throw new Error("SMTP is not configured");
  }
}
