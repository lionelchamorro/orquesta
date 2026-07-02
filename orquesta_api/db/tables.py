"""SQLAlchemy ORM table definitions."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class ProjectRow(Base):
    """Persistent registry record for a project."""

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    repo_url: Mapped[str | None] = mapped_column(String)
    workspace_path: Mapped[str | None] = mapped_column(String)
    base_branch: Mapped[str] = mapped_column(String, default="main")
    watch_prs: Mapped[bool] = mapped_column(Boolean, default=False)
    watch_issues: Mapped[bool] = mapped_column(Boolean, default=False)
    state: Mapped[str] = mapped_column(String, default="idle")
    description: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str | None] = mapped_column(String)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    last_run: Mapped[datetime | None] = mapped_column(DateTime)
    source: Mapped[str | None] = mapped_column(String)
    serve_port: Mapped[int | None] = mapped_column(Integer)


class RunRow(Base):
    """Persistent record for a single orq-lite run."""

    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, ForeignKey("projects.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    state: Mapped[str] = mapped_column(String, nullable=False)
    executor: Mapped[str] = mapped_column(String, nullable=False)
    container_id: Mapped[str | None] = mapped_column(String)
    pid: Mapped[int | None] = mapped_column(Integer)
    api_port: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    exit_code: Mapped[int | None] = mapped_column(Integer)
    base_sha: Mapped[str | None] = mapped_column(String)
    head_sha: Mapped[str | None] = mapped_column(String)
    error: Mapped[str | None] = mapped_column(Text)


class RepoRow(Base):
    """Persistent record for a project's local repository state."""

    __tablename__ = "repos"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_id: Mapped[str] = mapped_column(String, ForeignKey("projects.id"), nullable=False)
    root: Mapped[str] = mapped_column(String, nullable=False)
    remote_url: Mapped[str | None] = mapped_column(String)
    base_branch: Mapped[str] = mapped_column(String, default="main")
    head_sha: Mapped[str | None] = mapped_column(String)
    current_branch: Mapped[str | None] = mapped_column(String)
    dirty: Mapped[bool] = mapped_column(Boolean, default=False)
    managed: Mapped[bool] = mapped_column(Boolean, default=False)


class EventCursorRow(Base):
    """Tracks the last consumed event offset for a run, enabling SSE resume."""

    __tablename__ = "event_cursors"

    run_id: Mapped[str] = mapped_column(String, ForeignKey("runs.id"), primary_key=True)
    offset: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ConversationRow(Base):
    """A chat thread. Single-user v1: one implicit conversation is reused."""

    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class ChatMessageRow(Base):
    """A single message (user, assistant, or tool-result) within a conversation."""

    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String, ForeignKey("conversations.id"), nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    project: Mapped[str | None] = mapped_column(String)
    action: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
