import asyncio
import os
from logging.config import fileConfig
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Connection

from alembic import context
from timelife.config import Settings
from timelife.db import Base, create_db_engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)


def database_url() -> str:
    """``DATABASE_URL`` from the environment, else the application settings (``.env``)."""
    url = os.environ.get("DATABASE_URL", "").strip()
    return url or Settings().database_url


def run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        render_as_batch=connection.dialect.name == "sqlite",
        transactional_ddl=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run() -> None:
    # Foreign keys stay off on SQLite: batch migrations recreate tables.
    engine = create_db_engine(database_url(), foreign_keys=False)
    if engine.dialect.name == "sqlite":
        # Let SQLAlchemy own the transaction so every migration (DDL included) is atomic.
        @event.listens_for(engine.sync_engine, "connect")
        def sqlite_connect(connection: Any, record: Any) -> None:
            connection.isolation_level = None

        @event.listens_for(engine.sync_engine, "begin")
        def sqlite_begin(connection: Connection) -> None:
            connection.exec_driver_sql("BEGIN")

    try:
        async with engine.connect() as connection:
            await connection.run_sync(run_migrations)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline (--sql) migrations are not supported; run against a database.")
asyncio.run(run())
