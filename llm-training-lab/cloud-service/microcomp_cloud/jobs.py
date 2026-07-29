"""Bounded temporary job lifecycle and canonical training execution."""

from __future__ import annotations

import asyncio
import gc
import json
import logging
import re
import secrets
import shutil
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import torch

from microcomp_llm.config import ModelConfig, TrainingConfig
from microcomp_llm.dataset import create_data_loaders, load_curated_dataset
from microcomp_llm.inference import generate_text
from microcomp_llm.model import TinyDecoderLM
from microcomp_llm.parameters import actual_trainable_parameters, count_parameters
from microcomp_llm.portable import export_package, save_checkpoint, validate_artifact
from microcomp_llm.tokenizer import CharacterTokenizer
from microcomp_llm.training import (
    TrainingCancelled,
    set_reproducible_seed,
    train_model,
)

from .config import Settings
from .observability import append_job_log
from .schemas import CreateJobRequest, GenerationRequest
from .security import new_opaque_token, token_digest

LOGGER = logging.getLogger(__name__)
JOB_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")
TERMINAL_STATES = frozenset({"completed", "cancelled", "expired"})


def estimate_training_memory_bytes(request: CreateJobRequest, parameters: int) -> int:
    """Conservative tensor/optimizer/activation estimate used before allocation."""
    model = request.model
    batch = request.training.batch_size
    context = model.context_length
    blocks = model.transformer_blocks
    attention = (
        batch * blocks * model.attention_heads * context * context * 8
    )
    hidden = (
        batch * blocks * context
        * ((model.embedding_dim * 16) + (model.feed_forward_dim * 8))
    )
    parameters_and_optimizer = parameters * 20
    runtime_reserve = 32 * 1024 * 1024
    return parameters_and_optimizer + attention + hidden + runtime_reserve


class JobNotFoundError(LookupError):
    pass


class JobConflictError(RuntimeError):
    pass


class CapacityError(RuntimeError):
    pass


@dataclass
class AnonymousSession:
    session_id: str
    token_hash: str
    created_mono: float
    last_access_mono: float


@dataclass
class CloudJob:
    job_id: str
    session_id: str
    request: CreateJobRequest
    parameter_count: int
    estimated_memory_bytes: int
    created_at: datetime
    created_mono: float
    inactivity_ttl_seconds: int
    maximum_lifetime_seconds: int
    maximum_events: int
    state: str = "queued"
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    last_access_mono: float = field(default_factory=time.monotonic)
    sequence: int = 0
    events: deque[dict[str, Any]] = field(default_factory=deque)
    progress: dict[str, Any] = field(default_factory=lambda: {
        "step": 0,
        "total_steps": 0,
        "train_loss": None,
        "validation_loss": None,
        "gradient_norm": None,
        "tokens_processed": 0,
        "elapsed_seconds": 0.0,
        "estimated_remaining_seconds": None,
        "sample": None,
    })
    workspace: Path | None = None
    log_path: Path | None = None
    package_path: Path | None = None
    model: TinyDecoderLM | None = None
    tokenizer: CharacterTokenizer | None = None
    history: list[dict[str, Any]] = field(default_factory=list)
    cancel_event: threading.Event = field(default_factory=threading.Event)
    lock: threading.RLock = field(default_factory=threading.RLock)
    inference_lock: threading.Lock = field(default_factory=threading.Lock)
    running: bool = False
    deleted: bool = False
    expired_at_mono: float | None = None
    cancellation_reason: str | None = None

    def __post_init__(self) -> None:
        self.events = deque(maxlen=self.maximum_events)
        self.progress["total_steps"] = self.request.training.steps
        self.emit("state", {"state": "queued"})

    def touch(self, now: float | None = None) -> None:
        with self.lock:
            if self.state != "expired":
                self.last_access_mono = time.monotonic() if now is None else now

    def expiration_deadline_mono(self) -> float:
        return min(
            self.created_mono + self.maximum_lifetime_seconds,
            self.last_access_mono + self.inactivity_ttl_seconds,
        )

    def expires_at(self, now_mono: float | None = None) -> datetime:
        current = time.monotonic() if now_mono is None else now_mono
        remaining = max(0.0, self.expiration_deadline_mono() - current)
        return datetime.now(UTC) + timedelta(seconds=remaining)

    def emit(self, event_type: str, data: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            self.sequence += 1
            event = {
                "id": self.sequence,
                "event": event_type,
                "timestamp": datetime.now(UTC).isoformat(),
                "data": data,
            }
            self.events.append(event)
            append_job_log(self.log_path, event)
            return event

    def transition(self, state: str, **details: Any) -> None:
        if state not in {
            "queued", "initializing", "training", "completed", "cancelled", "expired"
        }:
            raise ValueError(f"Unsupported cloud job state: {state}.")
        with self.lock:
            if self.state == "expired" or self.deleted:
                return
            self.state = state
            self.updated_at = datetime.now(UTC)
        self.emit("state", {"state": state, **details})

    def update_progress(self, event: dict[str, Any]) -> None:
        with self.lock:
            step = int(event["step"])
            elapsed = float(event["elapsed_seconds"])
            seconds_per_step = elapsed / step if step else 0.0
            self.progress = {
                "step": step,
                "total_steps": self.request.training.steps,
                "train_loss": event["train_loss"],
                "validation_loss": event["validation_loss"],
                "gradient_norm": event["gradient_norm"],
                "tokens_processed": (
                    step * self.request.training.batch_size
                    * self.request.model.context_length
                ),
                "elapsed_seconds": elapsed,
                "estimated_remaining_seconds": (
                    seconds_per_step * (self.request.training.steps - step)
                ),
                "sample": event["sample"],
            }
            self.updated_at = datetime.now(UTC)
        self.emit("progress", dict(self.progress))

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "job_id": self.job_id,
                "state": self.state,
                "dataset_id": self.request.dataset_id,
                "architecture_identifier": (
                    "microcomp.char-decoder-transformer.pre-norm.v1"
                ),
                "parameter_count": self.parameter_count,
                "estimated_memory_bytes": self.estimated_memory_bytes,
                "created_at": self.created_at.isoformat(),
                "updated_at": self.updated_at.isoformat(),
                "expires_at": self.expires_at().isoformat(),
                "progress": dict(self.progress),
                "cancellation_reason": self.cancellation_reason,
                "download_ready": self.state == "completed" and self.package_path is not None,
                "generation_ready": self.state == "completed" and self.model is not None,
            }


class JobManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.sessions: dict[str, AnonymousSession] = {}
        self.jobs: dict[str, CloudJob] = {}
        self._lock = threading.RLock()
        self._queue: asyncio.Queue[CloudJob] = asyncio.Queue(
            maxsize=settings.maximum_queued_jobs
        )
        self._workers: list[asyncio.Task] = []
        self._cleanup_task: asyncio.Task | None = None
        self._closing = False

    async def start(self) -> None:
        self.settings.data_root.mkdir(parents=True, exist_ok=True)
        self._remove_stale_directories()
        torch.set_num_threads(self.settings.torch_threads)
        try:
            torch.set_num_interop_threads(1)
        except RuntimeError:
            # PyTorch permits setting this only before the first parallel operation.
            pass
        self._workers = [
            asyncio.create_task(self._worker(index), name=f"cloud-trainer-{index}")
            for index in range(self.settings.maximum_concurrent_jobs)
        ]
        self._cleanup_task = asyncio.create_task(
            self._cleanup_loop(), name="cloud-job-cleanup"
        )

    async def close(self) -> None:
        self._closing = True
        for job in list(self.jobs.values()):
            job.cancel_event.set()
        for task in self._workers:
            task.cancel()
        if self._cleanup_task:
            self._cleanup_task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        if self._cleanup_task:
            await asyncio.gather(self._cleanup_task, return_exceptions=True)
        for job in list(self.jobs.values()):
            self._destroy_artifacts(job)
        self.jobs.clear()
        self.sessions.clear()

    def create_session(self) -> tuple[AnonymousSession, str]:
        now = time.monotonic()
        token = new_opaque_token()
        session = AnonymousSession(
            session_id=secrets.token_hex(16),
            token_hash=token_digest(token),
            created_mono=now,
            last_access_mono=now,
        )
        with self._lock:
            self.sessions[session.session_id] = session
        return session, token

    def authenticate_session(self, token: str) -> AnonymousSession:
        digest = token_digest(token)
        now = time.monotonic()
        with self._lock:
            for session in self.sessions.values():
                if secrets.compare_digest(session.token_hash, digest):
                    if now - session.created_mono > self.settings.maximum_lifetime_seconds:
                        raise JobNotFoundError("Anonymous session has expired.")
                    session.last_access_mono = now
                    return session
        raise JobNotFoundError("Anonymous session was not found.")

    async def create_job(
        self, session: AnonymousSession, request: CreateJobRequest
    ) -> CloudJob:
        dataset = load_curated_dataset()
        tokenizer = CharacterTokenizer.from_texts(dataset.all_texts)
        if request.model.vocab_size != tokenizer.vocab_size:
            raise ValueError(
                f"vocab_size must be {tokenizer.vocab_size} for the bundled dataset."
            )
        if request.stride > request.model.context_length:
            raise ValueError("stride cannot exceed context_length.")
        if request.training.sample_top_k > tokenizer.vocab_size:
            raise ValueError("sample_top_k cannot exceed the dataset vocabulary size.")
        if request.training.steps > self.settings.maximum_training_steps:
            raise ValueError(
                f"steps cannot exceed the service limit of "
                f"{self.settings.maximum_training_steps}."
            )
        if request.training.batch_size > self.settings.maximum_batch_size:
            raise ValueError(
                f"batch_size cannot exceed the service limit of "
                f"{self.settings.maximum_batch_size}."
            )
        config = ModelConfig.from_dict(request.model.model_dump())
        parameters = count_parameters(config).total
        if parameters > 200_000:
            raise ValueError("Model exceeds the strict 200,000-parameter limit.")
        estimated_memory = estimate_training_memory_bytes(request, parameters)
        if estimated_memory > self.settings.maximum_estimated_memory_bytes:
            raise ValueError(
                "Configuration exceeds the service training-memory allocation "
                f"({estimated_memory} estimated bytes)."
            )
        with self._lock:
            live = [
                job for job in self.jobs.values()
                if job.session_id == session.session_id
                and job.state not in {"expired", "cancelled"}
                and not job.deleted
            ]
            if len(live) >= self.settings.maximum_jobs_per_session:
                raise CapacityError("Anonymous session job limit reached.")
            if self._queue.full():
                raise CapacityError("Training queue is full.")
            now = time.monotonic()
            job = CloudJob(
                job_id=secrets.token_hex(16),
                session_id=session.session_id,
                request=request,
                parameter_count=parameters,
                estimated_memory_bytes=estimated_memory,
                created_at=datetime.now(UTC),
                created_mono=now,
                last_access_mono=now,
                inactivity_ttl_seconds=self.settings.inactivity_ttl_seconds,
                maximum_lifetime_seconds=self.settings.maximum_lifetime_seconds,
                maximum_events=self.settings.maximum_events_per_job,
            )
            self.jobs[job.job_id] = job
            self._queue.put_nowait(job)
        LOGGER.info(
            "job_queued",
            extra={"structured": {
                "job_id": job.job_id,
                "session_id": session.session_id,
                "parameters": parameters,
            }},
        )
        return job

    def owned_job(
        self, session: AnonymousSession, job_id: str, *, touch: bool = True
    ) -> CloudJob:
        if JOB_ID_PATTERN.fullmatch(job_id) is None:
            raise JobNotFoundError("Job was not found.")
        with self._lock:
            job = self.jobs.get(job_id)
            if not job or job.deleted or job.session_id != session.session_id:
                raise JobNotFoundError("Job was not found.")
        if touch:
            job.touch()
        return job

    def events_after(self, job: CloudJob, sequence: int) -> list[dict[str, Any]]:
        with job.lock:
            return [event for event in job.events if event["id"] > sequence]

    def cancel(self, job: CloudJob, reason: str = "requested") -> dict[str, Any]:
        with job.lock:
            if job.state in {"completed", "expired"}:
                raise JobConflictError(f"A {job.state} job cannot be cancelled.")
            if job.state == "cancelled":
                return job.snapshot()
            job.cancellation_reason = reason
            job.cancel_event.set()
            if not job.running:
                job.transition("cancelled", reason=reason)
                self._destroy_artifacts(job)
        return job.snapshot()

    def delete(self, job: CloudJob) -> None:
        with self._lock:
            self.jobs.pop(job.job_id, None)
        with job.lock:
            job.deleted = True
            job.cancel_event.set()
            running = job.running
        if not running:
            self._destroy_artifacts(job)
        LOGGER.info(
            "job_deleted",
            extra={"structured": {"job_id": job.job_id, "running": running}},
        )

    async def generate(
        self, job: CloudJob, request: GenerationRequest
    ) -> str:
        if job.state != "completed" or job.model is None or job.tokenizer is None:
            raise JobConflictError("Text generation requires a completed job.")
        if request.top_k > job.tokenizer.vocab_size:
            raise ValueError("top_k cannot exceed the model vocabulary size.")

        def run() -> str:
            with job.inference_lock:
                return generate_text(
                    job.model,
                    job.tokenizer,
                    request.prompt,
                    temperature=request.temperature,
                    top_k=request.top_k,
                    max_new_tokens=request.max_new_tokens,
                    seed=request.seed,
                )

        output = await asyncio.to_thread(run)
        job.touch()
        job.emit("generation", {
            "generated_characters": len(output),
            "maximum_new_tokens": request.max_new_tokens,
        })
        return output

    def validated_package(self, job: CloudJob) -> Path:
        if job.state != "completed" or job.package_path is None:
            raise JobConflictError("Model download requires a completed job.")
        path = self._safe_job_path(job, job.package_path)
        if not path.is_file() or path.stat().st_size > self.settings.maximum_job_disk_bytes:
            raise JobConflictError("Model package is unavailable.")
        validate_artifact(path)
        job.touch()
        return path

    def expire_due(self, now: float | None = None) -> int:
        current = time.monotonic() if now is None else now
        expired = 0
        for job in list(self.jobs.values()):
            with job.lock:
                if job.state == "expired" or job.deleted:
                    continue
                if current < job.expiration_deadline_mono():
                    continue
                job.cancel_event.set()
                job.state = "expired"
                job.updated_at = datetime.now(UTC)
                job.expired_at_mono = current
                job.cancellation_reason = "retention_limit"
                job.emit("state", {"state": "expired", "reason": "retention_limit"})
                running = job.running
            if not running:
                self._destroy_artifacts(job)
            expired += 1
        with self._lock:
            for job_id, job in list(self.jobs.items()):
                if (
                    job.state == "expired"
                    and job.expired_at_mono is not None
                    and current - job.expired_at_mono > 300
                    and not job.running
                ):
                    self.jobs.pop(job_id, None)
            live_session_ids = {
                job.session_id for job in self.jobs.values() if not job.deleted
            }
            for session_id, session in list(self.sessions.items()):
                if (
                    session_id not in live_session_ids
                    and current - session.last_access_mono
                    > self.settings.inactivity_ttl_seconds
                ):
                    self.sessions.pop(session_id, None)
        return expired

    async def _worker(self, worker_index: int) -> None:
        while not self._closing:
            job = await self._queue.get()
            try:
                if job.deleted or job.state in {"cancelled", "expired"}:
                    continue
                await asyncio.to_thread(self._run_training, job, worker_index)
            finally:
                self._queue.task_done()

    def _run_training(self, job: CloudJob, worker_index: int) -> None:
        with job.lock:
            job.running = True
        try:
            job.transition("initializing", worker=worker_index)
            workspace = (
                self.settings.data_root / f"job-{job.job_id}"
            ).resolve()
            if workspace.parent != self.settings.data_root:
                raise RuntimeError("Unsafe job workspace.")
            workspace.mkdir(mode=0o700, parents=False, exist_ok=False)
            job.workspace = workspace
            job.log_path = workspace / "events.jsonl"
            job.emit("initializing", {"message": "Constructing canonical model."})

            dataset = load_curated_dataset()
            tokenizer = CharacterTokenizer.from_texts(dataset.all_texts)
            model_config = ModelConfig.from_dict(job.request.model.model_dump())
            training_config = TrainingConfig.from_dict(
                job.request.training.model_dump()
            )
            set_reproducible_seed(training_config.seed)
            model = TinyDecoderLM(model_config)
            actual = actual_trainable_parameters(model)
            if actual != job.parameter_count or actual > 200_000:
                raise RuntimeError("Constructed model failed parameter verification.")
            training_loader, validation_loader = create_data_loaders(
                dataset,
                tokenizer,
                context_length=model_config.context_length,
                batch_size=training_config.batch_size,
                seed=training_config.seed,
                stride=job.request.stride,
            )
            job.transition("training")
            result = train_model(
                model,
                tokenizer,
                training_loader,
                validation_loader,
                training_config,
                progress_callback=job.update_progress,
                cancellation_callback=job.cancel_event.is_set,
                progress_every_step=True,
            )
            if job.cancel_event.is_set():
                raise TrainingCancelled("Training was cancelled.")
            checkpoint = workspace / "checkpoint"
            save_checkpoint(
                checkpoint,
                model,
                tokenizer,
                training_config,
                list(result.history),
                dataset_identifier=dataset.dataset_id,
                dataset_sha256=dataset.sha256,
            )
            temporary_package = workspace / "model.mcllm"
            export_package(checkpoint, temporary_package)
            package = workspace / "model.microcomp-model"
            temporary_package.replace(package)
            manifest = validate_artifact(package)
            disk_bytes = sum(
                item.stat().st_size for item in workspace.rglob("*") if item.is_file()
            )
            if disk_bytes > self.settings.maximum_job_disk_bytes:
                raise RuntimeError("Completed job exceeded its disk allocation.")
            with job.lock:
                if job.cancel_event.is_set() or job.state == "expired" or job.deleted:
                    raise TrainingCancelled("Training was cancelled.")
                job.model = model
                job.tokenizer = tokenizer
                job.history = list(result.history)
                job.package_path = package
            job.transition(
                "completed",
                package_bytes=package.stat().st_size,
                parameter_count=manifest["parameter_count"],
                final_sample=result.final_sample,
            )
            LOGGER.info(
                "job_completed",
                extra={"structured": {
                    "job_id": job.job_id,
                    "parameters": job.parameter_count,
                    "steps": training_config.steps,
                    "package_bytes": package.stat().st_size,
                }},
            )
        except TrainingCancelled:
            with job.lock:
                if job.state != "expired" and not job.deleted:
                    job.cancellation_reason = job.cancellation_reason or "requested"
                    job.transition("cancelled", reason=job.cancellation_reason)
            self._destroy_artifacts(job)
        except Exception as error:
            LOGGER.exception(
                "job_failed",
                extra={"structured": {
                    "job_id": job.job_id,
                    "error_type": type(error).__name__,
                }},
            )
            with job.lock:
                if job.state != "expired" and not job.deleted:
                    job.cancellation_reason = "internal_error"
                    job.transition("cancelled", reason="internal_error")
            self._destroy_artifacts(job)
        finally:
            with job.lock:
                job.running = False
                should_destroy = job.deleted or job.state in {"cancelled", "expired"}
            if should_destroy:
                self._destroy_artifacts(job)

    async def _cleanup_loop(self) -> None:
        while not self._closing:
            await asyncio.sleep(self.settings.cleanup_interval_seconds)
            self.expire_due()

    def _safe_job_path(self, job: CloudJob, path: Path) -> Path:
        if job.workspace is None:
            raise JobConflictError("Job workspace is unavailable.")
        workspace = job.workspace.resolve()
        resolved = path.resolve()
        try:
            resolved.relative_to(workspace)
        except ValueError as error:
            raise JobConflictError("Unsafe job artifact path.") from error
        return resolved

    def _destroy_artifacts(self, job: CloudJob) -> None:
        with job.lock:
            terminal_state = job.state
            terminal_reason = job.cancellation_reason
            job.model = None
            job.tokenizer = None
            job.history.clear()
            job.package_path = None
            job.events.clear()
            workspace = job.workspace
            job.log_path = None
            job.workspace = None
            if terminal_state in {"cancelled", "expired"} and not job.deleted:
                job.sequence += 1
                job.events.append({
                    "id": job.sequence,
                    "event": "state",
                    "timestamp": datetime.now(UTC).isoformat(),
                    "data": {
                        "state": terminal_state,
                        "reason": terminal_reason,
                        "artifacts_deleted": True,
                    },
                })
        gc.collect()
        if workspace is None:
            return
        try:
            resolved = workspace.resolve()
            resolved.relative_to(self.settings.data_root)
            if resolved.parent != self.settings.data_root or not resolved.name.startswith("job-"):
                raise RuntimeError("Refusing to remove an unsafe job workspace.")
            shutil.rmtree(resolved, ignore_errors=False)
        except FileNotFoundError:
            pass
        except OSError:
            LOGGER.exception(
                "job_cleanup_failed",
                extra={"structured": {"job_id": job.job_id}},
            )

    def _remove_stale_directories(self) -> None:
        for item in self.settings.data_root.iterdir():
            if item.is_dir() and item.name.startswith("job-"):
                resolved = item.resolve()
                if resolved.parent == self.settings.data_root:
                    shutil.rmtree(resolved)

    def capacity(self) -> dict[str, int]:
        return {
            "concurrent_limit": self.settings.maximum_concurrent_jobs,
            "queued_limit": self.settings.maximum_queued_jobs,
            "queued": self._queue.qsize(),
            "jobs": len(self.jobs),
        }
