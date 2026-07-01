"""SQLAlchemy async engine, session factory, and FastAPI dependency."""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from orquesta_api.config import settings
from orquesta_api.db.tables import Base  # noqa: F401

engine = create_async_engine(settings.database_url, echo=False)

SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield an AsyncSession; intended as a FastAPI dependency."""
    async with SessionLocal() as session:
        yield session
