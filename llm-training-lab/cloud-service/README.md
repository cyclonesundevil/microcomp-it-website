# MicroComp Tiny LLM Cloud Training Service

This is a standalone FastAPI service for temporary, educational CPU training
of the canonical MicroComp Tiny LLM. It does not serve or modify the website.

## Security model

Every non-health API call requires:

1. `X-API-Key`, configured by the operator; and
2. for job operations, an anonymous bearer session token returned by
   `POST /v1/sessions`.

Session tokens are random capabilities. Only SHA-256 token digests are retained
in service memory. Jobs use unguessable identifiers and remain scoped to their
originating session.

Do not put the operator API key in a public frontend. A future frontend
integration needs a trusted broker or a narrowly scoped issuance design.

## Local setup

From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:MICROCOMP_CLOUD_API_KEY = "replace-with-at-least-24-random-characters"
.\.venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8090
```

Create an anonymous session:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8090/v1/sessions `
  -Headers @{ "X-API-Key" = $env:MICROCOMP_CLOUD_API_KEY }
```

Use the returned token as:

```text
Authorization: Bearer <session_token>
X-API-Key: <operator API key>
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness without job details |
| `GET` | `/readyz` | Readiness and bounded queue counts |
| `POST` | `/v1/sessions` | Create an anonymous session |
| `POST` | `/v1/jobs` | Validate and queue training |
| `GET` | `/v1/jobs/{job_id}` | Read current progress |
| `GET` | `/v1/jobs/{job_id}/events` | Receive Server-Sent Events |
| `POST` | `/v1/jobs/{job_id}/cancel` | Cooperatively cancel training |
| `POST` | `/v1/jobs/{job_id}/generate` | Generate from a completed model |
| `GET` | `/v1/jobs/{job_id}/download` | Download `.microcomp-model` |
| `DELETE` | `/v1/jobs/{job_id}` | Delete the job and its artifacts |

SSE supports `Last-Event-ID`. Events are bounded in memory and contain state or
progress observations; API keys, bearer tokens, and prompts are never logged.

## Retention

The default expiration deadline is the earlier of:

- 60 minutes since the most recent authenticated job access; or
- six hours after job creation.

Expiration cancels active work at a safe training-step boundary and deletes
weights, canonical package files, history, job-local logs, and the complete
temporary directory. Explicit deletion performs the same cleanup. A minimal
in-memory `expired` tombstone remains for five minutes so clients can observe
the terminal state; it contains no model artifact.

## Environment variables

| Variable | Default | Boundary |
| --- | ---: | --- |
| `MICROCOMP_CLOUD_API_KEY` | required | Secret, minimum 24 characters |
| `MICROCOMP_CLOUD_DATA_ROOT` | OS temporary directory | Must not be a filesystem root |
| `MICROCOMP_CLOUD_INACTIVITY_TTL_SECONDS` | `3600` | 60–21,600 seconds |
| `MICROCOMP_CLOUD_MAX_LIFETIME_SECONDS` | `21600` | 300–21,600 seconds |
| `MICROCOMP_CLOUD_CLEANUP_INTERVAL_SECONDS` | `30` | 5–300 seconds |
| `MICROCOMP_CLOUD_MAX_CONCURRENT_JOBS` | `1` | 1–4 |
| `MICROCOMP_CLOUD_MAX_QUEUED_JOBS` | `8` | 1–32 |
| `MICROCOMP_CLOUD_MAX_JOBS_PER_SESSION` | `2` | 1–8 |
| `MICROCOMP_CLOUD_MAX_TRAINING_STEPS` | `500` | 1–2,000 |
| `MICROCOMP_CLOUD_MAX_BATCH_SIZE` | `8` | 1–16 |
| `MICROCOMP_CLOUD_MAX_REQUEST_BYTES` | `65536` | 1 KiB–1 MiB |
| `MICROCOMP_CLOUD_MAX_JOB_DISK_BYTES` | `20971520` | At most 20 MiB |
| `MICROCOMP_CLOUD_MAX_ESTIMATED_MEMORY_BYTES` | `402653184` | 64 MiB–2 GiB |
| `MICROCOMP_CLOUD_MAX_EVENTS_PER_JOB` | `512` | 32–2,048 |
| `MICROCOMP_CLOUD_RATE_LIMIT_REQUESTS` | `60` | Requests per window |
| `MICROCOMP_CLOUD_RATE_LIMIT_WINDOW_SECONDS` | `60` | 1–3,600 seconds |
| `MICROCOMP_CLOUD_TORCH_THREADS` | `1` | 1–8 |
| `MICROCOMP_CLOUD_CORS_ORIGINS` | empty | Comma-separated exact origins |
| `MICROCOMP_CLOUD_LOG_LEVEL` | `INFO` | Standard Python log level |

## Render deployment

The repository-root `render.yaml` declares a single Python web service. Create
a Render Blueprint from the repository and provide
`MICROCOMP_CLOUD_API_KEY` when prompted. Do not commit the key.

The service intentionally uses one Uvicorn process. Its job/session registry is
in-memory, so multiple web workers or horizontally scaled instances would
require an external queue, shared metadata store, and shared artifact store.

Render's filesystem is treated as temporary. No persistent disk is required.
Health checks use `/healthz`.

Before production use:

- rotate and securely distribute the operator API key;
- keep `MICROCOMP_CLOUD_MAX_CONCURRENT_JOBS=1` until memory measurements justify
  an increase;
- set `MICROCOMP_CLOUD_CORS_ORIGINS` only when a trusted web origin is ready;
- confirm instance memory during a 200,000-parameter worst-case run;
- configure external request throttling/WAF rules in addition to application
  rate limiting; and
- retain one service instance unless shared coordination is added.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Tests exercise authentication, anonymous isolation, strict configuration
validation, real training, SSE, generation, canonical download, cancellation,
expiration, cleanup, rate limiting, request-size limits, and traversal-safe
artifact handling.
