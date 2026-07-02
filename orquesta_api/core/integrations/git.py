"""Subprocess wrappers for common git operations."""

import subprocess
from dataclasses import dataclass
from pathlib import Path

from orquesta_api.logger import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class GitStatus:
    """Snapshot of a repository's branch/sha/dirtiness/remote state."""

    current_branch: str | None
    head_sha: str | None
    dirty: bool
    remote_url: str | None


def is_git_repo(path: Path | str) -> bool:
    """Return True if path is inside a git repository."""
    result = subprocess.run(
        ["git", "rev-parse", "--git-dir"],
        capture_output=True,
        cwd=str(path),
    )
    return result.returncode == 0


def status(path: Path | str) -> GitStatus:
    """Return the current branch, head sha, dirtiness, and remote URL for the repo at path."""
    cwd = str(path)

    try:
        branch_result = subprocess.run(
            ["git", "branch", "--show-current"],
            check=True,
            capture_output=True,
            text=True,
            cwd=cwd,
        )
        current_branch: str | None = branch_result.stdout.strip() or None
    except subprocess.CalledProcessError as e:
        raise RuntimeError("git branch --show-current failed") from e

    try:
        sha_result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            cwd=cwd,
        )
        head_sha: str | None = sha_result.stdout.strip() or None
    except subprocess.CalledProcessError as e:
        raise RuntimeError("git rev-parse HEAD failed") from e

    try:
        porcelain_result = subprocess.run(
            ["git", "status", "--porcelain"],
            check=True,
            capture_output=True,
            text=True,
            cwd=cwd,
        )
        dirty = bool(porcelain_result.stdout.strip())
    except subprocess.CalledProcessError as e:
        raise RuntimeError("git status --porcelain failed") from e

    try:
        remote_result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            check=True,
            capture_output=True,
            text=True,
            cwd=cwd,
        )
        remote_url: str | None = remote_result.stdout.strip() or None
    except subprocess.CalledProcessError:
        remote_url = None

    logger.info("git status => %s branch=%s dirty=%s", cwd, current_branch, dirty)

    return GitStatus(
        current_branch=current_branch,
        head_sha=head_sha,
        dirty=dirty,
        remote_url=remote_url,
    )


def clone(url: str, dest: str) -> None:
    """Clone the git repository at url into dest."""
    try:
        subprocess.run(
            ["git", "clone", url, dest],
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info("Cloned %s => %s", url, dest)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"git clone failed: {e.stderr.strip()}") from e


def fetch(path: Path | str) -> None:
    """Fetch from origin for the repo at path."""
    try:
        subprocess.run(
            ["git", "fetch"],
            check=True,
            capture_output=True,
            text=True,
            cwd=str(path),
        )
        logger.info("Fetched => %s", str(path))
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"git fetch failed: {e.stderr.strip()}") from e


def checkout(path: Path | str, branch: str) -> None:
    """Checkout branch in the repo at path."""
    try:
        subprocess.run(
            ["git", "checkout", branch],
            check=True,
            capture_output=True,
            text=True,
            cwd=str(path),
        )
        logger.info("Checked out %s => %s", branch, str(path))
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"git checkout failed: {e.stderr.strip()}") from e


def merge_ff_only(path: Path | str, base_branch: str) -> None:
    """Fast-forward the current branch to origin/<base_branch> in the repo at path."""
    try:
        subprocess.run(
            ["git", "merge", "--ff-only", f"origin/{base_branch}"],
            check=True,
            capture_output=True,
            text=True,
            cwd=str(path),
        )
        logger.info("Fast-forwarded to origin/%s => %s", base_branch, str(path))
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"git merge --ff-only failed: {e.stderr.strip()}") from e
