import sqlite3
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect
from sqlalchemy.engine import Connection

from timelife.db import Base, create_db_engine
from timelife.seed import CATEGORIES

from .conftest import migrate, sqlite_url

TABLES = {
    "users",
    "user_sessions",
    "google_auth_flows",
    "auth_limits",
    "password_resets",
    "categories",
    "events",
    "images",
    "children",
    "event_children",
    "event_categories",
    "year_colors",
    "app_settings",
}


async def inspect_database(url: str) -> tuple[set[str], list[object]]:
    def check(connection: Connection) -> tuple[set[str], list[object]]:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        tables = set(inspect(connection).get_table_names()) - {"alembic_version", "sqlite_sequence"}
        return tables, list(compare_metadata(context, Base.metadata))

    engine = create_db_engine(url)
    try:
        async with engine.connect() as connection:
            return await connection.run_sync(check)
    finally:
        await engine.dispose()


async def test_migrations_match_the_models(database_url: str) -> None:
    tables, differences = await inspect_database(database_url)
    assert tables == TABLES
    assert differences == []


async def test_downgrade_and_upgrade_round_trip(database_url: str) -> None:
    migrate(database_url, "base", command="downgrade")
    tables, _ = await inspect_database(database_url)
    assert tables == set()
    migrate(database_url)
    tables, differences = await inspect_database(database_url)
    assert tables == TABLES
    assert differences == []


def sqlite_events(path: Path, *statements: str) -> tuple[str, list[tuple[int, int | None, str]]]:
    """Run ``statements`` on the SQLite file, then return the events table's DDL and rows."""
    connection = sqlite3.connect(path)
    try:
        for statement in statements:
            connection.execute(statement)
        connection.commit()
        (ddl,) = connection.execute("SELECT sql FROM sqlite_master WHERE name = 'events'").fetchone()
        columns = {row[1] for row in connection.execute("PRAGMA table_info(events)")}
        order = "day_order, typeof(day_order)" if "day_order" in columns else "NULL, 'null'"
        rows = connection.execute(f"SELECT id, {order} FROM events ORDER BY id").fetchall()
        return ddl, rows
    finally:
        connection.close()


INSERT_EVENT = (
    "INSERT INTO events (title, title_search, date, notes, version, created_at, updated_at)"
    " VALUES ('{0}', '{0}', '2024-05-01', '', 1, '2024-05-01 10:00:00', '2024-05-01 10:00:00')"
)


def test_sqlite_day_order_migration_keeps_events_and_autoincrement(tmp_path: Path) -> None:
    # Ids are never handed out twice (old links would open another milestone): 0002 adds the
    # column in place, and its rollback keeps AUTOINCREMENT and the counter of the rebuilt table.
    path = tmp_path / "upgrade.db"
    migrate(sqlite_url(path), "0001")
    sqlite_events(
        path, *(INSERT_EVENT.format(title) for title in ("uno", "dos", "tres")), "DELETE FROM events WHERE id = 3"
    )

    migrate(sqlite_url(path))
    ddl, rows = sqlite_events(path, INSERT_EVENT.format("cuatro"))
    assert "AUTOINCREMENT" in ddl
    assert rows == [(1, 0, "integer"), (2, 0, "integer"), (4, 0, "integer")]

    # The newest event is purged, then the migration rolled back.
    sqlite_events(path, "DELETE FROM events WHERE id = 4")
    migrate(sqlite_url(path), "0001", command="downgrade")
    ddl, rows = sqlite_events(path, INSERT_EVENT.format("cinco"))
    assert "AUTOINCREMENT" in ddl
    assert [row[0] for row in rows] == [1, 2, 5]


def test_sqlite_video_migration_keeps_photos_and_their_links(tmp_path: Path) -> None:
    # 0004 rebuilds the images table on SQLite (new CHECK constraints): existing photos stay
    # plain photos, and the children's avatars keep pointing at them.
    path = tmp_path / "videos.db"
    migrate(sqlite_url(path), "0003")
    image_id = "0123456789abcdef0123456789abcdef"
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            "INSERT INTO images (id, purpose, name, original_filename, original_ext, content_type,"
            " byte_size, width, height, dominant_color, position, created_at) VALUES"
            f" ('{image_id}', 'avatar', 'Lucía', 'lucia.jpg', 'jpg', 'image/jpeg', 10, 4, 3,"
            " '#336699', 0, '2025-01-01 10:00:00')"
        )
        connection.execute(
            "INSERT INTO children (name, slug, avatar_image_id, sort_order, created_at,"
            f" updated_at) VALUES ('Lucía', 'lucia', '{image_id}', 0, '2025-01-01 10:00:00',"
            " '2025-01-01 10:00:00')"
        )
        connection.commit()
    finally:
        connection.close()

    def snapshot() -> tuple[str, list[Any], list[Any], set[str]]:
        connection = sqlite3.connect(path)
        try:
            (ddl,) = connection.execute(
                "SELECT sql FROM sqlite_master WHERE name = 'images'"
            ).fetchone()
            columns = [row[1] for row in connection.execute("PRAGMA table_info(images)")]
            rows = connection.execute(f"SELECT {', '.join(columns)} FROM images").fetchall()
            avatars = connection.execute("SELECT avatar_image_id FROM children").fetchall()
            indexes = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE tbl_name = 'images' AND type = 'index'"
                )
            }
            return ddl, [dict(zip(columns, row, strict=True)) for row in rows], avatars, indexes
        finally:
            connection.close()

    migrate(sqlite_url(path))
    ddl, rows, avatars, indexes = snapshot()
    for constraint in ("ck_images_purpose", "ck_images_kind", "ck_images_video_status"):
        assert constraint in ddl
    assert "byte_size BIGINT" in ddl
    assert "fk_images_event_id_events" in ddl and "ON DELETE CASCADE" in ddl
    assert {"ix_images_event_id", "ix_images_expires_at"} <= indexes
    assert [(row["id"], row["kind"], row["video_status"], row["duration"], row["live"])
            for row in rows] == [(image_id, "image", None, None, 0)]
    assert avatars == [(image_id,)]

    migrate(sqlite_url(path), "0003", command="downgrade")
    ddl, rows, avatars, indexes = snapshot()
    assert "ck_images_purpose" in ddl and "ck_images_kind" not in ddl
    assert "byte_size INTEGER" in ddl
    assert "kind" not in rows[0] and rows[0]["id"] == image_id
    assert avatars == [(image_id,)]
    assert {"ix_images_event_id", "ix_images_expires_at"} <= indexes

def sqlite_users(path: Path, *statements: str) -> tuple[str, list[tuple[Any, ...]], set[str]]:
    """Run ``statements`` on the SQLite file, then return the users table's DDL, its rows (id,
    email and the password columns when present) and the tables."""
    connection = sqlite3.connect(path)
    try:
        for statement in statements:
            connection.execute(statement)
        connection.commit()
        (ddl,) = connection.execute("SELECT sql FROM sqlite_master WHERE name = 'users'").fetchone()
        columns = {row[1] for row in connection.execute("PRAGMA table_info(users)")}
        extra = ", password_hash, must_change_password" if "password_hash" in columns else ""
        rows = connection.execute(f"SELECT id, email{extra} FROM users ORDER BY id").fetchall()
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        return ddl, rows, tables
    finally:
        connection.close()


INSERT_USER = (
    "INSERT INTO users (email, role, disabled, auth_version, created_at)"
    " VALUES ('{0}', 'viewer', 0, 1, '2025-01-01 10:00:00')"
)


def test_sqlite_password_migration_keeps_users_and_autoincrement(tmp_path: Path) -> None:
    # 0005 adds the password columns in place (existing users: no password, nothing to change);
    # its rollback rebuilds users keeping AUTOINCREMENT and the counter (no id is reused).
    path = tmp_path / "passwords.db"
    migrate(sqlite_url(path), "0004")
    sqlite_users(
        path, *(INSERT_USER.format(email) for email in ("ana@x.es", "luis@x.es", "eva@x.es")),
        "DELETE FROM users WHERE id = 3",
    )

    migrate(sqlite_url(path))
    ddl, rows, tables = sqlite_users(path, INSERT_USER.format("sol@x.es"))
    assert "AUTOINCREMENT" in ddl
    assert rows == [(1, "ana@x.es", None, 0), (2, "luis@x.es", None, 0), (4, "sol@x.es", None, 0)]
    assert "password_resets" in tables

    sqlite_users(path, "DELETE FROM users WHERE id = 4")
    migrate(sqlite_url(path), "0004", command="downgrade")
    ddl, rows, tables = sqlite_users(path, INSERT_USER.format("noa@x.es"))
    assert "AUTOINCREMENT" in ddl and "password_hash" not in ddl
    assert rows == [(1, "ana@x.es"), (2, "luis@x.es"), (5, "noa@x.es")]
    assert "password_resets" not in tables


def sqlite_run(path: Path, *statements: str | tuple[str, Sequence[Any]]) -> None:
    """Run ``statements`` (SQL, or SQL and its parameters) on the SQLite file and commit."""
    connection = sqlite3.connect(path)
    try:
        for statement in statements:
            sql, parameters = (statement, ()) if isinstance(statement, str) else statement
            connection.execute(sql, parameters)
        connection.commit()
    finally:
        connection.close()


def sqlite_table(
    path: Path, table: str, columns: Sequence[str]
) -> tuple[str, list[tuple[Any, ...]]]:
    """``table``'s DDL and its rows by id, with the ones of ``columns`` it has."""
    connection = sqlite3.connect(path)
    try:
        (ddl,) = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
        ).fetchone()
        present = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
        selected = ", ".join(f'"{column}"' for column in columns if column in present)
        rows = connection.execute(f"SELECT {selected} FROM {table} ORDER BY id").fetchall()
        return ddl, rows
    finally:
        connection.close()


def sqlite_links(path: Path) -> tuple[list[Any], list[Any], list[Any]]:
    """The events' links to children and categories, and every foreign key violation."""
    connection = sqlite3.connect(path)
    try:
        return (
            connection.execute("SELECT event_id, child_id FROM event_children").fetchall(),
            connection.execute(
                "SELECT event_id, category_id, position FROM event_categories ORDER BY position"
            ).fetchall(),
            connection.execute("PRAGMA foreign_key_check").fetchall(),
        )
    finally:
        connection.close()


STAMPS = "'2025-01-01 10:00:00', '2025-01-01 10:00:00'"
INSERT_CATEGORY = (
    'INSERT INTO categories ("key", name_es, name_en, icon, color, sort_order, created_at,'
    f" updated_at) VALUES (?, ?, ?, 'star', '#64748b', 0, {STAMPS})"
)
INSERT_TRANSLATED_CATEGORY = (
    'INSERT INTO categories ("key", name_es, name_en, name_pt, icon, color, sort_order,'
    f" created_at, updated_at) VALUES (?, ?, ?, ?, 'star', '#64748b', 0, {STAMPS})"
)
INSERT_CHILD = (
    "INSERT INTO children (name, slug, sort_order, created_at, updated_at)"
    f" VALUES ('{{0}}', '{{0}}', 0, {STAMPS})"
)
CATEGORY_COLUMNS = (
    "id", "key", "name_es", "name_en", "icon", "color", "sort_order", "created_at", "updated_at"
)
CHILD_COLUMNS = (
    "id", "name", "slug", "birth_date", "avatar_image_id", "sort_order", "created_at", "updated_at"
)


def test_sqlite_portuguese_migration_names_categories_and_keeps_ids(tmp_path: Path) -> None:
    # 0006 adds children.color in place, and categories.name_pt: the translation for default
    # categories still called as when they were created, the Spanish name for any other one.
    # SQLite rebuilds categories to make it NOT NULL, keeping AUTOINCREMENT, the counter and the
    # events' links; the rollback rebuilds both tables the same way.
    path = tmp_path / "portuguese.db"
    migrate(sqlite_url(path), "0005")
    spanish = {item.key: item.name_es for item in CATEGORIES} | {"sleep": "Dormir"}
    sqlite_run(
        path,
        *((INSERT_CATEGORY, (item.key, spanish[item.key], item.name_en)) for item in CATEGORIES),
        (INSERT_CATEGORY, (None, "Viajes", "Trips")),
        # Called like a default category, without being one.
        (INSERT_CATEGORY, (None, "Sueño", "Naps")),
        (INSERT_CATEGORY, (None, "Borrada", "Deleted")),
        "DELETE FROM categories WHERE id = 14",
        *(INSERT_CHILD.format(name) for name in ("lucia", "pablo", "marta")),
        "DELETE FROM children WHERE id = 3",
        INSERT_EVENT.format("uno"),
        "INSERT INTO event_children (event_id, child_id) VALUES (1, 2)",
        "INSERT INTO event_categories (event_id, category_id, position) VALUES (1, 12, 0)",
        "INSERT INTO event_categories (event_id, category_id, position) VALUES (1, 5, 1)",
    )
    _, categories = sqlite_table(path, "categories", CATEGORY_COLUMNS)
    _, children = sqlite_table(path, "children", CHILD_COLUMNS)
    links = ([(1, 2)], [(1, 12, 0), (1, 5, 1)], [])

    migrate(sqlite_url(path))
    ddl, rows = sqlite_table(path, "categories", (*CATEGORY_COLUMNS, "name_pt"))
    assert "AUTOINCREMENT" in ddl and "name_pt VARCHAR(60) NOT NULL" in ddl
    assert "CONSTRAINT uq_categories_key UNIQUE" in ddl
    assert [row[:-1] for row in rows] == categories
    portuguese = {item.key: item.name_pt for item in CATEGORIES} | {"sleep": "Dormir"}
    assert [row[-1] for row in rows] == [
        *(portuguese[item.key] for item in CATEGORIES),
        "Viajes",
        "Sueño",
    ]
    ddl, rows = sqlite_table(path, "children", (*CHILD_COLUMNS, "color"))
    assert "AUTOINCREMENT" in ddl and "color VARCHAR(7)" in ddl
    assert rows == [(*row, None) for row in children]
    assert sqlite_links(path) == links
    # No id is handed out twice, and every category needs its Portuguese name now.
    sqlite_run(
        path,
        (INSERT_TRANSLATED_CATEGORY, (None, "Nueva", "New", "Nova")),
        INSERT_CHILD.format("noa"),
    )
    with pytest.raises(sqlite3.IntegrityError, match="name_pt"):
        sqlite_run(path, (INSERT_CATEGORY, (None, "Sin traducir", "Untranslated")))
    assert sqlite_table(path, "categories", ("id", "name_pt"))[1][-1] == (15, "Nova")
    assert sqlite_table(path, "children", ("id", "slug"))[1][-1] == (4, "noa")

    # The newest rows are deleted, then the migration rolled back.
    sqlite_run(path, "DELETE FROM categories WHERE id = 15", "DELETE FROM children WHERE id = 4")
    migrate(sqlite_url(path), "0005", command="downgrade")
    sqlite_run(path, (INSERT_CATEGORY, (None, "Otra", "Other")), INSERT_CHILD.format("eva"))
    ddl, rows = sqlite_table(path, "categories", (*CATEGORY_COLUMNS, "name_pt"))
    assert "AUTOINCREMENT" in ddl and "name_pt" not in ddl
    assert rows[:-1] == categories and rows[-1][:3] == (16, None, "Otra")
    ddl, rows = sqlite_table(path, "children", (*CHILD_COLUMNS, "color"))
    assert "AUTOINCREMENT" in ddl and "color" not in ddl
    assert "CONSTRAINT uq_children_slug UNIQUE" in ddl
    assert rows[:-1] == children and rows[-1][:3] == (5, "eva", "eva")
    assert sqlite_links(path) == links