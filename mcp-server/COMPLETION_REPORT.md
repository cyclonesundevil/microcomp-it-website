# Cybersecurity Simulation MCP Server — Code Completion Report

## Completion status

The production-oriented MCP server implementation is complete and locally validated.

- Local implementation commit: `4ea1438 feat: add cybersecurity simulation MCP server`
- Branch: `main`
- Remote status at completion: local `main` was one commit ahead of `origin/main`
- Push status: not pushed, as requested
- Existing website behavior: unchanged
- Render, DNS, custom-domain, and existing website-service configuration: unchanged

## Architecture selected

The MCP service reuses the existing browser-independent deterministic simulation engine rather than rewriting its scenario calculations.

The authoritative engine remains:

```text
frontend/cyber-lab-engine.js
```

During `npm run build`, `mcp-server/scripts/copy-engine.mjs`:

1. Copies the engine byte-for-byte into `mcp-server/generated/cyber-lab-engine.cjs`.
2. Calculates its SHA-256.
3. Writes a small manifest beside the generated engine.

The TypeScript simulation adapter loads only this fixed generated artifact. It converts MCP inputs into the existing engine configuration, advances the simulation to its bounded completion state, calls the existing report generator, and reduces the full report to a safe MCP response.

A parity test compares the website engine and generated MCP engine bytes. This prevents silent divergence between browser and MCP calculations.

All files required at runtime are therefore inside `mcp-server` after the Render build completes.

## Transport and runtime

- Node.js requirement: Node 20 or newer
- Language: TypeScript
- MCP transport: stateless Streamable HTTP
- MCP endpoint: `/mcp`
- Binding: `0.0.0.0`
- Port: `process.env.PORT`, defaulting to `3000`
- Persistence: none
- Database: none
- Simulation sessions: none
- MCP resumability: none
- Normal simulation-time outbound network access: none
- Graceful shutdown: SIGTERM and SIGINT supported

Each MCP HTTP exchange receives a fresh MCP server and transport instance. The service retains no client simulation state between requests.

## Public HTTP routes

### `GET /health`

Unauthenticated, inexpensive, and does not run a simulation.

```json
{
  "status": "ok",
  "service": "microcompit-cyberlab-mcp",
  "version": "1.0.0"
}
```

### `GET /`

Returns only safe service metadata, including the MCP endpoint, health endpoint, authentication status, and synthetic-only status.

### `/mcp`

Supports the official SDK’s stateless Streamable HTTP handling for POST, GET, and DELETE. Authentication, Origin and Host validation, request-size checks, and rate limits run before MCP dispatch.

Unknown routes return a minimal JSON 404.

## MCP SDK and exact dependencies

The implementation uses the latest stable official TypeScript SDK available during development. The newer split-package v2 release was still marked beta, so it was not selected for this production implementation.

Runtime dependencies:

| Package | Exact version |
|---|---:|
| `@modelcontextprotocol/sdk` | `1.29.0` |
| `express` | `5.2.1` |
| `zod` | `4.4.3` |
| `dotenv` | `17.4.2` |

Development dependencies:

| Package | Exact version |
|---|---:|
| `@types/express` | `5.0.6` |
| `@types/node` | `20.19.33` |
| `@types/supertest` | `6.0.3` |
| `supertest` | `7.2.2` |
| `tsx` | `4.23.1` |
| `typescript` | `7.0.2` |
| `vitest` | `4.1.10` |

All versions are pinned and `package-lock.json` is committed.

## Tools implemented

### `list_scenarios`

- Lists the built-in scenarios without running simulations.
- Accepts optional exact difficulty and category filters.
- Returns scenario ID, display name, category, objective, difficulties, and relevant defense IDs.

### `describe_scenario`

- Describes one built-in scenario.
- Returns fictional initial conditions, stages, relevant defenses, metrics, educational outcomes, and a safety statement.
- For malware, returns all four malware profiles.
- When given a seed, previews its selected malware profile without running the complete scenario.

### `run_simulation`

- Requires a built-in scenario, supported difficulty, and bounded integer seed.
- Accepts only existing defense IDs.
- Deduplicates repeated defenses deterministically.
- Runs one complete deterministic simulation without retaining a session.
- Returns bounded metrics, affected/protected assets, triggered defense types, residual impact, outcome classification, explanation, safety statement, and at most six major events.

### `compare_defenses`

- Runs an identical scenario, difficulty, and seed twice.
- Varies only the two defense selections.
- Counts as two simulation units.
- Returns both summaries, metric differences, newly protected assets, newly triggered defenses, unchanged values, and an explicit synthetic-model disclaimer.

## Resources implemented

- `cyberlab://scenarios`
- `cyberlab://defenses`
- `cyberlab://methodology`
- `cyberlab://safety-model`
- `cyberlab://scenarios/{scenarioId}`

These resources contain only educational content from the existing simulator. They do not expose source code, environment variables, logs, API keys, filesystem paths, Git information, or repository secrets.

## Supported scenarios

Exactly eleven scenarios are exposed:

1. `dos`
2. `mitm`
3. `phishing`
4. `malware`
5. `sqli`
6. `zeroday`
7. `xss`
8. `password`
9. `apt`
10. `eavesdropping`
11. `insider`

Supported difficulties are exactly:

- `beginner`
- `intermediate`
- `advanced`

Seeds are restricted to integers from `0` through `2147483647`.

## Deterministic malware examples

| Seed | Selected profile |
|---:|---|
| `2000` | `ransomware-like` |
| `2001` | `worm-like` |
| `2002` | `credential-stealing` |
| `2003` | `botnet-like` |
| `4242` | `credential-stealing` |

The same scenario, difficulty, seed, and defense selection returns the same bounded result.

The complete relevant preventive stack was also tested to confirm it can contain downstream malware spread. The initial internal infection marker may still occur because the defensive response begins after that modeled initial condition.

## Authentication behavior

When `MCP_REQUIRE_AUTH=true`, every `/mcp` request requires:

```http
Authorization: Bearer <MCP_API_KEY>
```

Behavior:

- Missing key: HTTP 401
- Invalid key: HTTP 401
- Valid key: MCP dispatch permitted
- `/` and `/health`: unauthenticated
- Required authentication with a missing or blank configured key: startup fails closed

Credential comparison hashes both values and performs a constant-time comparison. Neither complete keys nor raw authorization headers are logged or returned.

`MCP_REQUIRE_AUTH=false` remains available only for explicit local development and tests. OAuth is not implemented in this version.

## Origin and Host validation

- A missing Origin is allowed for native MCP clients.
- A present Origin must be a valid HTTP(S) origin.
- Matching is exact after safe trailing-slash normalization.
- Wildcards, substring matches, suffix matches, credentials in origins, and malformed origins are rejected.
- The Host header must correspond to an exact configured Origin or public base URL.
- Local loopback hosts are accepted when localhost is explicitly configured.
- Forwarded IP and Host headers are not blindly trusted.
- Express proxy trust is disabled.

Observed live behavior:

- Configured Origin: accepted
- Missing Origin with valid authentication: accepted
- Unapproved Origin: HTTP 403
- Malformed Origin: HTTP 403
- Unapproved Host: HTTP 403

## Request and rate limits

Default request-body limit:

```text
65536 bytes
```

Oversized requests return HTTP 413.

Default rate limits:

- 30 general MCP requests per minute
- 10 simulation units per minute
- 500 simulation units per UTC day

Costs:

- `run_simulation`: one unit
- `compare_defenses`: two units

Limits are keyed by the authenticated API-key fingerprint. When authentication is explicitly disabled, the direct socket IP is used as a fallback.

Rate-limit denials return HTTP 429 with `Retry-After`.

The limiter is intentionally:

- in memory;
- bounded to 1,000 active identity entries;
- cleaned as entries age;
- limited to a single Render instance;
- reset by service restart or redeployment;
- not distributed between instances.

## Safety boundaries

The server accepts only fixed application scenarios, difficulties, seeds, and existing defense IDs.

Schemas reject additional fields and never accept:

- arbitrary target IP addresses;
- arbitrary domains or URLs;
- files or filesystem paths;
- executable code;
- shell commands;
- SQL;
- exploit or script payloads;
- credentials or API tokens;
- custom topologies;
- callback or command-and-control addresses;
- arbitrary event definitions.

Runtime code does not provide:

- shell or child-process execution;
- dynamic code evaluation;
- arbitrary dynamic imports;
- unrestricted file access;
- outbound simulation HTTP calls;
- database access;
- GitHub access;
- Render API access;
- server-to-client sampling.

Detective controls remain labeled detective and are not reported as preventive blockers.

## Logging and errors

Logs are JSON objects containing only:

- timestamp;
- request ID;
- route;
- MCP method;
- tool name;
- response status;
- duration;
- rate-limit decision;
- short one-way key fingerprint;
- scenario ID;
- seed.

Logs omit raw headers, request bodies, prompts, arbitrary tool text, personal information, and secrets.

Client errors are generic and do not return stack traces, source code, absolute paths, environment values, or credentials. An unsuccessful tool call does not terminate the service.

## Local SDK client result

The included official-SDK client successfully:

- initialized the server;
- listed all four tools;
- listed the four static resources;
- discovered all eleven scenarios;
- described malware seed 4242;
- ran a deterministic malware simulation;
- ran a same-seed defense comparison;
- closed cleanly.

Observed seed 4242 result:

```json
{
  "profile": "credential-stealing",
  "outcome": "material synthetic impact",
  "comparisonChangedModeledResponse": true
}
```

The live validation also confirmed:

```text
GET /health               200
Invalid bearer key        401
Disallowed Origin         403
```

## Tests executed

MCP service:

```text
Test files: 4 passed
Tests:      55 passed
```

Existing website and cybersecurity lab:

```text
Tests: 73 passed
```

Combined:

```text
128 passed
0 failed
```

Additional successful commands:

```text
npm ci
npm run typecheck
npm run build
npm test
```

The Render build command `npm ci && npm run build` was executed successfully.

## Files created and changed

The local implementation commit contains 33 changed files:

- one root `.gitignore` update;
- the complete `mcp-server` TypeScript project;
- environment template;
- lock file;
- build-copy and local-client scripts;
- runtime and security modules;
- four tool handlers;
- resource registration;
- simulation adapter;
- automated tests;
- full MCP README.

No existing website source or simulation engine behavior was modified.

## Render compatibility

The project works with the configured values:

```text
Root Directory: mcp-server
Runtime: Node
Build Command: npm ci && npm run build
Start Command: npm start
Health Check Path: /health
```

The production process reads `PORT` and binds to `0.0.0.0`.

## Render environment variables still required

Add these variables to the new Render Web Service:

```text
MCP_API_KEY=<generate-a-long-random-production-secret>
MCP_REQUIRE_AUTH=true
MCP_ALLOWED_ORIGINS=https://microcompit-cyberlab-mcp.onrender.com,https://mcp.microcompit.com
MCP_RATE_LIMIT_PER_MINUTE=30
MCP_SIMULATION_LIMIT_PER_MINUTE=10
MCP_DAILY_SIMULATION_LIMIT=500
MCP_MAX_REQUEST_BYTES=65536
MCP_SERVER_NAME=MicroComp IT Cybersecurity Simulation MCP
MCP_PUBLIC_BASE_URL=https://microcompit-cyberlab-mcp.onrender.com
LOG_LEVEL=info
```

Render supplies `PORT`; it does not need to be manually configured.

If the actual Render hostname differs, replace the hostname above with the exact hostname displayed by Render. Do not add a wildcard.

## Known limitations

1. Authentication is a shared bearer-key model; OAuth is not included.
2. Rate-limit state resets on restart and is not distributed.
3. The design targets one Render instance.
4. Render free instances can cold-start after inactivity.
5. MCP output is educational and synthetic, not a prediction of production infrastructure or security-product effectiveness.
6. `npm audit` reports two moderate findings in an unused Hono Node adapter included transitively by the stable MCP SDK. No high or critical findings were reported. The service does not import Hono or expose its static-file handler. A forced breaking downgrade or beta SDK migration was deliberately avoided.

## Secret and scope review

- No production API key was created or committed.
- `.env` is ignored.
- `.env.example` contains placeholders only.
- The staged diff was checked for common token and private-key patterns.
- No website behavior, DNS, Render service configuration, or custom domain was changed.

## Readiness

The MCP server is ready to push to `main` and deploy as the separate Render Web Service after the production environment variables are added.

The implementation commit itself has not been pushed.
