"""Feature-queue service: append features to a project's features.md file.

Writing to features.md is the single write path for both the REST endpoint
and the chat/MCP tools. The format matches what orq-lite's
``factory_extract_features`` action expects: a Markdown file where every
``## Heading`` section is one feature, and the content under the heading is
the feature plan.

Example (from the repo's own features.md):

    # Title

    Optional prose.

    ## Feature name

    Feature plan text here.

No code here touches the running orq-lite serve — it only writes a file in
the project's workspace. Launching the factory flow is a separate action the
user performs from the UI or chat.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.logger import get_logger
from orquesta_api.services.projects import ProjectService

logger = get_logger(__name__)

_FEATURES_FILENAME = "features.md"


def _validate_title(title: str) -> str:
    """Return a clean title, raising ValueError for empty or invalid input."""
    title = title.strip()
    if not title:
        raise ValueError("title must not be empty")
    # Strip leading '#' characters that would nest the markdown heading.
    title = title.lstrip("#").strip()
    if not title:
        raise ValueError("title must not be empty after stripping '#' characters")
    return title


def features_file_path(workspace_path: str) -> Path:
    """Return the absolute path to features.md for *workspace_path*."""
    return Path(workspace_path) / _FEATURES_FILENAME


def format_feature_block(title: str, description: str) -> str:
    """Format one feature as a ``## Title`` markdown section.

    The returned string always starts with a newline so callers can safely
    concatenate it onto any existing file content without worrying about
    whether a trailing newline is present.

    Args:
        title: Feature heading (must not be empty; leading '#' are stripped).
        description: Feature plan text. Empty string is allowed.

    Returns:
        A string of the form newline + ## title + newline + description + newline,
        or newline + ## title + newline when description is empty.
    """
    title = _validate_title(title)
    description = description.strip()
    if description:
        return f"\n## {title}\n\n{description}\n"
    return f"\n## {title}\n"


def append_feature_to_file(path: Path, title: str, description: str) -> None:
    """Append one feature section to *path*, creating the file when absent.

    If the file does not exist it is created with a minimal ``# Features``
    document header so the result is a well-formed Markdown file. When the
    file already exists the block is appended; no attempt is made to
    de-duplicate.

    Args:
        path: Absolute path to the features file.
        title: Feature heading text.
        description: Feature plan / description body.
    """
    block = format_feature_block(title, description)
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        # Ensure exactly one blank line separates the new block from the
        # previous content (format_feature_block already starts with '\n').
        path.write_text(existing.rstrip("\n") + "\n" + block, encoding="utf-8")
    else:
        path.write_text("# Features" + block, encoding="utf-8")


class FeatureService:
    """Append feature entries to a project's features.md workspace file."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add_feature(self, project_id: str, title: str, description: str) -> Path:
        """Append a feature to the project's features.md file.

        Args:
            project_id: Registered project identifier.
            title: Feature heading (non-empty).
            description: Feature plan text (may be empty).

        Returns:
            The absolute ``Path`` of the features file that was written.

        Raises:
            ValueError: When the project is not found, has no workspace path,
                the workspace directory does not exist, or the title is empty.
        """
        row = await ProjectService(self._session).get(project_id)
        if not row.workspace_path:
            raise ValueError(f"Project '{project_id}' has no workspace path configured")
        workspace = Path(row.workspace_path)
        if not workspace.exists():
            raise ValueError(f"Workspace '{workspace}' does not exist")
        path = features_file_path(str(workspace))
        append_feature_to_file(path, title, description)
        logger.info(
            "Feature appended => project_id=%s title=%r path=%s",
            project_id,
            title,
            path,
        )
        return path
