# Completion Report: Standalone Cloud Training Service

Status: Complete

Completion date: July 28, 2026

Frontend integration: Not implemented, as requested

Remote repository updated: No

## Architecture

The service is isolated at:

```text
llm-training-lab/cloud-service/
```

It imports the canonical Python reference model, tokenizer, dataset, training,
inference, and portable-package modules from:

```text
llm-training-lab/python-reference/
```

The service does not redefine the model architecture. Model configuration is
validated with the canonical `ModelConfig`, parameter count is checked before
allocation and against actual PyTorch parameters after construction, and model
downloads use the specification-v1 portable package writer and validator.

Default execution:

```text
FastAPI request process
  -> authenticated anonymous session
  -> bounded in-memory queue
  -> one CPU training thread
  -> canonical PyTorch reference engine
  -> temporary checkpoint and .microcomp-model package
  -> in-memory completed model for generation
  -> expiration or explicit cleanup
```

The service must run with one Uvicorn worker. Jobs, sessions, events, and queue
coordination are intentionally process-local in this milestone.

## API endpoints

| Method | Endpoint | Authentication | Result |
| --- | --- | --- | --- |
| `GET` | `/healthz` | None | Minimal liveness |
| `GET` | `/readyz` | None | Readiness and queue capacity |
| `POST` | `/v1/sessions` | `X-API-Key` | Opaque anonymous bearer session |
| `POST` | `/v1/jobs` | API key + bearer | Validate and queue training |
| `GET` | `/v1/jobs/{job_id}` | API key + bearer | State and current progress |
| `GET` | `/v1/jobs/{job_id}/events` | API key + bearer | Server-Sent Events |
| `POST` | `/v1/jobs/{job_id}/cancel` | API key + bearer | Cooperative cancellation |
| `POST` | `/v1/jobs/{job_id}/generate` | API key + bearer | Completed-model inference |
| `GET` | `/v1/jobs/{job_id}/download` | API key + bearer | Validated `.microcomp-model` |
| `DELETE` | `/v1/jobs/{job_id}` | API key + bearer | Delete job and artifacts |

OpenAPI declares both the API-key and HTTP bearer security schemes.

SSE emits:

```text
state
initializing
progress
generation
```

Each event has a monotonically increasing ID. Reconnection can supply
`Last-Event-ID`. The stream sends a comment heartbeat every 15 seconds and
terminates after the final queued event for a terminal state.

## Job states

The service exposes exactly:

```text
queued
initializing
training
completed
cancelled
expired
```

Internal failures are represented as `cancelled` with the bounded reason
`internal_error`; exception details go only to structured operator logs.

Cancellation is cooperative at an optimizer-step boundary. It never produces a
downloadable partial model.

## Authentication and anonymous isolation

`MICROCOMP_CLOUD_API_KEY` is an operator secret required by every non-health
endpoint. It is compared in constant time.

`POST /v1/sessions` returns:

- an opaque session ID;
- a random bearer capability; and
- no account or personal identity.

Only the SHA-256 digest of the bearer token is retained. A job belongs to one
anonymous session, and another valid session receives `404` rather than job
existence information.

The API key is not suitable for direct inclusion in a public frontend. A future
frontend milestone needs a trusted broker or narrower credential-issuance
design.

## Environment variables

| Variable | Default | Purpose |
| --- | ---: | --- |
| `MICROCOMP_CLOUD_API_KEY` | required | Operator API secret, at least 24 characters |
| `MICROCOMP_CLOUD_DATA_ROOT` | OS temp path | Service-owned temporary job root |
| `MICROCOMP_CLOUD_INACTIVITY_TTL_SECONDS` | `3600` | Idle expiration |
| `MICROCOMP_CLOUD_MAX_LIFETIME_SECONDS` | `21600` | Absolute six-hour lifetime |
| `MICROCOMP_CLOUD_CLEANUP_INTERVAL_SECONDS` | `30` | Expiration sweep |
| `MICROCOMP_CLOUD_MAX_CONCURRENT_JOBS` | `1` | Active CPU trainers |
| `MICROCOMP_CLOUD_MAX_QUEUED_JOBS` | `8` | Waiting jobs |
| `MICROCOMP_CLOUD_MAX_JOBS_PER_SESSION` | `2` | Anonymous-session quota |
| `MICROCOMP_CLOUD_MAX_TRAINING_STEPS` | `500` | Cloud step cap |
| `MICROCOMP_CLOUD_MAX_BATCH_SIZE` | `8` | Cloud batch cap |
| `MICROCOMP_CLOUD_MAX_REQUEST_BYTES` | `65536` | HTTP body cap |
| `MICROCOMP_CLOUD_MAX_JOB_DISK_BYTES` | `20971520` | Per-job disk cap |
| `MICROCOMP_CLOUD_MAX_ESTIMATED_MEMORY_BYTES` | `402653184` | Pre-allocation memory estimate cap |
| `MICROCOMP_CLOUD_MAX_EVENTS_PER_JOB` | `512` | SSE replay/log observation cap |
| `MICROCOMP_CLOUD_RATE_LIMIT_REQUESTS` | `60` | Requests per window |
| `MICROCOMP_CLOUD_RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate window |
| `MICROCOMP_CLOUD_TORCH_THREADS` | `1` | PyTorch CPU threads |
| `MICROCOMP_CLOUD_CORS_ORIGINS` | empty | Explicit trusted origins only |
| `MICROCOMP_CLOUD_LOG_LEVEL` | `INFO` | JSON process log level |

All numeric environment settings have startup bounds. The service fails closed
for a missing/short API key, an unsafe filesystem-root data path, invalid
numbers, or contradictory retention values.

## Resource limits

Hard architectural limits:

- 200,000 trainable parameters;
- context length at most 256;
- canonical tensor names and shapes;
- only the bundled synthetic cybersecurity dataset;
- no arbitrary upload endpoint;
- package size at most 20 MiB;
- JSON model documents at most 2 MiB; and
- generation at most 256 new tokens.

Service limits:

- one concurrent trainer by default;
- eight queued jobs;
- two retained jobs per anonymous session;
- 500 training steps;
- batch size eight;
- 64 KiB request body;
- 20 MiB job disk allocation;
- conservative 384 MiB training tensor/optimizer/activation estimate;
- one PyTorch CPU thread;
- 512 retained SSE events; and
- 60 requests per 60 seconds by anonymous capability or client address.

The memory estimate includes parameters, gradients, Adam slots, causal
attention, hidden/feed-forward activations, and a fixed runtime reserve. It is
checked before model allocation. It is a conservative application boundary,
not an operating-system resident-memory guarantee.

Training is moved to a worker thread so the FastAPI event loop continues
serving health, status, SSE, cancellation, and deletion requests.

## Cleanup strategy

The expiration deadline is the earlier of:

```text
last authenticated job access + 60 minutes
job creation + 6 hours
```

Authenticated status, SSE, generation, and download activity refreshes the
idle deadline but never extends the six-hour maximum.

Expiration:

1. marks the job `expired`;
2. sets its cancellation flag;
3. waits for a safe optimizer-step boundary if training;
4. releases the PyTorch model and tokenizer;
5. clears training history and progress-event history;
6. deletes the canonical checkpoint;
7. deletes `weights.bin` and all JSON documents;
8. deletes the downloadable ZIP;
9. deletes the bounded job-local JSON log;
10. removes the complete job directory; and
11. retains only a metadata-only expired tombstone for five minutes.

Explicit deletion performs the same artifact cleanup and removes the job
record immediately. Cancelled jobs clean artifacts without writing a partial
package. Graceful service shutdown cancels work and cleans all known
workspaces. Startup removes service-owned stale `job-*` directories left by an
unclean prior process.

Every artifact path is resolved beneath the exact service data root and job
workspace. Opaque job IDs accept only 32 lowercase hexadecimal characters.
Nested, traversal, and out-of-workspace paths are rejected.

## Portable package and ZIP protection

Downloads contain exactly:

```text
manifest.json
tokenizer.json
training-config.json
training-history.json
weights.bin
```

The service validates the ZIP again immediately before download. Canonical
validation rejects:

- unsafe paths;
- nested files;
- symbolic links;
- encrypted entries;
- extra or missing entries;
- package and JSON oversize;
- unsupported versions;
- unexpected tensors;
- parameter mismatches;
- shape, offset, layout, or dtype mismatches;
- non-finite weights; and
- file or tensor SHA-256 mismatches.

Only declarative UTF-8 JSON and little-endian float32 weights are accepted.
Pickle and executable framework serialization are not used.

## Structured logs

Process logs are one-line JSON with timestamp, level, logger, message, and
bounded identifiers/metrics. API keys, bearer tokens, request authorization
headers, and user prompts are never written.

Each job also has a bounded JSON-lines event log inside its temporary
workspace. This file is deleted with the rest of the job.

## Render deployment

The repository-root `render.yaml` defines:

- one Python web service;
- `llm-training-lab/cloud-service` as `rootDir`;
- a pinned requirements build;
- one Uvicorn worker;
- `/healthz` health checks;
- a 60-second graceful shutdown window;
- temporary `/tmp` artifact storage;
- one CPU training thread; and
- `MICROCOMP_CLOUD_API_KEY` as a non-committed `sync: false` secret.

The detailed operator guide is:

```text
llm-training-lab/cloud-service/README.md
```

No persistent disk, database, or key-value service is required for this
temporary single-instance milestone. Horizontal scaling is intentionally
unsupported until jobs, sessions, events, and artifacts move to shared
services.

## Tests

Cloud service:

```powershell
cd llm-training-lab/cloud-service
..\python-reference\.venv\Scripts\python.exe -m pytest -q
```

```text
9 passed
0 failed
```

Coverage includes:

- fail-closed settings;
- API-key authentication;
- OpenAPI security declarations;
- anonymous-session isolation;
- strict request schemas;
- 200,000-parameter rejection;
- service step and batch limits;
- pre-allocation memory rejection;
- real PyTorch training;
- progress state;
- SSE completion replay;
- deterministic generation;
- canonical package download and validation;
- cooperative cancellation;
- inactivity/maximum-lifetime expiration;
- weights/history/log/temp cleanup;
- rate limiting;
- request-body limits;
- malformed/traversal job paths; and
- out-of-workspace artifact rejection.

Python reference regression:

```powershell
cd llm-training-lab/python-reference
.\.venv\Scripts\python.exe -m pytest -q
```

```text
31 passed
0 failed
```

Website JavaScript regression:

```powershell
node --test tests/*.test.js
```

```text
110 passed
0 failed
```

## Files created

```text
docs/llm-training-lab/08-cloud-training-service-completion-report.md
llm-training-lab/cloud-service/README.md
llm-training-lab/cloud-service/main.py
llm-training-lab/cloud-service/pyproject.toml
llm-training-lab/cloud-service/requirements.txt
llm-training-lab/cloud-service/requirements-dev.txt
llm-training-lab/cloud-service/microcomp_cloud/__init__.py
llm-training-lab/cloud-service/microcomp_cloud/app.py
llm-training-lab/cloud-service/microcomp_cloud/config.py
llm-training-lab/cloud-service/microcomp_cloud/jobs.py
llm-training-lab/cloud-service/microcomp_cloud/middleware.py
llm-training-lab/cloud-service/microcomp_cloud/observability.py
llm-training-lab/cloud-service/microcomp_cloud/schemas.py
llm-training-lab/cloud-service/microcomp_cloud/security.py
llm-training-lab/cloud-service/tests/conftest.py
llm-training-lab/cloud-service/tests/test_cloud_service.py
render.yaml
```

## Files updated

```text
llm-training-lab/python-reference/microcomp_llm/training.py
```

The reference trainer gained optional cooperative cancellation and
every-step progress callbacks. Both default to disabled, so existing CLI and
test behavior remains backward compatible.

## Remaining limitations

1. Job/session coordination is in-memory and requires exactly one application
   process and one Render instance.
2. A restart or deploy deletes all temporary jobs by design.
3. Cancellation occurs at a safe optimizer-step boundary, not in the middle of
   a tensor kernel, validation pass, or package write.
4. Application rate limiting is per process. Production abuse protection
   should add Render or upstream edge controls.
5. The memory estimator bounds model-related allocations but cannot enforce
   process RSS.
6. CPU training speed depends on the Render instance. No GPU, distributed
   training, WebGPU, or mixed precision is enabled.
7. The operator API key must not be shipped to the public website. Frontend
   integration remains intentionally absent.
