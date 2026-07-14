"""Safe file listing and reading of orq-lite run artifacts.

All paths are resolved against the run's canonical root
(<workspace>/.orquestalite/runs/<run_id>/) and any path that escapes that
root (via .., symlinks pointing outside, or absolute paths) raises
PathTraversalError.
"""

from dataclasses import dataclass, field
from pathlib import Path

from orquesta_api.logger import get_logger

logger = get_logger(__name__)

# Size cap for text reads — protects against loading giant transcripts into
# API memory.  Truncated files include a sentinel at the cut point.
MAX_READ_BYTES = 256 * 1024  # 256 KiB

_ORQ_LITE_RUNS_SUBDIR = Path(".orquestalite") / "runs"


class PathTraversalError(ValueError):
    """Raised when a caller-supplied path escapes the permitted root."""


@dataclass
class ArtifactEntry:
    """One entry in a directory listing."""

    name: str
    size: int
    is_dir: bool
    path: str  # relative to the run root


@dataclass
class ArtifactListing:
    """Directory listing for a run artifacts subtree."""

    root: str  # run_id
    dir: str  # subpath listed (empty string == run root)
    entries: list[ArtifactEntry] = field(default_factory=list)


@dataclass
class ArtifactContent:
    """Content of one artifact file."""

    path: str  # subpath within the run root
    content: str
    size: int
    truncated: bool


class ArtifactsService:
    """Read-only access to orq-lite run artifacts on the local filesystem.

    The permitted root for all paths is::

        <workspace_path>/.orquestalite/runs/<run_id>/

    Any caller-supplied path is resolved with ``resolve()`` (follows symlinks)
    and then validated to be a descendant of that root.  Absolute paths and
    ``..`` segments are caught at this validation step.
    """

    def __init__(self, workspace_path: str) -> None:
        self._workspace = Path(workspace_path).resolve()

    def _run_root(self, run_id: str) -> Path:
        """Return the canonical on-disk root for *run_id*'s artifacts."""
        return self._workspace / _ORQ_LITE_RUNS_SUBDIR / run_id

    def _safe_resolve(self, run_id: str, subpath: str) -> Path:
        """Resolve *subpath* relative to the run root and validate containment.

        Raises:
            PathTraversalError: if the resolved path escapes the run root.
        """
        run_root = self._run_root(run_id)

        # Reject absolute paths immediately — they are unambiguously wrong and
        # should not be silently relativised, as that could mask intent.
        if subpath.startswith("/"):
            raise PathTraversalError(
                f"Absolute paths are not permitted; got '{subpath}'"
            )

        # Strip any remaining leading slashes (defensive, after the check above).
        stripped = subpath.lstrip("/")
        candidate = (run_root / stripped).resolve()

        # The resolved path must be the run root itself or a descendant.
        try:
            candidate.relative_to(run_root.resolve())
        except ValueError:
            raise PathTraversalError(
                f"Path '{subpath}' escapes the permitted run root for '{run_id}'"
            ) from None

        return candidate

    async def list_dir(self, run_id: str, subpath: str = "") -> ArtifactListing:
        """Return a shallow directory listing for *subpath* within *run_id*'s root.

        Args:
            run_id: orq-lite run identifier (e.g. "r20260710T015038Z-e548").
            subpath: path relative to the run root to list.  Empty string lists
                the run root itself.

        Returns:
            ArtifactListing with one ArtifactEntry per direct child.

        Raises:
            PathTraversalError: if subpath escapes the run root.
            FileNotFoundError: if the target directory does not exist.
        """
        target = self._safe_resolve(run_id, subpath)

        if not target.exists():
            raise FileNotFoundError(f"Directory not found: {subpath!r}")

        run_root_str = str(self._run_root(run_id))
        entries: list[ArtifactEntry] = []
        for child in sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name)):
            try:
                size = child.stat().st_size if child.is_file() else 0
                rel = str(child).replace(run_root_str, "").lstrip("/")
                entries.append(
                    ArtifactEntry(
                        name=child.name,
                        size=size,
                        is_dir=child.is_dir(),
                        path=rel,
                    )
                )
            except OSError:
                # Skip entries we can't stat (e.g. broken symlinks).
                pass

        return ArtifactListing(
            root=run_id,
            dir=subpath,
            entries=entries,
        )

    async def read_file(self, run_id: str, subpath: str) -> ArtifactContent:
        """Return the text content of *subpath* within *run_id*'s artifact root.

        Args:
            run_id: orq-lite run identifier.
            subpath: path relative to the run root of the file to read.

        Returns:
            ArtifactContent.  Binary or non-UTF-8 content is returned with
            replacement characters; very large files are truncated at
            MAX_READ_BYTES.

        Raises:
            PathTraversalError: if subpath escapes the run root.
            FileNotFoundError: if the target does not exist.
            IsADirectoryError: if the target is a directory, not a file.
        """
        target = self._safe_resolve(run_id, subpath)

        if not target.exists():
            raise FileNotFoundError(f"File not found: {subpath!r}")

        if target.is_dir():
            raise IsADirectoryError(f"Path is a directory, not a file: {subpath!r}")

        total_size = target.stat().st_size
        truncated = total_size > MAX_READ_BYTES

        with target.open("rb") as fh:
            raw = fh.read(MAX_READ_BYTES)

        content = raw.decode("utf-8", errors="replace")
        if truncated:
            shown_kib = MAX_READ_BYTES // 1024
            total_kib = total_size // 1024
            content += f"\n\n[… truncated: showing first {shown_kib} KiB of {total_kib} KiB …]"

        return ArtifactContent(
            path=subpath,
            content=content,
            size=total_size,
            truncated=truncated,
        )
