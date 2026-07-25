import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function exerciseClient(endpointValue: string, key?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(endpointValue), {
    requestInit: key ? { headers: { Authorization: `Bearer ${key}` } } : undefined
  });
  const client = new Client({ name: "microcompit-cyberlab-local-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const resources = await client.listResources();
    const scenarios = await client.callTool({ name: "list_scenarios", arguments: {} });
    const description = await client.callTool({ name: "describe_scenario", arguments: { scenarioId: "malware", seed: 4242 } });
    const run = await client.callTool({ name: "run_simulation", arguments: {
      scenarioId: "malware", difficulty: "beginner", seed: 4242, defenses: ["endpointProtection", "segmentation"]
    } });
    const comparison = await client.callTool({ name: "compare_defenses", arguments: {
      scenarioId: "malware", difficulty: "beginner", seed: 4242,
      baselineDefenses: [], comparisonDefenses: ["endpointProtection", "segmentation"]
    } });
    const summary = (value: any) => value?.structuredContent ?? { contentBlocks: value?.content?.length ?? 0 };
    return {
      connected: true,
      tools: tools.tools.map(item => item.name),
      resources: resources.resources.map(item => item.uri),
      scenarioCount: (summary(scenarios) as any).count,
      malwareProfilePreview: (summary(description) as any).selectedProfilePreview,
      run: {
        outcome: (summary(run) as any).outcomeClassification,
        malwareProfile: (summary(run) as any).malwareProfile
      },
      comparison: { explanation: (summary(comparison) as any).explanation }
    };
  } finally {
    await client.close();
  }
}
