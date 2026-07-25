import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { auth, mcpRequest, testConfig } from "./helpers.js";

describe("MCP discovery and resources", () => {
  it("lists exactly four tools", async () => {
    const response = await request(createApp(testConfig())).post("/mcp").set(auth).send(mcpRequest(2, "tools/list", {}));
    expect(response.status).toBe(200);
    expect(response.body.result.tools.map((tool: any) => tool.name)).toEqual(["list_scenarios", "describe_scenario", "run_simulation", "compare_defenses"]);
  });
  it("lists the static and templated resources", async () => {
    const response = await request(createApp(testConfig())).post("/mcp").set(auth).send(mcpRequest(3, "resources/list", {}));
    expect(response.status).toBe(200);
    expect(response.body.result.resources.map((resource: any) => resource.uri)).toEqual(expect.arrayContaining([
      "cyberlab://scenarios", "cyberlab://defenses", "cyberlab://methodology", "cyberlab://safety-model"
    ]));
  });
  it.each(["cyberlab://scenarios", "cyberlab://defenses", "cyberlab://methodology", "cyberlab://safety-model", "cyberlab://scenarios/malware"])("reads %s", async uri => {
    const response = await request(createApp(testConfig())).post("/mcp").set(auth).send(mcpRequest(4, "resources/read", { uri }));
    expect(response.status).toBe(200);
    expect(response.body.result.contents[0].text.length).toBeGreaterThan(10);
    expect(response.body.result.contents[0].text).not.toMatch(/MCP_API_KEY|Authorization: Bearer|[A-Z]:\\/);
  });
  it("returns a safe protocol error for invalid tool arguments", async () => {
    const response = await request(createApp(testConfig())).post("/mcp").set(auth).send(mcpRequest(5, "tools/call", {
      name: "run_simulation", arguments: { scenarioId: "dos", difficulty: "beginner", seed: 1, defenses: [], command: "whoami" }
    }));
    expect(response.status).toBe(200);
    expect(response.body.result.isError).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/stack|node_modules|[A-Z]:\\/);
  });
});
