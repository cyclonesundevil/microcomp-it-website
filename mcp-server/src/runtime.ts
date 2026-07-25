import { createServer, type Server } from "node:http";
import type { Config } from "./config.js";
import { createApp } from "./app.js";

export function createHttpRuntime(config: Config): Server {
  const server = createServer(createApp(config));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

export function closeGracefully(server: Server, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Graceful shutdown timed out.")), timeoutMs);
    timer.unref();
    server.close(error => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}
