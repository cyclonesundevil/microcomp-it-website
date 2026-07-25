import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { auth, initialize, mcpRequest, testConfig } from "./helpers.js";

describe("public HTTP and MCP security", () => {
  it("returns an unauthenticated health response", async () => {
    const response = await request(createApp(testConfig())).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "microcompit-cyberlab-mcp", version: "1.0.0" });
  });
  it("returns only safe root metadata", async () => {
    const response = await request(createApp(testConfig())).get("/");
    expect(response.status).toBe(200);
    expect(response.body.syntheticOnly).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/apiKey|internal|dependency|repository/i);
  });
  it("returns a minimal JSON 404", async () => {
    const response = await request(createApp(testConfig())).get("/unknown");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found." });
  });
  it("rejects a missing credential", async () => {
    expect((await request(createApp(testConfig())).post("/mcp").send(initialize)).status).toBe(401);
  });
  it("rejects an invalid credential without echoing it", async () => {
    const response = await request(createApp(testConfig())).post("/mcp").set("Authorization", "Bearer leaked-value").send(initialize);
    expect(response.status).toBe(401);
    expect(response.text).not.toContain("leaked-value");
  });
  it("permits initialize with a valid key", async () => {
    const response = await request(createApp(testConfig())).post("/mcp").set(auth).send(initialize);
    expect(response.status).toBe(200);
    expect(response.body.result.serverInfo.name).toBe("Test Cyber Lab MCP");
  });
  it("allows an exact configured origin", async () => {
    const response = await request(createApp(testConfig())).post("/mcp").set(auth).set("Origin", "https://microcompit.example/").send(initialize);
    expect(response.status).toBe(200);
  });
  it("allows a native client with no Origin", async () => {
    expect((await request(createApp(testConfig())).post("/mcp").set(auth).send(initialize)).status).toBe(200);
  });
  it("rejects an unapproved origin", async () => {
    expect((await request(createApp(testConfig())).post("/mcp").set(auth).set("Origin", "https://evil.example").send(initialize)).status).toBe(403);
  });
  it("rejects a malformed origin", async () => {
    expect((await request(createApp(testConfig())).post("/mcp").set(auth).set("Origin", "not a URL").send(initialize)).status).toBe(403);
  });
  it("rejects an unapproved Host header", async () => {
    expect((await request(createApp(testConfig())).post("/mcp").set(auth).set("Host", "evil.example").send(initialize)).status).toBe(403);
  });
  it("rejects an oversized request", async () => {
    const app = createApp(testConfig({ maxRequestBytes: 1024 }));
    const response = await request(app).post("/mcp").set(auth).send({ ...initialize, padding: "x".repeat(2000) });
    expect(response.status).toBe(413);
  });
  it("returns a safe invalid JSON error", async () => {
    const response = await request(createApp(testConfig())).post("/mcp").set(auth).set("Content-Type", "application/json").send("{");
    expect(response.status).toBe(400);
    expect(response.text).not.toMatch(/stack|at \w+ \(/i);
  });
  it("enforces the general per-minute limit with Retry-After", async () => {
    const app = createApp(testConfig({ generalLimit: 2 }));
    await request(app).post("/mcp").set(auth).send(initialize);
    await request(app).post("/mcp").set(auth).send(initialize);
    const response = await request(app).post("/mcp").set(auth).send(initialize);
    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBeTruthy();
  });
  it("enforces simulation units", async () => {
    const app = createApp(testConfig({ simulationLimit: 1 }));
    const call = mcpRequest(2, "tools/call", { name: "run_simulation", arguments: { scenarioId: "dos", difficulty: "beginner", seed: 1, defenses: [] } });
    expect((await request(app).post("/mcp").set(auth).send(call)).status).toBe(200);
    expect((await request(app).post("/mcp").set(auth).send(call)).status).toBe(429);
  });
  it("charges compare_defenses as two simulations", async () => {
    const app = createApp(testConfig({ simulationLimit: 2 }));
    const compare = mcpRequest(2, "tools/call", { name: "compare_defenses", arguments: {
      scenarioId: "malware", difficulty: "beginner", seed: 1, baselineDefenses: [], comparisonDefenses: []
    } });
    expect((await request(app).post("/mcp").set(auth).send(compare)).status).toBe(200);
    const run = mcpRequest(3, "tools/call", { name: "run_simulation", arguments: { scenarioId: "dos", difficulty: "beginner", seed: 1, defenses: [] } });
    expect((await request(app).post("/mcp").set(auth).send(run)).status).toBe(429);
  });
  it("enforces the daily simulation limit", async () => {
    const app = createApp(testConfig({ dailySimulationLimit: 1 }));
    const call = mcpRequest(2, "tools/call", { name: "run_simulation", arguments: { scenarioId: "dos", difficulty: "beginner", seed: 1, defenses: [] } });
    await request(app).post("/mcp").set(auth).send(call);
    expect((await request(app).post("/mcp").set(auth).send(call)).status).toBe(429);
  });
});
