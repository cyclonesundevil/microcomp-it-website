import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { catalog, describeScenario } from "../simulation-adapter.js";
import { ScenarioId } from "../schemas.js";

function textResource(uri: URL, value: unknown) {
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] };
}

export function registerResources(server: McpServer): void {
  server.registerResource("Cyber Lab scenarios", "cyberlab://scenarios", {
    title: "Cyber Lab scenarios", description: "The eleven built-in fictional defensive scenarios", mimeType: "application/json"
  }, async uri => textResource(uri, catalog.scenarios()));
  server.registerResource("Cyber Lab defenses", "cyberlab://defenses", {
    title: "Cyber Lab defenses", description: "Built-in defensive controls and their modeled roles", mimeType: "application/json"
  }, async uri => textResource(uri, catalog.defenses()));
  server.registerResource("Cyber Lab methodology", "cyberlab://methodology", {
    title: "Cyber Lab methodology", description: "Deterministic comparison methodology", mimeType: "application/json"
  }, async uri => textResource(uri, catalog.methodology));
  server.registerResource("Cyber Lab safety model", "cyberlab://safety-model", {
    title: "Cyber Lab safety model", description: "Synthetic-only safety boundaries", mimeType: "application/json"
  }, async uri => textResource(uri, catalog.safety));
  server.registerResource("Cyber Lab scenario", new ResourceTemplate("cyberlab://scenarios/{scenarioId}", { list: undefined }), {
    title: "Cyber Lab scenario", description: "Educational detail for one built-in scenario", mimeType: "application/json"
  }, async (uri, variables) => {
    const parsed = ScenarioId.safeParse(variables.scenarioId);
    if (!parsed.success) throw new Error("Unsupported scenario resource.");
    return textResource(uri, describeScenario({ scenarioId: parsed.data }));
  });
}
