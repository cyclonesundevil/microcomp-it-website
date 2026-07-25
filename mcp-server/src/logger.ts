export interface LogEvent {
  requestId: string;
  route: string;
  mcpMethod?: string;
  toolName?: string;
  status: number;
  durationMs: number;
  rateLimitDecision?: string;
  keyFingerprint?: string;
  scenarioId?: string;
  seed?: number;
}

export function log(event: LogEvent): void {
  process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + "\n");
}
