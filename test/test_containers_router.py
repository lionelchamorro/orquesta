"""Task 14: /containers and /images/pull endpoints.

501 with the local executor; real dispatch with the docker executor
(against fake_docker_sdk.py).
"""

from fake_docker_sdk import FakeDockerSDK
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.requests import Request
from starlette.testclient import TestClient

import orquesta_api.routers.containers as containers_module
from orquesta_api.config import settings
from orquesta_api.core.integrations.docker_client import DockerClient
from orquesta_api.routers.containers import images_router
from orquesta_api.routers.containers import router as containers_router


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(containers_router)
    app.include_router(images_router)

    @app.exception_handler(NotImplementedError)
    async def _not_implemented_handler(_request: Request, exc: NotImplementedError) -> JSONResponse:
        return JSONResponse(status_code=501, content={"detail": str(exc)})

    return app


def test_list_containers_501_with_local_executor(monkeypatch) -> None:
    monkeypatch.setattr(settings, "run_executor", "local")
    client = TestClient(_make_app())
    res = client.get("/containers")
    assert res.status_code == 501


def test_pull_image_501_with_local_executor(monkeypatch) -> None:
    monkeypatch.setattr(settings, "run_executor", "local")
    client = TestClient(_make_app())
    res = client.post("/images/pull", json={"image": "orq-lite:latest"})
    assert res.status_code == 501


def test_list_and_inspect_containers_with_docker_executor(monkeypatch) -> None:
    monkeypatch.setattr(settings, "run_executor", "docker")
    fake_sdk = FakeDockerSDK()
    monkeypatch.setattr(containers_module, "_client", DockerClient(sdk_client=fake_sdk))

    fake_sdk.containers.run(
        "orq-lite:latest",
        ["run"],
        name="orquesta-run-r1",
        labels={"orquesta.managed": "true", "orquesta.project": "atlas", "orquesta.run": "r1"},
        volumes={},
    )

    client = TestClient(_make_app())
    res = client.get("/containers")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["project_id"] == "atlas"

    container_id = body[0]["id"]
    res2 = client.get(f"/containers/{container_id}")
    assert res2.status_code == 200
    assert res2.json()["id"] == container_id


def test_stop_and_restart_containers_with_docker_executor(monkeypatch) -> None:
    monkeypatch.setattr(settings, "run_executor", "docker")
    fake_sdk = FakeDockerSDK()
    monkeypatch.setattr(containers_module, "_client", DockerClient(sdk_client=fake_sdk))

    container = fake_sdk.containers.run("orq-lite:latest", ["run"], name="t", labels={}, volumes={})

    client = TestClient(_make_app())
    res_stop = client.post(f"/containers/{container.id}/stop")
    assert res_stop.status_code == 204
    assert container.stop_calls

    res_restart = client.post(f"/containers/{container.id}/restart")
    assert res_restart.status_code == 204
    assert container.restart_calls


def test_pull_image_with_docker_executor(monkeypatch) -> None:
    monkeypatch.setattr(settings, "run_executor", "docker")
    fake_sdk = FakeDockerSDK()
    monkeypatch.setattr(containers_module, "_client", DockerClient(sdk_client=fake_sdk))

    client = TestClient(_make_app())
    res = client.post("/images/pull", json={"image": "orq-lite:v0.2.0"})
    assert res.status_code == 204
    assert fake_sdk.images.pulled == ["orq-lite:v0.2.0"]
