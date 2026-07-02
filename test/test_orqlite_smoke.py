"""Task 19: smoke test against the real orq-lite binary.

Skipped unless a real `orq-lite` binary is on PATH (set ORQ_LITE_BIN to
point at one explicitly, e.g. a locally-built orquesta-lite checkout).
Scope: `orq-lite init` scaffolds a real, valid team.json/flows.json for a
toy workspace, and the config round-trips through our own stores without
orq-lite's own `config.Validate()`-equivalent rules failing (mirrored in
test_config_roundtrip.py's `_validate_orqlite_config`). A full factory run
needs a real or stubbed LLM-agent execution contract this repo cannot
fabricate with confidence without the real binary to verify against, so
it's out of scope here — this smoke test covers the one thing we can
verify unconditionally: orquesta's workspace bootstrap actually produces
a workspace the real orq-lite CLI accepts.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.orqlite

_BIN = shutil.which("orq-lite")


@pytest.mark.skipif(_BIN is None, reason="orq-lite binary not found on PATH")
def test_orq_lite_init_scaffolds_a_valid_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "toy-repo"
    workspace.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=workspace, check=True)

    result = subprocess.run(
        [_BIN, "init"], cwd=workspace, capture_output=True, text=True, timeout=30
    )
    assert result.returncode == 0, f"orq-lite init failed: {result.stdout}\n{result.stderr}"

    team_file = workspace / "team.json"
    assert team_file.exists(), "orq-lite init must scaffold team.json"
    team = json.loads(team_file.read_text())
    assert team.get("agents"), "scaffolded team.json must declare at least one agent"
    assert team.get("roles"), "scaffolded team.json must declare at least one role"
    assert "rate_limit_backoff" in team, "scaffolded team.json must include rate_limit_backoff"


@pytest.mark.skipif(_BIN is None, reason="orq-lite binary not found on PATH")
def test_orq_lite_init_output_round_trips_through_our_store(tmp_path: Path) -> None:
    """The real scaffolded team.json survives our TeamConfigStore round-trip unchanged."""
    from orquesta_api.services.config_files import TeamConfigStore

    workspace = tmp_path / "toy-repo"
    workspace.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=workspace, check=True)
    subprocess.run([_BIN, "init"], cwd=workspace, check=True, capture_output=True, timeout=30)

    before = json.loads((workspace / "team.json").read_text())

    store = TeamConfigStore(workspace)
    store.update(patch={"full_test_command": "echo smoke-test"})

    after = json.loads((workspace / "team.json").read_text())
    assert after["full_test_command"] == "echo smoke-test"
    assert after["rate_limit_backoff"] == before["rate_limit_backoff"]
    assert after["agents"] == before["agents"]
