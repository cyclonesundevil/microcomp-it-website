# MicroComp IT Cybersecurity Simulation MCP

A production-oriented, synthetic-only Model Context Protocol server for the existing MicroComp IT Cybersecurity Simulation Lab. It exposes deterministic defensive education through four bounded tools and five read-only resource families. It cannot target arbitrary infrastructure, accept attack payloads, execute code, access files, or make network requests during simulations.

## Architecture and simulator relationship

The website's `frontend/cyber-lab-engine.js` is already browser-independent and exports its deterministic engine through CommonJS. During every build, `scripts/copy-engine.mjs` copies that exact file into `generated/cyber-lab-engine.cjs` and records its SHA-256 in `generated/engine-manifest.json`. The TypeScript adapter loads only that fixed local artifact. A parity test compares the packaged bytes with the website engine, preventing silent model divergence.

The service uses the stable official MCP TypeScript SDK and stateless Streamable HTTP. Each HTTP exchange receives a fresh MCP server and transport; there are no simulation or MCP sessions, resumability stores, databases, disks, queues, or outbound requests. Express provides the Render-compatible HTTP boundary. Authentication, exact Origin validation, body limits, and in-memory rate limits execute before MCP dispatch.

```text
mcp-server/
├── generated/                 # exact build copy of the shared engine + hash
├── scripts/
│   ├── copy-engine.mjs
│   └── test-client.ts
├── src/
│   ├── tools/                 # four bounded handlers
│   ├── resources/             # read-only educational resources
│   ├── app.ts                 # HTTP security and MCP transport
│   ├── simulation-adapter.ts  # bounded engine adapter
│   └── ...
├── test/
├── .env.example
├── package.json
└── tsconfig.json
```

## Requirements and local installation

- Node.js 20 or newer
- npm

From `mcp-server`:

```powershell
npm install
Copy-Item .env.example .env
```

Replace the placeholder API key before startup. `.env` files are ignored by the repository and must never be committed.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `MCP_API_KEY` | Bearer secret for `/mcp` | none; required when auth is enabled |
| `MCP_REQUIRE_AUTH` | Require bearer authentication | `true` |
| `MCP_ALLOWED_ORIGINS` | Comma-separated exact HTTP(S) origins | `http://localhost:3000` |
| `MCP_RATE_LIMIT_PER_MINUTE` | General requests per identity per minute | `30` |
| `MCP_SIMULATION_LIMIT_PER_MINUTE` | Simulation units per identity per minute | `10` |
| `MCP_DAILY_SIMULATION_LIMIT` | Simulation units per identity per UTC day | `500` |
| `MCP_MAX_REQUEST_BYTES` | Maximum JSON request size | `65536` |
| `MCP_SERVER_NAME` | MCP server name advertised to clients | `MicroComp IT Cybersecurity Simulation MCP` |
| `MCP_PUBLIC_BASE_URL` | Optional deployment metadata for operations | unset |
| `LOG_LEVEL` | `error`, `warn`, `info`, or `debug` | `info` |
| `PORT` | HTTP port | `3000` |

`MCP_REQUIRE_AUTH=false` is intended only for local development and automated tests. Startup fails closed if authentication is enabled without a nonblank key.

For production, generate a long random secret and configure it in Render rather than a file. Add the exact client origins, for example `https://mcp.microcompit.com` and any exact Render/client web origins that genuinely send browser Origin headers. Native MCP clients normally omit Origin and remain supported. Wildcards, suffix matches, credentials in origins, and non-HTTP(S) origins are rejected.

## Build, start, and test

```powershell
npm run typecheck
npm run build
npm test
npm start
```

Development mode:

```powershell
npm run dev
```

The service binds to `0.0.0.0:$PORT`. Public routes are:

- `GET /health` — unauthenticated inexpensive health JSON
- `GET /` — safe service metadata
- `POST /mcp` — stateless Streamable HTTP endpoint
- `GET /mcp` and `DELETE /mcp` — handled according to the SDK's stateless transport semantics

Unknown paths return a minimal JSON 404. SIGTERM and SIGINT stop accepting connections and allow active HTTP work to drain for up to ten seconds.

## Authentication and request example

Every `/mcp` request requires:

```http
Authorization: Bearer <MCP_API_KEY>
```

Credential comparison hashes both values and uses constant-time comparison. Logs contain only a short one-way fingerprint, never the secret or raw authorization header.

Run the included official-SDK client while the server is running:

```powershell
$env:MCP_API_KEY="your-local-secret"
npm run test:client
```

Override the default endpoint with `MCP_SERVER_URL`; it defaults to `http://127.0.0.1:3000/mcp`. The client initializes, lists tools and resources, reads discovery data, runs malware seed 4242, compares defenses, prints a sanitized summary, and closes.

## Tool catalog

- `list_scenarios` lists the eleven built-in scenarios and optionally filters by exact difficulty or category. It performs no simulation.
- `describe_scenario` explains one built-in scenario. Malware descriptions include all four deterministic behavior profiles and can preview the profile selected by a bounded integer seed.
- `run_simulation` runs one complete deterministic scenario for a required scenario, difficulty, and seed with existing defense IDs only. It returns summaries and at most six major events, never the full tick history.
- `compare_defenses` runs an identical scenario/difficulty/seed twice and varies only the defense selections. It costs two simulation units.

Supported scenario IDs are `dos`, `mitm`, `phishing`, `malware`, `sqli`, `zeroday`, `xss`, `password`, `apt`, `eavesdropping`, and `insider`. Difficulties are `beginner`, `intermediate`, and `advanced`. Seeds are integers from 0 through 2147483647.

## Resource catalog

- `cyberlab://scenarios`
- `cyberlab://defenses`
- `cyberlab://methodology`
- `cyberlab://safety-model`
- `cyberlab://scenarios/{scenarioId}`

Resources include only educational simulator content. They do not expose source code, environment values, logs, filesystem paths, secrets, or repository metadata.

## Rate limits and operational behavior

Limits are keyed by the authenticated API-key fingerprint. With authentication explicitly disabled, the direct socket IP is used; forwarded IP headers are not trusted. `run_simulation` costs one simulation unit and `compare_defenses` costs two. Denials return HTTP 429 with `Retry-After`.

State is bounded in memory, cleaned as identities age, and limited to 1,000 active identity entries. It is intentionally not distributed and resets whenever Render restarts or redeploys. This is suitable for one free instance, not horizontal scaling. Do not add multiple instances without moving limits to a shared trusted store and reassessing session/auth architecture.

JSON request bodies default to 64 KiB. Inputs use strict enumerations, bounded arrays, and integer seed limits. HTTP request/header/keep-alive timeouts are configured. Client-facing failures are generic and omit stack traces.

Structured JSON logs contain only timestamp, request ID, route, MCP method/tool, HTTP status, duration, rate decision, key fingerprint, scenario ID, and seed. They omit request bodies, prompts, arbitrary text, personal data, headers, and secrets.

## Safety boundaries

All systems, documentation-safe addresses, credentials, traffic, and outcomes are fictional. The model is for defensive learning and is not a prediction of real infrastructure or real product effectiveness.

Schemas do not accept arbitrary IP addresses, domains, URLs, uploads, paths, code, commands, SQL, payloads, credentials, tokens, topologies, callbacks, command-and-control addresses, or event definitions. Runtime code has no shell execution, dynamic code evaluation, unrestricted file reads, outbound HTTP, database, GitHub, or Render API access.

Detective controls remain labeled detective and do not claim preventive blocking. Comparisons should always use identical seeds.

## Render deployment

The repository is compatible with the configured separate Web Service:

```text
Root Directory: mcp-server
Runtime: Node
Build Command: npm ci && npm run build
Start Command: npm start
Health Check Path: /health
```

Set every production environment variable listed above in Render. At minimum, set a long `MCP_API_KEY`, keep `MCP_REQUIRE_AUTH=true`, configure exact `MCP_ALLOWED_ORIGINS`, and set the intended rate/body limits and public URL. Render supplies `PORT`.

Free instances may cold-start after inactivity. The first client connection can therefore take longer; clients should use reasonable connect timeouts and retry initialization with backoff. `/health` does not warm or run the simulator.

For `mcp.microcompit.com`, add the custom domain in Render, create the DNS record Render specifies, wait for certificate issuance, then set `MCP_PUBLIC_BASE_URL=https://mcp.microcompit.com`. Add that exact origin to `MCP_ALLOWED_ORIGINS` only if a browser client will send it. DNS and Render custom-domain changes are intentionally outside this project.

## Troubleshooting

- Startup says the key is required: set `MCP_API_KEY` or explicitly disable auth only for local development.
- HTTP 401: ensure the client uses the same bearer key, without quotes or extra spaces.
- HTTP 403: add the browser's exact scheme/host/port Origin; do not use a wildcard.
- HTTP 413: keep calls bounded or deliberately adjust `MCP_MAX_REQUEST_BYTES`.
- HTTP 429: honor `Retry-After`; remember comparisons cost two units.
- Client cannot initialize after a deploy: allow for a free-instance cold start and verify `/health`.
- Engine parity test fails: rebuild from the repository root state and review changes to `frontend/cyber-lab-engine.js`; never hand-edit the generated copy.

## Versioning

Version the service semantically in `package.json`. Treat tool names, input schemas, resource URIs, outcome field meanings, and deterministic fixture changes as API contracts. Pin exact dependency versions and commit `package-lock.json`. Upgrade the MCP SDK only after reviewing the official migration notes and rerunning the protocol client and full parity suite.
