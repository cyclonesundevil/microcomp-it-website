import { z } from "zod";

const booleanValue = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Invalid boolean configuration.");
};

const integerValue = (value: string | undefined, fallback: number, min: number, max: number): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error("Invalid numeric configuration.");
  return parsed;
};

function normalizeOrigin(value: string): string {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Invalid allowed origin configuration.");
  }
  return parsed.origin;
}

export interface Config {
  apiKey: string;
  requireAuth: boolean;
  allowedOrigins: ReadonlySet<string>;
  generalLimit: number;
  simulationLimit: number;
  dailySimulationLimit: number;
  maxRequestBytes: number;
  serverName: string;
  publicBaseUrl?: string;
  logLevel: "error" | "warn" | "info" | "debug";
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const requireAuth = booleanValue(env.MCP_REQUIRE_AUTH, true);
  const apiKey = env.MCP_API_KEY?.trim() ?? "";
  if (requireAuth && !apiKey) throw new Error("MCP_API_KEY is required when authentication is enabled.");
  const origins = (env.MCP_ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",").map(value => value.trim()).filter(Boolean).map(normalizeOrigin);
  const logLevel = z.enum(["error", "warn", "info", "debug"]).parse(env.LOG_LEVEL ?? "info");
  return {
    apiKey,
    requireAuth,
    allowedOrigins: new Set(origins),
    generalLimit: integerValue(env.MCP_RATE_LIMIT_PER_MINUTE, 30, 1, 10000),
    simulationLimit: integerValue(env.MCP_SIMULATION_LIMIT_PER_MINUTE, 10, 1, 10000),
    dailySimulationLimit: integerValue(env.MCP_DAILY_SIMULATION_LIMIT, 500, 1, 1000000),
    maxRequestBytes: integerValue(env.MCP_MAX_REQUEST_BYTES, 65536, 1024, 1048576),
    serverName: (env.MCP_SERVER_NAME?.trim() || "MicroComp IT Cybersecurity Simulation MCP").slice(0, 100),
    publicBaseUrl: env.MCP_PUBLIC_BASE_URL?.trim() ? normalizeOrigin(env.MCP_PUBLIC_BASE_URL.trim()) : undefined,
    logLevel,
    port: integerValue(env.PORT, 3000, 1, 65535)
  };
}
