# MicroComp IT LLM Training Laboratory — Deployment Guide

## Components

The release has two independently deployable surfaces:

1. the existing static MicroComp IT website; and
2. the temporary FastAPI trainer in `llm-training-lab/cloud-service/`.

Local browser training requires no server-side model runtime. Cloud training is
optional; the page remains usable when it is not configured.

## Static website

Deploy the `frontend/` tree with the repository's existing static hosting
process. Serve JavaScript workers and modules from the same origin and preserve
the route:

```text
/demo-lab/llm-training-simulation.html
```

Required browser features are Web Workers, IndexedDB, Fetch, Streams, Web
Crypto, and WebAssembly. WebGPU is an optional capability; the v1 educational
trainer uses its tested TensorFlow.js CPU path.

Use HTTPS in production. The cloud service URL must be HTTPS when the website
is HTTPS or browsers will block mixed content.

## Cloud service on Render

The repository `render.yaml` provisions the service. It must run as one Uvicorn
worker and one service instance because sessions, jobs, events, and completed
models are process-local.

Set at minimum:

```text
MICROCOMP_CLOUD_API_KEY=<random secret of at least 24 characters>
MICROCOMP_CLOUD_CORS_ORIGINS=https://your-public-site.example
```

Do not place `MICROCOMP_CLOUD_API_KEY` in website source, HTML, a public
environment bundle, URL parameters, analytics, or logs. In v1, an operator
provides it to an authorized visitor at runtime. A public anonymous deployment
needs the Version 2 credential broker described below.

See `llm-training-lab/cloud-service/README.md` for every environment variable,
resource bound, health probe, and local command.

## Local cloud-service check

```powershell
cd llm-training-lab/cloud-service
..\python-reference\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8090
```

Configure a valid key in the process environment first. Open the website
through its normal local HTTP server, choose cloud mode, and connect to
`http://localhost:8090`.

## Retention and capacity

Defaults:

- 60-minute inactivity expiry;
- six-hour absolute lifetime;
- one active trainer;
- eight queued jobs;
- two retained jobs per anonymous session;
- 500 training steps;
- batch size eight; and
- 200,000 parameters.

Temporary artifacts use the configured service data root and are deleted on
expiration, cancellation, explicit deletion, and graceful shutdown. A restart
also removes service-owned stale job directories.

## Production verification

- `/healthz` returns status `ok`.
- `/readyz` reports capacity.
- CORS permits only the exact website origin.
- the API key is stored only in the platform secret store;
- logs contain no API keys, bearer tokens, authorization headers, or prompts;
- a completed package imports through **My Models**;
- an expired job no longer generates or downloads; and
- the static site remains fully functional when the cloud service is offline.

## Version 2 deployment direction

Replace the operator-key browser flow with a trusted same-origin broker that
issues narrow, short-lived anonymous capabilities after abuse controls. Move
jobs and events to shared infrastructure before enabling multiple API workers
or horizontal scaling.
