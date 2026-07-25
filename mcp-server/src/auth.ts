import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import type { Config } from "./config.js";

export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function equalCredential(actual: string, expected: string): boolean {
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function authenticate(req: Request, config: Config): { allowed: boolean; identity: string; keyFingerprint: string } {
  if (!config.requireAuth) {
    const identity = `ip:${req.socket.remoteAddress || "unknown"}`;
    return { allowed: true, identity, keyFingerprint: "auth-disabled" };
  }
  const header = req.header("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match || !equalCredential(match[1]!, config.apiKey)) {
    return { allowed: false, identity: "unauthorized", keyFingerprint: "none" };
  }
  const keyFingerprint = fingerprint(config.apiKey);
  return { allowed: true, identity: `key:${keyFingerprint}`, keyFingerprint };
}
