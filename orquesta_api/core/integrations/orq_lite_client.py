"""Async httpx client wrapping a running orq-lite Go API."""

import httpx

from orquesta_api.logger import get_logger

logger = get_logger(__name__)


class OrqLiteClient:
    """Proxy client for the orq-lite Go API endpoints.

    Parameters
    ----------
    transport:
        Optional ``httpx.BaseTransport`` injected into every ``AsyncClient``
        instance.  Pass ``httpx.MockTransport(handler)`` in tests to avoid
        real network calls.  Production code leaves this as ``None``.
    """

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    async def get_tasks(self, base_url: str) -> dict:
        """Fetch GET /api/tasks and return the parsed JSON body."""
        return await self._get_json(base_url, "/api/tasks")

    async def get_factory(self, base_url: str) -> dict:
        """Fetch GET /api/factory and return the parsed JSON body."""
        return await self._get_json(base_url, "/api/factory")

    async def get_cost(self, base_url: str) -> dict:
        """Fetch GET /api/cost and return the parsed JSON body."""
        return await self._get_json(base_url, "/api/cost")

    async def get_diff(self, base_url: str, task_id: str) -> str:
        """Fetch GET /api/diff/{task_id} and return the response body as plain text."""
        url = f"{base_url}/api/diff/{task_id}"
        try:
            async with httpx.AsyncClient(transport=self._transport) as client:
                response = await client.get(url)
                response.raise_for_status()
                logger.info("GET %s => %s", url, response.status_code)
                return response.text
        except httpx.RequestError as exc:
            raise RuntimeError(f"orq-lite request failed: {url}") from exc

    async def get_result(self, base_url: str, role: str) -> dict:
        """Fetch GET /api/result/{role} and return the parsed JSON body."""
        return await self._get_json(base_url, f"/api/result/{role}")

    async def _get_json(self, base_url: str, path: str) -> dict:
        url = f"{base_url}{path}"
        try:
            async with httpx.AsyncClient(transport=self._transport) as client:
                response = await client.get(url)
                response.raise_for_status()
                logger.info("GET %s => %s", url, response.status_code)
                return response.json()
        except httpx.RequestError as exc:
            raise RuntimeError(f"orq-lite request failed: {url}") from exc
