"""Task 14: DockerClient + DockerExecutor against a fake docker-py SDK.

No Docker daemon is available in this environment, so these exercise the
full DockerClient -> DockerExecutor call chain against test/fake_docker_sdk.py
instead of a real Engine API — real-world verification is a known gap
(documented in the commit), but the argument-building, label, and state-
mapping logic here is real and tested.
"""

from pathlib import Path

import pytest

from orquesta_api.core.integrations.docker_client import (
    MANAGED_LABEL,
    PROJECT_LABEL,
    RUN_LABEL,
    DockerClient,
    container_from_attrs,
)
from orquesta_api.executors.docker import DockerExecutor
from orquesta_api.meta.models import ContainerState, RunHandle, RunKind, RunSpec, RunState
from test.fake_docker_sdk import FakeDockerSDK

# ---------------------------------------------------------------------------
# DockerClient
# ---------------------------------------------------------------------------


async def test_run_container_returns_the_container_id() -> None:
    sdk = FakeDockerSDK()
    client = DockerClient(sdk_client=sdk)
    container_id = await client.run_container(
        "orq-lite:latest", ["run"], name="test", labels={"a": "b"}, volumes={}
    )
    assert container_id == "container-1"
    assert sdk.containers.run_calls[0]["image"] == "orq-lite:latest"
    assert sdk.containers.run_calls[0]["command"] == ["run"]


async def test_inspect_returns_raw_attrs() -> None:
    sdk = FakeDockerSDK()
    client = DockerClient(sdk_client=sdk)
    container_id = await client.run_container("img", ["run"], name="t", labels={}, volumes={})
    attrs = await client.inspect(container_id)
    assert attrs["Id"] == container_id


async def test_stop_and_restart_delegate_to_the_container() -> None:
    sdk = FakeDockerSDK()
    client = DockerClient(sdk_client=sdk)
    container_id = await client.run_container("img", ["run"], name="t", labels={}, volumes={})

    await client.stop(container_id, timeout=5)
    await client.restart(container_id, timeout=5)

    container = sdk.containers.get(container_id)
    assert container.stop_calls == [{"timeout": 5}]
    assert container.restart_calls == [{"timeout": 5}]


async def test_logs_returns_decoded_lines() -> None:
    sdk = FakeDockerSDK()
    client = DockerClient(sdk_client=sdk)
    container_id = await client.run_container("img", ["run"], name="t", labels={}, volumes={})
    lines = [line async for line in client.logs(container_id)]
    assert lines == ["hello", "world"]


async def test_list_managed_filters_by_project_label() -> None:
    sdk = FakeDockerSDK()
    client = DockerClient(sdk_client=sdk)
    await client.run_container(
        "img", ["run"], name="a", labels={MANAGED_LABEL: "true", PROJECT_LABEL: "atlas"}, volumes={}
    )
    await client.run_container(
        "img", ["run"], name="b", labels={MANAGED_LABEL: "true", PROJECT_LABEL: "orion"}, volumes={}
    )

    all_managed = await client.list_managed()
    assert len(all_managed) == 2

    atlas_only = await client.list_managed(project_id="atlas")
    assert len(atlas_only) == 1
    assert atlas_only[0]["Config"]["Labels"][PROJECT_LABEL] == "atlas"


async def test_pull_image_delegates_to_images_pull() -> None:
    sdk = FakeDockerSDK()
    client = DockerClient(sdk_client=sdk)
    await client.pull_image("orq-lite:v0.2.0")
    assert sdk.images.pulled == ["orq-lite:v0.2.0"]


# ---------------------------------------------------------------------------
# container_from_attrs
# ---------------------------------------------------------------------------


def test_container_from_attrs_maps_running_state() -> None:
    attrs = {
        "Id": "abc123",
        "Name": "/orquesta-run-r1",
        "Config": {"Image": "orq-lite:latest", "Labels": {PROJECT_LABEL: "atlas", RUN_LABEL: "r1"}},
        "State": {"Status": "running", "Health": {}},
        "Created": "2026-07-02T00:00:00.000000000Z",
    }
    container = container_from_attrs(attrs)
    assert container.id == "abc123"
    assert container.name == "orquesta-run-r1"
    assert container.project_id == "atlas"
    assert container.run_id == "r1"
    assert container.state == ContainerState.running


def test_container_from_attrs_unknown_status_maps_to_dead() -> None:
    attrs = {"Id": "x", "Config": {}, "State": {"Status": "not-a-real-status"}}
    assert container_from_attrs(attrs).state == ContainerState.dead


# ---------------------------------------------------------------------------
# DockerExecutor
# ---------------------------------------------------------------------------


@pytest.fixture
def spec(tmp_path: Path) -> RunSpec:
    workspace = tmp_path / "atlas"
    workspace.mkdir()
    return RunSpec(project_id="atlas", workspace_path=str(workspace), kind=RunKind.run)


async def test_start_labels_and_mounts_the_workspace(spec: RunSpec) -> None:
    sdk = FakeDockerSDK()
    executor = DockerExecutor(client=DockerClient(sdk_client=sdk), image="orq-lite:latest")
    handle = await executor.start(spec, run_id="r1")

    assert handle.container_id == "container-1"
    call = sdk.containers.run_calls[0]
    assert call["command"] == ["run"]  # build_argv's leading bin-path token is dropped
    assert call["labels"] == {MANAGED_LABEL: "true", PROJECT_LABEL: "atlas", RUN_LABEL: "r1"}
    workspace_key = str(Path(spec.workspace_path).resolve())
    assert workspace_key in call["volumes"]
    assert call["volumes"][workspace_key]["bind"] == "/workspace"


async def test_status_reports_running_then_succeeded(spec: RunSpec) -> None:
    sdk = FakeDockerSDK()
    executor = DockerExecutor(client=DockerClient(sdk_client=sdk))
    handle = await executor.start(spec, run_id="r1")

    assert await executor.status(handle) == RunState.running

    await executor.stop(handle)
    assert await executor.status(handle) == RunState.succeeded


async def test_status_reports_failed_for_unknown_container() -> None:
    executor = DockerExecutor(client=DockerClient(sdk_client=FakeDockerSDK()))
    handle = RunHandle(container_id="does-not-exist", run_id="r1")
    assert await executor.status(handle) == RunState.failed


async def test_status_with_no_container_id_is_failed() -> None:
    executor = DockerExecutor(client=DockerClient(sdk_client=FakeDockerSDK()))
    assert await executor.status(RunHandle(run_id="r1")) == RunState.failed


async def test_wait_returns_the_exit_code(spec: RunSpec) -> None:
    sdk = FakeDockerSDK()
    executor = DockerExecutor(client=DockerClient(sdk_client=sdk))
    handle = await executor.start(spec, run_id="r1")
    assert await executor.wait(handle) == 0


async def test_logs_streams_lines(spec: RunSpec) -> None:
    sdk = FakeDockerSDK()
    executor = DockerExecutor(client=DockerClient(sdk_client=sdk))
    handle = await executor.start(spec, run_id="r1")
    lines = [line async for line in executor.logs(handle)]
    assert lines == ["hello", "world"]


async def test_inspect_returns_a_container_model(spec: RunSpec) -> None:
    sdk = FakeDockerSDK()
    executor = DockerExecutor(client=DockerClient(sdk_client=sdk))
    handle = await executor.start(spec, run_id="r1")
    container = await executor.inspect(handle)
    assert container is not None
    assert container.project_id == "atlas"
    assert container.run_id == "r1"


async def test_stop_calls_docker_stop_with_grace_period(spec: RunSpec) -> None:
    sdk = FakeDockerSDK()
    executor = DockerExecutor(client=DockerClient(sdk_client=sdk))
    handle = await executor.start(spec, run_id="r1")
    await executor.stop(handle, grace_s=3)
    assert sdk.containers.get(handle.container_id).stop_calls == [{"timeout": 3}]
