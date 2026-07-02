"""Async httpx client wrapping a running orq-lite Go API."""

import httpx

from orquesta_api.logger import get_logger

logger = get_logger(__name__)

# Connect fast-fail (5s); reads can legitimately take longer (large diffs).
_DEFAULT_TIMEOUT = httpx.Timeout(5.0, read=30.0)


class OrqLiteClient:
    """Proxy client for the orq-lite Go API endpoints.

    Parameters
    ----------
    transport:
        Optional ``httpx.BaseTransport`` used when the underlying
        ``httpx.AsyncClient`` is created.  Pass ``httpx.MockTransport(handler)``
        in tests to avoid real network calls.  Production code leaves this
        as ``None``.

    The underlying ``httpx.AsyncClient`` is created lazily on first use and
    reused for every subsequent call through this instance, instead of
    opening and tearing down a new client per request (``Aggregator.snapshot``
    alone makes 3 calls).  Call :meth:`aclose` when done with the instance.
    """

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(transport=self._transport, timeout=_DEFAULT_TIMEOUT)
        return self._client

    async def aclose(self) -> None:
        """Close the underlying httpx client, if one was ever created."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

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
        response = await self._request(base_url, f"/api/diff/{task_id}")
        return response.text

    async def get_result(self, base_url: str, role: str) -> dict:
        """Fetch GET /api/result/{role} and return the parsed JSON body."""
        return await self._get_json(base_url, f"/api/result/{role}")

    async def _get_json(self, base_url: str, path: str) -> dict:
        response = await self._request(base_url, path)
        return response.json()

    async def _request(self, base_url: str, path: str) -> httpx.Response:
        """GET base_url+path, mapping any transport or HTTP-status failure to RuntimeError (-> 502).

        Both failure modes are mapped so callers get a consistent, bounded
        error regardless of whether orq-lite was unreachable or simply
        returned an error status — previously only ``httpx.RequestError``
        (connection failures) was caught; ``httpx.HTTPStatusError`` raised by
        ``raise_for_status()`` escaped uncaught and surfaced as a raw 500.
        """
        url = f"{base_url}{path}"
        client = self._get_client()
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(f"orq-lite returned {exc.response.status_code} for {url}") from exc
        except httpx.RequestError as exc:
            raise RuntimeError(f"orq-lite request failed: {url}") from exc
        logger.info("GET %s => %s", url, response.status_code)
        return response
