import { config as loadDotenv } from "dotenv";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { closeGracefully, createHttpRuntime } from "./runtime.js";

loadDotenv({ quiet: true });
const config = loadConfig();
const httpServer = createHttpRuntime(config);
httpServer.on("error", () => {
  log({ requestId: "startup", route: "startup", status: 500, durationMs: 0, rateLimitDecision: "listen-failed" });
  process.exitCode = 1;
});

httpServer.listen(config.port, "0.0.0.0", () => {
  log({ requestId: "startup", route: "startup", status: 200, durationMs: 0, rateLimitDecision: "listening" });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log({ requestId: "shutdown", route: signal, status: 200, durationMs: 0, rateLimitDecision: "draining" });
  void closeGracefully(httpServer).then(() => process.exit(0), () => process.exit(1));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
