import type { Request } from "express";
import type { Config } from "./config.js";

export function originAllowed(req: Request, config: Config): boolean {
  const raw = req.header("origin");
  if (raw === undefined) return true;
  if (raw.length > 2048) return false;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    return config.allowedOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

export function hostAllowed(req: Request, config: Config): boolean {
  const raw = req.header("host");
  if (!raw || raw.length > 253 || /[\s/@\\]/.test(raw)) return false;
  try {
    const requested = new URL(`http://${raw}`);
    const allowed = [...config.allowedOrigins].map(value => new URL(value));
    if (config.publicBaseUrl) allowed.push(new URL(config.publicBaseUrl));
    const localConfigured = allowed.some(value => value.hostname === "localhost" || value.hostname === "127.0.0.1");
    if (localConfigured && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(requested.hostname)) return true;
    return allowed.some(value => value.host === requested.host);
  } catch {
    return false;
  }
}
