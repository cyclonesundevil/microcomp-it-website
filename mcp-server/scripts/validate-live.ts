import { randomBytes } from "node:crypto";
import { closeGracefully, createHttpRuntime } from "../src/runtime.js";
import type { Config } from "../src/config.js";
import { exerciseClient } from "./client-runner.js";

const key = randomBytes(32).toString("hex");
const config: Config = {
  apiKey: key,
  requireAuth: true,
  allowedOrigins: new Set(["http://localhost:3000"]),
  generalLimit: 30,
  simulationLimit: 10,
  dailySimulationLimit: 500,
  maxRequestBytes: 65536,
  serverName: "MicroComp IT Cybersecurity Simulation MCP",
  logLevel: "info",
  port: 0
};
const server = createHttpRuntime(config);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local server address unavailable.");
  const base = `http://127.0.0.1:${address.port}`;
  const client = await exerciseClient(`${base}/mcp`, key);
  const health = await fetch(`${base}/health`);
  const initialize = {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1.0.0" } }
  };
  const invalidKey = await fetch(`${base}/mcp`, {
    method: "POST", headers: { Authorization: "Bearer invalid", Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(initialize)
  });
  const disallowedOrigin = await fetch(`${base}/mcp`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, Origin: "https://disallowed.example", Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(initialize)
  });
  console.log(JSON.stringify({
    client,
    healthStatus: health.status,
    invalidKeyStatus: invalidKey.status,
    disallowedOriginStatus: disallowedOrigin.status
  }, null, 2));
} finally {
  await closeGracefully(server);
}
