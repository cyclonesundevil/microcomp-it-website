import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { closeGracefully, createHttpRuntime } from "../src/runtime.js";
import { testConfig } from "./helpers.js";

describe("configuration, parity, and runtime", () => {
  it("fails closed when auth is required and the key is blank", () => {
    expect(() => loadConfig({ MCP_REQUIRE_AUTH: "true", MCP_API_KEY: " " })).toThrow(/MCP_API_KEY/);
  });
  it("permits explicitly disabled authentication for local tests", () => {
    expect(loadConfig({ MCP_REQUIRE_AUTH: "false" }).requireAuth).toBe(false);
  });
  it("the packaged engine exactly matches the website engine", async () => {
    const source = await readFile(resolve("..", "frontend", "cyber-lab-engine.js"));
    const packaged = await readFile(resolve("generated", "cyber-lab-engine.cjs"));
    expect(createHash("sha256").update(packaged).digest("hex")).toBe(createHash("sha256").update(source).digest("hex"));
  });
  it("closes the HTTP runtime gracefully", async () => {
    const server = createHttpRuntime(testConfig());
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    await expect(closeGracefully(server, 1000)).resolves.toBeUndefined();
  });
});
