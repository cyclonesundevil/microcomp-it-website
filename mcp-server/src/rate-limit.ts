interface Entry { minuteStart: number; general: number; simulations: number; dayStart: number; dailySimulations: number; touched: number }
export interface LimitResult { allowed: boolean; retryAfter: number; decision: string }

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly generalLimit: number, private readonly simulationLimit: number, private readonly dailyLimit: number) {}

  check(identity: string, simulationUnits = 0, now = Date.now()): LimitResult {
    const minuteStart = Math.floor(now / 60000) * 60000;
    const dayStart = Math.floor(now / 86400000) * 86400000;
    let entry = this.entries.get(identity);
    if (!entry) entry = { minuteStart, general: 0, simulations: 0, dayStart, dailySimulations: 0, touched: now };
    if (entry.minuteStart !== minuteStart) { entry.minuteStart = minuteStart; entry.general = 0; entry.simulations = 0; }
    if (entry.dayStart !== dayStart) { entry.dayStart = dayStart; entry.dailySimulations = 0; }
    entry.touched = now;
    if (entry.general + 1 > this.generalLimit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((minuteStart + 60000 - now) / 1000)), decision: "general-minute-denied" };
    if (entry.simulations + simulationUnits > this.simulationLimit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((minuteStart + 60000 - now) / 1000)), decision: "simulation-minute-denied" };
    if (entry.dailySimulations + simulationUnits > this.dailyLimit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((dayStart + 86400000 - now) / 1000)), decision: "simulation-daily-denied" };
    entry.general += 1;
    entry.simulations += simulationUnits;
    entry.dailySimulations += simulationUnits;
    this.entries.set(identity, entry);
    if (this.entries.size > 1000) {
      const cutoff = now - 86400000;
      for (const [key, value] of this.entries) if (value.touched < cutoff) this.entries.delete(key);
      while (this.entries.size > 1000) this.entries.delete(this.entries.keys().next().value!);
    }
    return { allowed: true, retryAfter: 0, decision: "allowed" };
  }
}
