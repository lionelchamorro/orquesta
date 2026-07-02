"""A fake docker-py SDK client.

Mimics the tiny slice of the real API used by
orquesta_api.core.integrations.docker_client.DockerClient. No real Docker
daemon is available in this environment, so DockerClient/DockerExecutor are
tested against this instead.
"""

from typing import Any


class FakeContainer:
    def __init__(self, container_id: str, attrs: dict[str, Any], logs_output: bytes = b"") -> None:
        self.id = container_id
        self.attrs = attrs
        self._logs_output = logs_output
        self.stop_calls: list[dict[str, Any]] = []
        self.restart_calls: list[dict[str, Any]] = []

    def logs(self, **kwargs: Any) -> bytes:
        return self._logs_output

    def stop(self, **kwargs: Any) -> None:
        self.stop_calls.append(kwargs)
        self.attrs["State"]["Running"] = False
        self.attrs["State"]["Status"] = "exited"
        self.attrs["State"]["ExitCode"] = 0

    def restart(self, **kwargs: Any) -> None:
        self.restart_calls.append(kwargs)

    # ast-grep-ignore: no-dict-return-annotation
    def wait(self) -> dict[str, int]:
        # ast-grep-ignore: no-dict-literal-return
        return {"StatusCode": self.attrs["State"].get("ExitCode", 0)}


class FakeContainerCollection:
    def __init__(self) -> None:
        self._containers: dict[str, FakeContainer] = {}
        self.run_calls: list[dict[str, Any]] = []
        self._next_id = 1

    def run(self, image: str, command: list[str], **kwargs: Any) -> FakeContainer:
        container_id = f"container-{self._next_id}"
        self._next_id += 1
        attrs = {
            "Id": container_id,
            "Name": f"/{kwargs.get('name', container_id)}",
            "Config": {"Image": image, "Labels": dict(kwargs.get("labels", {}))},
            "State": {"Running": True, "Status": "running", "ExitCode": 0, "Health": {}},
            "Created": "2026-07-02T00:00:00.000000000Z",
        }
        container = FakeContainer(container_id, attrs, logs_output=b"hello\nworld\n")
        self._containers[container_id] = container
        self.run_calls.append({"image": image, "command": command, **kwargs})
        return container

    def get(self, container_id: str) -> FakeContainer:
        return self._containers[container_id]

    def list(self, all: bool = False, filters: dict[str, Any] | None = None) -> list[FakeContainer]:
        results = list(self._containers.values())
        if filters and "label" in filters:
            wanted = set(filters["label"])
            results = [
                c
                for c in results
                if wanted <= {f"{k}={v}" for k, v in c.attrs["Config"]["Labels"].items()}
            ]
        return results


class FakeImageCollection:
    def __init__(self) -> None:
        self.pulled: list[str] = []

    def pull(self, repository: str, tag: str | None = None, **kwargs: Any) -> None:
        self.pulled.append(repository)


class FakeDockerSDK:
    """Stands in for docker.DockerClient."""

    def __init__(self) -> None:
        self.containers = FakeContainerCollection()
        self.images = FakeImageCollection()
