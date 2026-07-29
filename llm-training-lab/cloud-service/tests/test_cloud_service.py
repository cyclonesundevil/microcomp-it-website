from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from microcomp_llm.portable import validate_artifact
from microcomp_cloud.app import create_app
from microcomp_cloud.config import Settings, SettingsError
from microcomp_cloud.jobs import JobConflictError

API_KEY = "test-api-key-with-at-least-24-characters"


def settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "api_key": API_KEY,
        "data_root": tmp_path / "jobs",
        "inactivity_ttl_seconds": 3600,
        "maximum_lifetime_seconds": 21600,
        "cleanup_interval_seconds": 300,
        "maximum_concurrent_jobs": 1,
        "maximum_queued_jobs": 4,
        "maximum_jobs_per_session": 3,
        "maximum_training_steps": 500,
        "maximum_batch_size": 8,
        "maximum_request_bytes": 65_536,
        "maximum_job_disk_bytes": 20 * 1024 * 1024,
        "maximum_estimated_memory_bytes": 384 * 1024 * 1024,
        "maximum_events_per_job": 128,
        "rate_limit_requests": 500,
        "rate_limit_window_seconds": 60,
        "torch_threads": 1,
        "log_level": "CRITICAL",
        "cors_origins": (),
    }
    values.update(overrides)
    return Settings(**values)


def session_headers(client: TestClient) -> dict[str, str]:
    response = client.post("/v1/sessions", headers={"X-API-Key": API_KEY})
    assert response.status_code == 201, response.text
    value = response.json()
    assert value["anonymous"] is True
    return {
        "X-API-Key": API_KEY,
        "Authorization": f"Bearer {value['session_token']}",
    }


def small_job(steps: int = 2) -> dict:
    return {
        "dataset_id": "cybersecurity-alerts-v1",
        "model": {
            "vocab_size": 35,
            "context_length": 8,
            "embedding_dim": 8,
            "attention_heads": 2,
            "transformer_blocks": 1,
            "feed_forward_dim": 16,
            "dropout": 0.0,
            "tie_embeddings": False,
        },
        "training": {
            "learning_rate": 0.003,
            "batch_size": 1,
            "steps": steps,
            "validation_interval": 1,
            "checkpoint_interval": 1,
            "gradient_clip_norm": 1.0,
            "seed": 5,
            "validation_batches": 1,
            "sample_prompt": "alert: ",
            "sample_max_new_tokens": 2,
            "sample_temperature": 1.0,
            "sample_top_k": 1,
        },
        "stride": 8,
    }


def wait_for_state(
    client: TestClient,
    headers: dict[str, str],
    job_id: str,
    expected: set[str],
    timeout: float = 15,
) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(f"/v1/jobs/{job_id}", headers=headers)
        assert response.status_code == 200, response.text
        value = response.json()
        if value["state"] in expected:
            return value
        time.sleep(0.05)
    raise AssertionError(f"Job did not reach {expected}.")


def test_settings_fail_closed_for_short_keys_and_unsafe_roots(tmp_path: Path) -> None:
    with pytest.raises(SettingsError, match="24"):
        settings(tmp_path, api_key="short")
    with pytest.raises(SettingsError, match="filesystem root"):
        settings(tmp_path, data_root=Path(Path.cwd().anchor))


def test_health_is_public_but_sessions_require_api_key(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        assert client.get("/healthz").json()["status"] == "ok"
        assert client.get("/readyz").json()["status"] == "ready"
        assert client.post("/v1/sessions").status_code == 401
        assert client.post(
            "/v1/sessions", headers={"X-API-Key": "wrong"}
        ).status_code == 401
        assert client.post(
            "/v1/sessions", headers={"X-API-Key": API_KEY}
        ).status_code == 201
        schemes = client.get("/openapi.json").json()["components"]["securitySchemes"]
        assert schemes["APIKeyHeader"]["in"] == "header"
        assert schemes["APIKeyHeader"]["name"] == "X-API-Key"
        assert schemes["HTTPBearer"]["scheme"] == "bearer"


def test_anonymous_sessions_cannot_read_each_others_jobs(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        owner = session_headers(client)
        other = session_headers(client)
        created = client.post("/v1/jobs", headers=owner, json=small_job())
        assert created.status_code == 202, created.text
        job_id = created.json()["job_id"]
        assert client.get(f"/v1/jobs/{job_id}", headers=other).status_code == 404
        client.delete(f"/v1/jobs/{job_id}", headers=owner)


def test_strict_parameter_and_service_limits_are_enforced(tmp_path: Path) -> None:
    with TestClient(create_app(settings(
        tmp_path, maximum_training_steps=4, maximum_batch_size=2
    ))) as client:
        headers = session_headers(client)
        over_steps = small_job(5)
        response = client.post("/v1/jobs", headers=headers, json=over_steps)
        assert response.status_code == 422
        assert "service limit" in response.json()["detail"]

        over_parameters = small_job()
        over_parameters["model"].update({
            "context_length": 256,
            "embedding_dim": 128,
            "attention_heads": 8,
            "transformer_blocks": 4,
            "feed_forward_dim": 512,
        })
        response = client.post("/v1/jobs", headers=headers, json=over_parameters)
        assert response.status_code == 422
        assert "200,000" in response.json()["detail"]

        unexpected = small_job()
        unexpected["execute"] = "anything"
        assert client.post("/v1/jobs", headers=headers, json=unexpected).status_code == 422

    with TestClient(create_app(settings(
        tmp_path / "memory",
        maximum_estimated_memory_bytes=64 * 1024 * 1024,
    ))) as client:
        headers = session_headers(client)
        high_activation = small_job()
        high_activation["model"].update({
            "context_length": 256,
            "embedding_dim": 32,
            "attention_heads": 8,
            "transformer_blocks": 4,
            "feed_forward_dim": 64,
        })
        high_activation["training"]["batch_size"] = 8
        high_activation["stride"] = 256
        response = client.post("/v1/jobs", headers=headers, json=high_activation)
        assert response.status_code == 422
        assert "memory allocation" in response.json()["detail"]


def test_real_training_sse_generation_download_and_delete(tmp_path: Path) -> None:
    app = create_app(settings(tmp_path))
    with TestClient(app) as client:
        headers = session_headers(client)
        created = client.post("/v1/jobs", headers=headers, json=small_job())
        assert created.status_code == 202, created.text
        value = created.json()
        assert value["state"] == "queued"
        assert value["parameter_count"] == 1275
        job_id = value["job_id"]
        completed = wait_for_state(client, headers, job_id, {"completed"})
        assert completed["progress"]["step"] == 2
        assert completed["progress"]["tokens_processed"] == 16
        assert completed["download_ready"] is True

        with client.stream(
            "GET", f"/v1/jobs/{job_id}/events", headers=headers
        ) as response:
            body = "".join(response.iter_text())
        assert response.status_code == 200
        assert "event: state" in body
        assert '"state":"completed"' in body
        assert "event: progress" in body

        generated = client.post(
            f"/v1/jobs/{job_id}/generate",
            headers=headers,
            json={
                "prompt": "alert: ",
                "temperature": 1.0,
                "top_k": 1,
                "max_new_tokens": 2,
                "seed": 5,
            },
        )
        assert generated.status_code == 200, generated.text
        assert isinstance(generated.json()["text"], str)

        downloaded = client.get(f"/v1/jobs/{job_id}/download", headers=headers)
        assert downloaded.status_code == 200, downloaded.text
        assert downloaded.headers["content-disposition"].endswith(
            f'microcomp-cloud-{job_id}.microcomp-model"'
        )
        package = tmp_path / "download.microcomp-model"
        package.write_bytes(downloaded.content)
        manifest = validate_artifact(package)
        assert manifest["parameter_count"] == 1275
        assert manifest["architecture_identifier"].endswith(".v1")

        job = app.state.manager.owned_job(
            app.state.manager.authenticate_session(
                headers["Authorization"].removeprefix("Bearer ")
            ),
            job_id,
        )
        workspace = job.workspace
        assert workspace is not None and workspace.exists()
        assert client.delete(f"/v1/jobs/{job_id}", headers=headers).status_code == 204
        assert not workspace.exists()
        assert client.get(f"/v1/jobs/{job_id}", headers=headers).status_code == 404


def test_cancellation_reaches_terminal_state_and_removes_artifacts(tmp_path: Path) -> None:
    app = create_app(settings(tmp_path))
    payload = small_job(500)
    payload["model"].update({
        "context_length": 128,
        "embedding_dim": 64,
        "attention_heads": 4,
        "transformer_blocks": 3,
        "feed_forward_dim": 128,
    })
    payload["stride"] = 128
    payload["training"]["validation_interval"] = 500
    payload["training"]["checkpoint_interval"] = 500
    with TestClient(app) as client:
        headers = session_headers(client)
        created = client.post("/v1/jobs", headers=headers, json=payload)
        assert created.status_code == 202, created.text
        job_id = created.json()["job_id"]
        cancelled = client.post(f"/v1/jobs/{job_id}/cancel", headers=headers)
        assert cancelled.status_code == 200, cancelled.text
        final = wait_for_state(client, headers, job_id, {"cancelled"})
        assert final["download_ready"] is False
        assert final["cancellation_reason"] == "requested"
        assert client.get(f"/v1/jobs/{job_id}/download", headers=headers).status_code == 409


def test_expiration_deletes_weights_history_logs_and_temporary_files(
    tmp_path: Path,
) -> None:
    app = create_app(settings(
        tmp_path, inactivity_ttl_seconds=1, maximum_lifetime_seconds=10
    ))
    with TestClient(app) as client:
        headers = session_headers(client)
        created = client.post("/v1/jobs", headers=headers, json=small_job())
        job_id = created.json()["job_id"]
        wait_for_state(client, headers, job_id, {"completed"})
        manager = app.state.manager
        session = manager.authenticate_session(
            headers["Authorization"].removeprefix("Bearer ")
        )
        job = manager.owned_job(session, job_id)
        workspace = job.workspace
        assert workspace and workspace.exists()
        assert job.model is not None and job.history
        assert manager.expire_due(job.created_mono + 11) == 1
        assert job.state == "expired"
        assert job.model is None
        assert job.history == []
        assert job.workspace is None
        assert not workspace.exists()
        assert job.events[-1]["data"]["artifacts_deleted"] is True


def test_rate_limit_body_limit_and_traversal_resistance(tmp_path: Path) -> None:
    app = create_app(settings(
        tmp_path,
        rate_limit_requests=2,
        maximum_request_bytes=1024,
    ))
    with TestClient(app) as client:
        headers = {"X-API-Key": API_KEY}
        assert client.post("/v1/sessions", headers=headers).status_code == 201
        assert client.post("/v1/sessions", headers=headers).status_code == 201
        limited = client.post("/v1/sessions", headers=headers)
        assert limited.status_code == 429
        assert int(limited.headers["retry-after"]) >= 1

    app = create_app(settings(tmp_path / "second", maximum_request_bytes=1024))
    with TestClient(app) as client:
        headers = session_headers(client)
        oversized = client.post(
            "/v1/jobs",
            headers={**headers, "Content-Type": "application/json"},
            content=json.dumps({"padding": "x" * 2000}),
        )
        assert oversized.status_code == 413
        assert client.get(
            "/v1/jobs/%2e%2e%2fetc%2fpasswd", headers=headers
        ).status_code in {404, 422}


def test_package_path_must_remain_inside_job_workspace(tmp_path: Path) -> None:
    app = create_app(settings(tmp_path))
    with TestClient(app) as client:
        headers = session_headers(client)
        created = client.post("/v1/jobs", headers=headers, json=small_job())
        job_id = created.json()["job_id"]
        wait_for_state(client, headers, job_id, {"completed"})
        manager = app.state.manager
        session = manager.authenticate_session(
            headers["Authorization"].removeprefix("Bearer ")
        )
        job = manager.owned_job(session, job_id)
        job.package_path = tmp_path / "outside.microcomp-model"
        with pytest.raises(JobConflictError, match="Unsafe"):
            manager.validated_package(job)
