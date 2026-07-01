"""Abstract base class for run executors."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from orquesta_api.meta.models import Container, RunHandle, RunSpec, RunState


class ExecutorInterface(ABC):
    """Contract that every executor backend must satisfy."""

    @abstractmethod
    async def start(self, spec: RunSpec) -> RunHandle: ...

    @abstractmethod
    async def stop(self, handle: RunHandle, grace_s: int = 10) -> None: ...

    @abstractmethod
    async def status(self, handle: RunHandle) -> RunState: ...

    @abstractmethod
    def logs(self, handle: RunHandle, tail: int | None = None) -> AsyncIterator[str]: ...

    @abstractmethod
    async def inspect(self, handle: RunHandle) -> Container | None: ...
