"""FastMCP server exposing the Orquesta control plane as agent tools.

Runs as a standalone process (supervised) and proxies to the FastAPI backend
over loopback. opencode registers it as a remote MCP server (see the deploy's
opencode.json) so the chat agent can register projects, launch flows/runs,
toggle watchers and read status — instead of the chat talking to a model SDK
directly.

Run with:  python -m orquesta_api.mcp.server
"""

import os
from typing import Any

import httpx
from fastmcp import FastMCP

from orquesta_api.logger import get_logger

logger = get_logger(__name__)

# The API is co-located in the same container; talk to it over loopback.
# ast-grep-ignore: settings-module
_API_BASE = os.environ.get("ORQUESTA_API_URL", "http://127.0.0.1:8000").rstrip("/")
_MCP_HOST = os.environ.get("ORQUESTA_MCP_HOST", "127.0.0.1")  # ast-grep-ignore: settings-module
_MCP_PORT = int(os.environ.get("ORQUESTA_MCP_PORT", "8765"))  # ast-grep-ignore: settings-module

mcp: FastMCP = FastMCP(
    "orquesta",
    instructions=(
        "Tools for driving the Orquesta control plane: register projects, "
        "inspect state, launch configured flows, and manage GitHub watchers."
    ),
)


async def _request(method: str, path: str, json: dict[str, Any] | None = None) -> Any:
    """Call the control-plane API and return the parsed JSON (or None for 204)."""
    async with httpx.AsyncClient(base_url=_API_BASE, timeout=30.0) as client:
        resp = await client.request(method, path, json=json)
    logger.info("mcp -> %s %s => %s", method, path, resp.status_code)
    if resp.status_code >= 400:
        detail = resp.text
        raise RuntimeError(f"{method} {path} failed ({resp.status_code}): {detail}")
    if resp.status_code == 204 or not resp.content:
        return None
    return resp.json()


@mcp.tool
async def list_projects() -> list[dict[str, Any]]:  # ast-grep-ignore: no-dict-return-annotation
    """List every registered project with its id, state and PR/issue watchers."""
    return await _request("GET", "/projects")


@mcp.tool
async def get_project(project_id: str) -> dict[str, Any]:  # ast-grep-ignore: no-dict-return-annotation
    """Return one project's full state: tasks, factory features and cost."""
    return await _request("GET", f"/projects/{project_id}")


@mcp.tool
async def register_project(
    name: str,
    repo_url: str | None = None,
    base_branch: str = "main",
    workspace_path: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:  # ast-grep-ignore: no-dict-return-annotation
    """Register (and clone) a new project.

    Provide either repo_url (git@github.com:org/repo.git or https://...) — which
    is cloned into a managed workspace — or workspace_path pointing at an existing
    local git repo.
    """
    body: dict[str, Any] = {"name": name, "base_branch": base_branch}
    if repo_url is not None:
        body["repo_url"] = repo_url
    if workspace_path is not None:
        body["workspace_path"] = workspace_path
    if description is not None:
        body["description"] = description
    return await _request("POST", "/projects", json=body)


@mcp.tool
async def list_flows(project_id: str) -> list[dict[str, Any]]:  # ast-grep-ignore: no-dict-return-annotation
    """List the flows defined in a project's flows.json (name, inputs, steps)."""
    return await _request("GET", f"/projects/{project_id}/flows")


@mcp.tool
async def launch_flow(
    project_id: str,
    flow: str,
    inputs: dict[str, str] | None = None,
) -> dict[str, Any]:  # ast-grep-ignore: no-dict-return-annotation
    """Launch a configured flow (e.g. factory, factory_fast) for a project.

    inputs override the flow's declared defaults (e.g. {"features_path":
    "features.md"}). Returns the created run, including its id and state.
    """
    body: dict[str, Any] = {"kind": "flow", "flow": flow, "inputs": inputs or {}}
    return await _request("POST", f"/projects/{project_id}/runs", json=body)


@mcp.tool
async def set_watchers(project_id: str, prs: bool, issues: bool) -> dict[str, Any]:  # ast-grep-ignore: no-dict-return-annotation
    """Enable or disable the per-project GitHub PR and issue watchers."""
    body: dict[str, Any] = {"watch": {"prs": prs, "issues": issues}}
    return await _request("PATCH", f"/projects/{project_id}", json=body)


@mcp.tool
async def start_watch_daemon(project_id: str) -> dict[str, Any]:  # ast-grep-ignore: no-dict-return-annotation
    """Start the long-lived `orq-lite watch` daemon run for a project.

    Fallback for projects without a GitHub webhook: polls GitHub and triages
    new issues / reviews new PRs. Requires the project's watchers to be enabled.
    """
    body: dict[str, Any] = {"kind": "watch"}
    return await _request("POST", f"/projects/{project_id}/runs", json=body)


@mcp.tool
async def list_runs(project_id: str | None = None) -> list[dict[str, Any]]:  # ast-grep-ignore: no-dict-return-annotation
    """List runs, optionally filtered to one project. Shows kind, state and id."""
    path = f"/runs?project={project_id}" if project_id else "/runs"
    return await _request("GET", path)


@mcp.tool
async def stop_run(run_id: str) -> dict[str, Any]:  # ast-grep-ignore: no-dict-return-annotation
    """Stop an active run (agent loop or watch daemon) by its id."""
    return await _request("POST", f"/runs/{run_id}/stop")


def main() -> None:
    """Serve the MCP tools over streamable HTTP for opencode to connect to."""
    logger.info("Starting Orquesta MCP server => %s:%s/mcp (api=%s)", _MCP_HOST, _MCP_PORT, _API_BASE)
    mcp.run(transport="http", host=_MCP_HOST, port=_MCP_PORT, path="/mcp")


if __name__ == "__main__":
    main()
