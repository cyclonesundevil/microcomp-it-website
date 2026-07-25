import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { compareDefensesSchema, describeScenarioSchema, listScenariosSchema, runSimulationSchema } from "./schemas.js";
import { handleListScenarios } from "./tools/list-scenarios.js";
import { handleDescribeScenario } from "./tools/describe-scenario.js";
import { handleRunSimulation } from "./tools/run-simulation.js";
import { handleCompareDefenses } from "./tools/compare-defenses.js";
import { registerResources } from "./resources/register-resources.js";

const INSTRUCTIONS = "All systems, addresses, traffic, credentials, and outcomes are fictional. These tools are for defensive education. New users should call list_scenarios or describe_scenario first. Use identical seeds when comparing defenses. Synthetic output is not a prediction about real infrastructure. Arbitrary systems and URLs cannot be targeted.";

function response(value: unknown, summary: string) {
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: value as Record<string, unknown>
  };
}

export function createMcpServer(config: Config): McpServer {
  const server = new McpServer(
    { name: config.serverName, version: "1.0.0" },
    { instructions: INSTRUCTIONS, capabilities: { tools: {}, resources: {} } }
  );
  server.registerTool("list_scenarios", {
    title: "List cybersecurity scenarios",
    description: "Lists the bounded fictional scenarios without running a simulation.",
    inputSchema: listScenariosSchema
  }, async input => {
    const value = handleListScenarios(input);
    return response({ scenarios: value, count: value.length }, `${value.length} built-in synthetic scenarios are available.`);
  });
  server.registerTool("describe_scenario", {
    title: "Describe a cybersecurity scenario",
    description: "Explains a built-in fictional scenario and its defensive learning outcomes.",
    inputSchema: describeScenarioSchema
  }, async input => {
    const value = handleDescribeScenario(input);
    return response(value, `${value.displayName}: ${value.fictionalObjective}`);
  });
  server.registerTool("run_simulation", {
    title: "Run a deterministic defensive simulation",
    description: "Runs one complete bounded synthetic scenario. Arbitrary targets and payloads are not accepted.",
    inputSchema: runSimulationSchema
  }, async input => {
    const value = handleRunSimulation(input);
    return response(value, `${value.scenarioName} completed with outcome: ${value.outcomeClassification}.`);
  });
  server.registerTool("compare_defenses", {
    title: "Compare defensive control selections",
    description: "Runs the same bounded synthetic scenario and seed twice, varying only defenses.",
    inputSchema: compareDefensesSchema
  }, async input => {
    const value = handleCompareDefenses(input);
    return response(value, value.explanation);
  });
  registerResources(server);
  return server;
}
