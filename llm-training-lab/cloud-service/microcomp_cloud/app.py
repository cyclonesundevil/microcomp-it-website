"""FastAPI application factory for the standalone Tiny LLM cloud service."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from fastapi import Depends, FastAPI, HTTPException, Request, Response, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings
from .jobs import (
    CapacityError,
    JobConflictError,
    JobManager,
    JobNotFoundError,
    TERMINAL_STATES,
)
from .middleware import RateLimitMiddleware, RequestBodyLimitMiddleware
from .observability import configure_logging
from .schemas import CreateJobRequest, GenerationRequest
from .security import (
    SlidingWindowRateLimiter,
    bearer_token,
    require_api_key,
)

LOGGER = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    configuration = settings or Settings.from_environment()
    configure_logging(configuration.log_level)
    manager = JobManager(configuration)
    limiter = SlidingWindowRateLimiter(
        configuration.rate_limit_requests,
        configuration.rate_limit_window_seconds,
    )

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.settings = configuration
        application.state.manager = manager
        await manager.start()
        LOGGER.info("service_started")
        try:
            yield
        finally:
            await manager.close()
            LOGGER.info("service_stopped")

    app = FastAPI(
        title="MicroComp Tiny LLM Cloud Training Service",
        version="1.0.0",
        description=(
            "Temporary, bounded, educational training for the canonical "
            "MicroComp character decoder Transformer."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(RateLimitMiddleware, limiter=limiter)
    app.add_middleware(
        RequestBodyLimitMiddleware,
        maximum_bytes=configuration.maximum_request_bytes,
    )
    if configuration.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(configuration.cors_origins),
            allow_credentials=False,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "Last-Event-ID", "X-API-Key"],
            expose_headers=["Content-Disposition", "Retry-After"],
        )

    api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
    bearer_header = HTTPBearer(auto_error=False)

    def authenticated_api_key(
        request: Request,
        supplied: str | None = Security(api_key_header),
    ) -> None:
        require_api_key(request, supplied)

    def current_session(
        request: Request,
        _api_key: None = Depends(authenticated_api_key),
        credentials: HTTPAuthorizationCredentials | None = Security(bearer_header),
    ):
        try:
            token = credentials.credentials if credentials else bearer_token(request)
            return manager.authenticate_session(token)
        except JobNotFoundError as error:
            raise HTTPException(status_code=401, detail=str(error)) from error

    def owned_job(session: object, job_id: str):
        try:
            return manager.owned_job(session, job_id)
        except JobNotFoundError as error:
            raise HTTPException(status_code=404, detail="Job was not found.") from error

    @app.get("/healthz", tags=["service"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "microcomp-tiny-llm-cloud"}

    @app.get("/readyz", tags=["service"])
    async def ready() -> dict:
        return {"status": "ready", "capacity": manager.capacity()}

    @app.post("/v1/sessions", status_code=status.HTTP_201_CREATED, tags=["sessions"])
    async def create_session(
        _api_key: None = Depends(authenticated_api_key),
    ) -> dict:
        session, token = manager.create_session()
        return {
            "session_id": session.session_id,
            "session_token": token,
            "token_type": "Bearer",
            "anonymous": True,
            "maximum_lifetime_seconds": configuration.maximum_lifetime_seconds,
        }

    @app.post("/v1/jobs", status_code=status.HTTP_202_ACCEPTED, tags=["jobs"])
    async def create_job(
        body: CreateJobRequest,
        session: object = Depends(current_session),
    ) -> dict:
        try:
            job = await manager.create_job(session, body)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except CapacityError as error:
            raise HTTPException(
                status_code=429,
                detail=str(error),
                headers={"Retry-After": "10"},
            ) from error
        return job.snapshot()

    @app.get("/v1/jobs/{job_id}", tags=["jobs"])
    async def job_status(
        job_id: str, session: object = Depends(current_session)
    ) -> dict:
        return owned_job(session, job_id).snapshot()

    @app.get("/v1/jobs/{job_id}/events", tags=["jobs"])
    async def job_events(
        request: Request,
        job_id: str,
        session: object = Depends(current_session),
    ) -> StreamingResponse:
        job = owned_job(session, job_id)
        supplied = request.headers.get("last-event-id", "0")
        try:
            cursor = max(0, int(supplied))
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Last-Event-ID is invalid.") from error

        async def stream() -> AsyncIterator[str]:
            nonlocal cursor
            time_marker = asyncio.get_running_loop().time()
            while True:
                if await request.is_disconnected():
                    return
                job.touch()
                events = manager.events_after(job, cursor)
                for event in events:
                    cursor = event["id"]
                    payload = json.dumps(
                        event["data"], separators=(",", ":"), ensure_ascii=False
                    )
                    yield (
                        f"id: {event['id']}\n"
                        f"event: {event['event']}\n"
                        f"data: {payload}\n\n"
                    )
                    time_marker = asyncio.get_running_loop().time()
                if job.state in TERMINAL_STATES and not manager.events_after(job, cursor):
                    return
                now = asyncio.get_running_loop().time()
                if now - time_marker >= 15:
                    yield f": heartbeat {datetime.now(UTC).isoformat()}\n\n"
                    time_marker = now
                await asyncio.sleep(0.25)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/v1/jobs/{job_id}/cancel", tags=["jobs"])
    async def cancel_job(
        job_id: str, session: object = Depends(current_session)
    ) -> dict:
        job = owned_job(session, job_id)
        try:
            return manager.cancel(job)
        except JobConflictError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.post("/v1/jobs/{job_id}/generate", tags=["models"])
    async def generate(
        job_id: str,
        body: GenerationRequest,
        session: object = Depends(current_session),
    ) -> dict:
        job = owned_job(session, job_id)
        try:
            text = await manager.generate(job, body)
        except JobConflictError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {
            "job_id": job.job_id,
            "text": text,
            "seed": body.seed,
            "temperature": body.temperature,
            "top_k": body.top_k,
            "max_new_tokens": body.max_new_tokens,
        }

    @app.get("/v1/jobs/{job_id}/download", tags=["models"])
    async def download(
        job_id: str, session: object = Depends(current_session)
    ) -> FileResponse:
        job = owned_job(session, job_id)
        try:
            package = manager.validated_package(job)
        except JobConflictError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return FileResponse(
            package,
            media_type="application/zip",
            filename=f"microcomp-cloud-{job.job_id}.microcomp-model",
        )

    @app.delete(
        "/v1/jobs/{job_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["jobs"],
    )
    async def delete_job(
        job_id: str, session: object = Depends(current_session)
    ) -> Response:
        manager.delete(owned_job(session, job_id))
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return app
