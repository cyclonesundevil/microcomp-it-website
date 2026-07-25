import type { Config } from "../src/config.js";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: "test-key-that-is-long-and-secret",
    requireAuth: true,
    allowedOrigins: new Set(["http://localhost:3000", "https://microcompit.example"]),
    generalLimit: 100,
    simulationLimit: 100,
    dailySimulationLimit: 1000,
    maxRequestBytes: 65536,
    serverName: "Test Cyber Lab MCP",
    logLevel: "error",
    port: 0,
    ...overrides
  };
}

export const auth = { Authorization: "Bearer test-key-that-is-long-and-secret", Accept: "application/json, text/event-stream" };

export function mcpRequest(id: number, method: string, params?: unknown) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

export const initialize = mcpRequest(1, "initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test-client", version: "1.0.0" }
});
