import { z } from "zod";

export const SCENARIO_IDS = ["dos", "mitm", "phishing", "malware", "sqli", "zeroday", "xss", "password", "apt", "eavesdropping", "insider"] as const;
export const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export const DEFENSE_IDS = ["rateLimiting", "trafficFiltering", "caching", "autoscaling", "upstreamProtection", "waf", "mfa", "accountLockout", "segmentation", "encryption", "endpointProtection", "emailFiltering", "leastPrivilege", "anomalyDetection", "ids", "patchManagement", "dlp"] as const;
export const CATEGORIES = ["availability", "network", "human", "endpoint", "application", "identity", "multi-stage", "data", "malware"] as const;

export const ScenarioId = z.enum(SCENARIO_IDS);
export const Difficulty = z.enum(DIFFICULTIES);
export const DefenseId = z.enum(DEFENSE_IDS);
export const Seed = z.number().int().min(0).max(2147483647);
export const DefenseList = z.array(DefenseId).max(17).default([]);

export const listScenariosSchema = z.object({
  difficulty: Difficulty.optional(),
  category: z.enum(CATEGORIES).optional()
}).strict();
export const describeScenarioSchema = z.object({ scenarioId: ScenarioId, seed: Seed.optional() }).strict();
export const runSimulationSchema = z.object({
  scenarioId: ScenarioId, difficulty: Difficulty, seed: Seed, defenses: DefenseList
}).strict();
export const compareDefensesSchema = z.object({
  scenarioId: ScenarioId, difficulty: Difficulty, seed: Seed,
  baselineDefenses: DefenseList, comparisonDefenses: DefenseList
}).strict();
