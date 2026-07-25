import { config as loadDotenv } from "dotenv";
import { exerciseClient } from "./client-runner.js";

loadDotenv({ quiet: true });
const endpoint = process.env.MCP_SERVER_URL || "http://127.0.0.1:3000/mcp";
const key = process.env.MCP_API_KEY?.trim();
console.log(JSON.stringify(await exerciseClient(endpoint, key), null, 2));
