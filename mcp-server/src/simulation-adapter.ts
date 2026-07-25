import { createRequire } from "node:module";
import type { z } from "zod";
import type { compareDefensesSchema, describeScenarioSchema, listScenariosSchema, runSimulationSchema } from "./schemas.js";

const require = createRequire(import.meta.url);
const engine: any = require("../generated/cyber-lab-engine.cjs");

type RunInput = z.infer<typeof runSimulationSchema>;
type CompareInput = z.infer<typeof compareDefensesSchema>;
const SAFETY = "All systems, addresses, traffic, credentials, and outcomes are fictional. This deterministic model supports defensive education only and does not predict real-world effectiveness.";
const DIFFICULTY_NAMES = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" } as const;

function scenario(id: string): any {
  const found = engine.SCENARIOS.find((item: any) => item.id === id);
  if (!found) throw new Error("Unsupported scenario.");
  return found;
}

function hostName(id: string): string {
  return engine.HOSTS.find((item: any) => item.id === id)?.name ?? "Synthetic asset";
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function listScenarios(input: z.infer<typeof listScenariosSchema>) {
  return engine.SCENARIOS
    .filter((item: any) => !input.category || item.category.toLowerCase() === input.category || item.id === input.category)
    .map((item: any) => ({
      scenarioId: item.id,
      displayName: item.title,
      category: item.category.toLowerCase(),
      learningObjective: item.objective,
      supportedDifficulties: ["beginner", "intermediate", "advanced"],
      relevantDefenseIds: item.defenses.slice(0, 8)
    }));
}

export function describeScenario(input: z.infer<typeof describeScenarioSchema>) {
  const item = scenario(input.scenarioId);
  const guidance = engine.scenarioGuidance(item.id, item.profileId) ?? [
    item.indicators,
    item.remediation
  ];
  const result: Record<string, unknown> = {
    scenarioId: item.id,
    displayName: item.title,
    fictionalObjective: item.objective,
    initialConditions: `The scenario begins from a fixed synthetic baseline and uses only built-in fictional assets: ${item.path.map(hostName).join(", ")}.`,
    majorSyntheticStages: item.phases.slice(0, 8),
    relevantDefenses: item.defenses.map((id: string) => {
      const definition = engine.defenseDefinition(id);
      return { id, name: definition.name, type: definition.kind };
    }),
    primaryMetrics: ["peak risk", "residual risk", "blocked units", "detections", "affected and protected assets"],
    educationalOutcomes: guidance.slice(0, 6),
    safetyStatement: SAFETY
  };
  if (item.id === "malware") {
    result.malwareProfiles = engine.MALWARE_PROFILES.map((profile: any) => ({
      id: profile.id, name: profile.name, initialAsset: hostName(profile.initialHost),
      targetedAssets: profile.path.map(hostName), primaryRisk: profile.primaryRisk
    }));
    if (input.seed !== undefined) {
      const previewState = engine.initialState({ scenarioId: "malware", difficulty: "Beginner", seed: input.seed, defenses: {} });
      result.selectedProfilePreview = {
        seed: input.seed,
        profileId: previewState.scenarioState.profileId,
        profileName: previewState.scenarioState.profileName
      };
    }
  }
  return result;
}

function eventSummary(event: any) {
  return {
    tick: Number(event.tick) || 0,
    marker: String(event.marker || "SYNTHETIC_EVENT").slice(0, 80),
    action: String(event.action || "observed").slice(0, 40),
    severity: String(event.severity || "info").slice(0, 20),
    sourceAsset: String(event.source?.name || "Synthetic source").slice(0, 80),
    destinationAsset: String(event.destination?.name || "Synthetic destination").slice(0, 80)
  };
}

function classification(residual: number, affected: string[]): string {
  if (affected.length === 0 && residual <= 25) return "contained";
  if (residual <= 45) return "limited impact";
  if (residual <= 70) return "material synthetic impact";
  return "high synthetic impact";
}

export function runSimulation(input: RunInput) {
  const enabledDefenses = unique(input.defenses);
  const defenses = Object.fromEntries(enabledDefenses.map(id => [id, true]));
  let state = engine.initialState({
    scenarioId: input.scenarioId,
    difficulty: DIFFICULTY_NAMES[input.difficulty],
    seed: input.seed,
    defenses,
    mode: "guided",
    attackType: "ddos",
    recovery: true
  });
  for (let index = 0; state.status !== "complete" && index < 64; index += 1) state = engine.step(state);
  if (state.status !== "complete") throw new Error("Simulation did not complete within its fixed bound.");
  const report = engine.buildReport(state);
  const triggered = (report.defensesTriggered ?? []).slice(0, 17).map((item: any) => ({
    defenseId: item.id,
    name: item.name,
    type: item.kind,
    action: item.action,
    triggerCount: Number(item.triggerCount) || 0
  }));
  const targetedAssets = input.scenarioId === "malware"
    ? (report.systemsTargeted ?? [])
    : state.scenario.path.map(hostName);
  const affectedAssets = input.scenarioId === "malware"
    ? (report.systemsAffected ?? [])
    : (report.affectedAssets ?? []);
  const protectedAssets = input.scenarioId === "malware"
    ? (report.systemsProtected ?? [])
    : unique(state.hosts.filter((host: any) => host.status === "protected").map((host: any) => host.name));
  const residualRisk = Number(report.residualRisk) || 0;
  const initialAsset = input.scenarioId === "malware"
    ? report.initialInfectionPoint
    : hostName(state.scenario.path[0]);
  return {
    synthetic: true,
    scenarioId: input.scenarioId,
    scenarioName: state.scenario.title,
    ...(input.scenarioId === "malware" ? { malwareProfile: state.scenarioState.profileId } : {}),
    difficulty: input.difficulty,
    seed: input.seed,
    enabledDefenses,
    triggeredDefenses: triggered,
    defensiveControlTypes: unique(triggered.map((item: any) => item.type)),
    initialAsset,
    targetedAssets: targetedAssets.slice(0, 8),
    affectedAssets: affectedAssets.slice(0, 8),
    protectedAssets: protectedAssets.slice(0, 8),
    majorMetrics: {
      peakRisk: Number(report.peakRisk) || 0,
      residualRisk,
      blockedUnits: Number(report.summary?.activity?.blockedUnits) || 0,
      detections: Number(report.summary?.activity?.detections) || 0,
      minimumAvailability: Number(report.summary?.service?.minimumAvailability) || 0
    },
    residualImpact: report.residualImpact ?? { residualRisk },
    outcomeClassification: classification(residualRisk, affectedAssets),
    explanation: String(report.outcomeExplanation || report.recommendation || "The fixed synthetic scenario completed.").slice(0, 700),
    safetyStatement: SAFETY,
    majorEvents: (report.events ?? []).slice(0, 6).map(eventSummary)
  };
}

function runSummary(result: ReturnType<typeof runSimulation>) {
  return {
    enabledDefenses: result.enabledDefenses,
    triggeredDefenses: result.triggeredDefenses,
    affectedAssets: result.affectedAssets,
    protectedAssets: result.protectedAssets,
    majorMetrics: result.majorMetrics,
    residualImpact: result.residualImpact,
    outcomeClassification: result.outcomeClassification
  };
}

export function compareDefenses(input: CompareInput) {
  const baseline = runSimulation({ scenarioId: input.scenarioId, difficulty: input.difficulty, seed: input.seed, defenses: input.baselineDefenses });
  const comparison = runSimulation({ scenarioId: input.scenarioId, difficulty: input.difficulty, seed: input.seed, defenses: input.comparisonDefenses });
  const differences: Record<string, number> = {};
  for (const key of Object.keys(baseline.majorMetrics) as Array<keyof typeof baseline.majorMetrics>) {
    differences[key] = comparison.majorMetrics[key] - baseline.majorMetrics[key];
  }
  const newlyProtectedAssets = comparison.protectedAssets.filter((item: string) => !baseline.protectedAssets.includes(item));
  const baselineTriggered = baseline.triggeredDefenses.map((item: { defenseId: string }) => item.defenseId);
  const newlyTriggeredDefenses = comparison.triggeredDefenses.filter((item: { defenseId: string }) => !baselineTriggered.includes(item.defenseId));
  const unchangedValues = Object.entries(differences).filter(([, value]) => value === 0).map(([key]) => key);
  return {
    synthetic: true,
    scenarioId: input.scenarioId,
    difficulty: input.difficulty,
    seed: input.seed,
    baselineSummary: runSummary(baseline),
    comparisonSummary: runSummary(comparison),
    metricDifferences: differences,
    newlyProtectedAssets,
    newlyTriggeredDefenses,
    unchangedValues,
    explanation: newlyProtectedAssets.length || newlyTriggeredDefenses.length
      ? "With the same scenario and seed, the comparison controls changed the modeled defensive response."
      : "With the same scenario and seed, the selected controls did not change the reported bounded outcomes.",
    safetyStatement: "This is a synthetic educational model, not a prediction of real-world defensive effectiveness."
  };
}

export const catalog = {
  scenarios: () => listScenarios({}),
  defenses: () => Object.keys(engine.DEFENSES).map(id => ({ ...engine.defenseDefinition(id) })),
  methodology: {
    deterministic: true,
    description: "A fixed seed, scenario, difficulty, and defense selection are stepped through the same browser-independent engine used by the MicroComp IT lab.",
    comparisonRule: "Use identical scenario IDs, difficulties, and seeds to compare defense selections.",
    outputBoundary: "Reports contain summaries and at most six major events, never full internal tick histories."
  },
  safety: {
    syntheticOnly: true,
    arbitraryTargetsAccepted: false,
    statement: SAFETY,
    boundaries: ["built-in scenarios only", "fictional assets only", "no payloads", "no code execution", "no network requests"]
  }
};
