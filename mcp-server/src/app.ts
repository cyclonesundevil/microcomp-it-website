import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { authenticate } from "./auth.js";
import { hostAllowed, originAllowed } from "./origin-validation.js";
import { RateLimiter } from "./rate-limit.js";
import { log } from "./logger.js";
import { createMcpServer } from "./mcp-server.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      keyFingerprint?: string;
      rateLimitDecision?: string;
      startedAt?: number;
    }
  }
}

function jsonError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function simulationUnits(req: Request): number {
  if (req.body?.method !== "tools/call") return 0;
  if (req.body?.params?.name === "run_simulation") return 1;
  if (req.body?.params?.name === "compare_defenses") return 2;
  return 0;
}

export function createApp(config: Config) {
  const app = express();
  const limiter = new RateLimiter(config.generalLimit, config.simulationLimit, config.dailySimulationLimit);
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  app.use((req, res, next) => {
    req.requestId = randomUUID();
    req.startedAt = Date.now();
    res.on("finish", () => {
      const argumentsValue = req.body?.method === "tools/call" ? req.body?.params?.arguments : undefined;
      log({
        requestId: req.requestId!,
        route: req.originalUrl.split("?")[0]!.slice(0, 100),
        mcpMethod: typeof req.body?.method === "string" ? req.body.method.slice(0, 80) : undefined,
        toolName: typeof req.body?.params?.name === "string" ? req.body.params.name.slice(0, 80) : undefined,
        status: res.statusCode,
        durationMs: Date.now() - req.startedAt!,
        rateLimitDecision: req.rateLimitDecision,
        keyFingerprint: req.keyFingerprint,
        scenarioId: typeof argumentsValue?.scenarioId === "string" ? argumentsValue.scenarioId.slice(0, 30) : undefined,
        seed: Number.isInteger(argumentsValue?.seed) ? argumentsValue.seed : undefined
      });
    });
    next();
  });

  app.get("/health", (_req, res) => res.status(200).json({ status: "ok", service: "microcompit-cyberlab-mcp", version: "1.0.0" }));
  app.get("/", (_req, res) => res.status(200).json({
    name: "MicroComp IT Cybersecurity Simulation MCP",
    description: "A defensive educational MCP server for deterministic synthetic cybersecurity simulations.",
    mcpEndpoint: "/mcp",
    healthEndpoint: "/health",
    authenticationRequired: config.requireAuth,
    syntheticOnly: true
  }));

  app.use("/mcp", (req, res, next) => {
    if (!originAllowed(req, config) || !hostAllowed(req, config)) return jsonError(res, 403, "Forbidden.");
    const auth = authenticate(req, config);
    req.keyFingerprint = auth.keyFingerprint;
    if (!auth.allowed) return jsonError(res, 401, "Unauthorized.");
    (req as Request & { rateIdentity?: string }).rateIdentity = auth.identity;
    const contentLength = Number(req.header("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > config.maxRequestBytes) return jsonError(res, 413, "Request too large.");
    next();
  });

  app.use("/mcp", express.json({ limit: config.maxRequestBytes, strict: true, type: ["application/json", "application/*+json"] }));

  app.use("/mcp", (req, res, next) => {
    const identity = (req as Request & { rateIdentity?: string }).rateIdentity ?? "unknown";
    const result = limiter.check(identity, simulationUnits(req));
    req.rateLimitDecision = result.decision;
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfter));
      return jsonError(res, 429, "Rate limit exceeded.");
    }
    next();
  });

  const handleMcp = async (req: Request, res: Response) => {
    const server = createMcpServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) jsonError(res, 500, "The MCP request could not be completed.");
    }
  };
  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = error?.type === "entity.too.large" ? 413 : 400;
    jsonError(res, status, status === 413 ? "Request too large." : "Invalid JSON request.");
  };
  app.use(errorHandler);
  app.use((_req: Request, res: Response, _next: NextFunction) => jsonError(res, 404, "Not found."));
  return app;
}
