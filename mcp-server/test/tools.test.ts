import { describe, expect, it } from "vitest";
import { compareDefenses, describeScenario, listScenarios, runSimulation } from "../src/simulation-adapter.js";
import { compareDefensesSchema, describeScenarioSchema, listScenariosSchema, runSimulationSchema, SCENARIO_IDS } from "../src/schemas.js";

describe("bounded simulation tools", () => {
  it("discovers exactly all eleven scenarios", () => {
    expect(listScenarios({}).map(item => item.scenarioId)).toEqual([...SCENARIO_IDS]);
  });
  it("filters by an exact category", () => {
    expect(listScenarios({ category: "network" }).map(item => item.scenarioId)).toEqual(["mitm", "eavesdropping"]);
    expect(listScenarios({ category: "malware" }).map(item => item.scenarioId)).toEqual(["malware"]);
  });
  it.each(SCENARIO_IDS)("runs %s to completion", scenarioId => {
    const output = runSimulation({ scenarioId, difficulty: "beginner", seed: 4242, defenses: [] });
    expect(output.synthetic).toBe(true);
    expect(output.scenarioId).toBe(scenarioId);
    expect(output.majorEvents.length).toBeLessThanOrEqual(6);
  });
  it("produces byte-equivalent deterministic output", () => {
    const input = { scenarioId: "malware" as const, difficulty: "intermediate" as const, seed: 4242, defenses: ["endpointProtection" as const] };
    expect(JSON.stringify(runSimulation(input))).toBe(JSON.stringify(runSimulation(input)));
  });
  it("normalizes duplicate defense IDs deterministically", () => {
    const output = runSimulation({ scenarioId: "malware", difficulty: "beginner", seed: 2, defenses: ["segmentation", "segmentation"] });
    expect(output.enabledDefenses).toEqual(["segmentation"]);
  });
  it.each([
    [2000, "ransomware-like"], [2001, "worm-like"], [2002, "credential-stealing"], [2003, "botnet-like"]
  ] as const)("maps seed %i to %s", (seed, profile) => {
    expect(runSimulation({ scenarioId: "malware", difficulty: "beginner", seed, defenses: [] }).malwareProfile).toBe(profile);
    expect((describeScenario({ scenarioId: "malware", seed }).selectedProfilePreview as any).profileId).toBe(profile);
  });
  it("compares the identical seed in both runs", () => {
    const output = compareDefenses({ scenarioId: "malware", difficulty: "beginner", seed: 2000, baselineDefenses: [], comparisonDefenses: ["endpointProtection"] });
    expect(output.seed).toBe(2000);
    expect(output.baselineSummary).toBeTruthy();
    expect(output.comparisonSummary).toBeTruthy();
  });
  it("does not describe detective controls as preventive", () => {
    const output = runSimulation({ scenarioId: "mitm", difficulty: "beginner", seed: 8, defenses: ["ids"] });
    expect(output.triggeredDefenses.filter(item => item.defenseId === "ids").every(item => item.type === "detective")).toBe(true);
  });
  it("a complete relevant malware defense stack contains downstream spread", () => {
    const output = runSimulation({
      scenarioId: "malware", difficulty: "beginner", seed: 2000,
      defenses: ["endpointProtection", "segmentation", "leastPrivilege", "patchManagement"]
    });
    expect(output.affectedAssets.filter(item => item !== output.initialAsset)).toEqual([]);
  });
  it("keeps outputs bounded", () => {
    const output = runSimulation({ scenarioId: "dos", difficulty: "advanced", seed: 2147483647, defenses: [] });
    expect(JSON.stringify(output).length).toBeLessThan(15000);
    expect(output.targetedAssets.length).toBeLessThanOrEqual(8);
  });
  it("rejects unknown fields and unsafe target-shaped fields", () => {
    for (const field of ["targetIp", "url", "payload", "command", "sql", "credentials", "filePath", "callback", "topology"]) {
      expect(runSimulationSchema.safeParse({ scenarioId: "dos", difficulty: "beginner", seed: 1, defenses: [], [field]: "unsafe" }).success).toBe(false);
    }
  });
  it("rejects invalid scenario, difficulty, seed, and defense", () => {
    expect(runSimulationSchema.safeParse({ scenarioId: "other", difficulty: "beginner", seed: 1, defenses: [] }).success).toBe(false);
    expect(runSimulationSchema.safeParse({ scenarioId: "dos", difficulty: "expert", seed: 1, defenses: [] }).success).toBe(false);
    expect(runSimulationSchema.safeParse({ scenarioId: "dos", difficulty: "beginner", seed: -1, defenses: [] }).success).toBe(false);
    expect(runSimulationSchema.safeParse({ scenarioId: "dos", difficulty: "beginner", seed: 1, defenses: ["unknown"] }).success).toBe(false);
  });
  it("uses strict schemas for every tool", () => {
    expect(listScenariosSchema.safeParse({ extra: true }).success).toBe(false);
    expect(describeScenarioSchema.safeParse({ scenarioId: "dos", extra: true }).success).toBe(false);
    expect(compareDefensesSchema.safeParse({ scenarioId: "dos", difficulty: "beginner", seed: 1, baselineDefenses: [], comparisonDefenses: [], extra: true }).success).toBe(false);
  });
});
