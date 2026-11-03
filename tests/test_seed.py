import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from timelife.config import Settings
from timelife.db import AppSetting, Category, User
from timelife.seed import SEEDED_CATEGORIES_KEY, seed

from .conftest import TEST_ORIGIN

# Spec 10-backend, in order: key, name_es, name_en, name_pt (pt-PT), icon, color.
EXPECTED_CATEGORIES = [
    ("general", "General", "General", "Geral", "star", "#64748b"),
    ("academic", "Académico", "Academic", "Académico", "school", "#4f46e5"),
    ("teething", "Dentición", "Teething", "Dentição", "dental", "#14b8a6"),
    (
        "language",
        "Lenguaje y comunicación",
        "Language & communication",
        "Linguagem e comunicação",
        "message-circle",
        "#f59e0b",
    ),
    ("sleep", "Sueño", "Sleep", "Sono", "moon", "#8b5cf6"),
    (
        "gross-motor",
        "Motricidad gruesa",
        "Gross motor skills",
        "Motricidade global",
        "walk",
        "#ef4444",
    ),
    (
        "fine-motor",
        "Motricidad fina",
        "Fine motor skills",
        "Motricidade fina",
        "hand-finger",
        "#f97316",
    ),
    (
        "cognitive",
        "Desarrollo cognitivo",
        "Cognitive development",
        "Desenvolvimento cognitivo",
        "brain",
        "#3b82f6",
    ),
    (
        "social-emotional",
        "Desarrollo social y emocional",
        "Social & emotional development",
        "Desenvolvimento social e emocional",
        "heart-handshake",
        "#ec4899",
    ),
    ("feeding", "Alimentación", "Feeding", "Alimentação", "baby-bottle", "#22c55e"),
    (
        "self-care",
        "Autonomía y cuidado personal",
        "Independence & self-care",
        "Autonomia e cuidados pessoais",
        "shirt",
        "#06b6d4",
    ),
]

Sessions = async_sessionmaker[AsyncSession]


async def categories(db: AsyncSession) -> list[Category]:
    return list(await db.scalars(select(Category).order_by(Category.sort_order, Category.id)))


async def test_seed_creates_the_default_categories(sessions: Sessions) -> None:
    async with sessions() as db:
        rows = await categories(db)
    assert [
        (c.key, c.name_es, c.name_en, c.name_pt, c.icon, c.color, c.sort_order) for c in rows
    ] == [(*item, index) for index, item in enumerate(EXPECTED_CATEGORIES)]


async def test_seed_is_idempotent_and_never_overrides_admin_changes(sessions: Sessions) -> None:
    async with sessions() as db:
        await seed(db)
        await seed(db)
        assert await db.scalar(select(func.count()).select_from(Category)) == 11

        sleep = await db.scalar(select(Category).where(Category.key == "sleep"))
        teething = await db.scalar(select(Category).where(Category.key == "teething"))
        assert sleep is not None and teething is not None
        sleep.name_es, sleep.name_pt, sleep.color = "Dormir", "Dormir bem", "#000000"
        await db.delete(teething)
        await db.commit()

        await seed(db)
        keys = [category.key for category in await categories(db)]
        assert "teething" not in keys
        assert len(keys) == 10
        await db.refresh(sleep)
        assert (sleep.name_es, sleep.name_pt, sleep.color) == ("Dormir", "Dormir bem", "#000000")
        marker = await db.get(AppSetting, SEEDED_CATEGORIES_KEY)
        assert marker is not None
        assert marker.value == sorted(item[0] for item in EXPECTED_CATEGORIES)


async def test_new_default_categories_are_appended(sessions: Sessions) -> None:
    async with sessions() as db:
        # Simulate an install seeded before "self-care" existed.
        self_care = await db.scalar(select(Category).where(Category.key == "self-care"))
        marker = await db.get(AppSetting, SEEDED_CATEGORIES_KEY)
        assert self_care is not None and marker is not None
        await db.delete(self_care)
        marker.value = [key for key in marker.value if key != "self-care"]
        db.add(
            Category(
                name_es="Mía",
                name_en="Mine",
                name_pt="Minha",
                icon="star",
                color="#123456",
                sort_order=20,
            )
        )
        await db.commit()

        await seed(db)
        rows = await categories(db)
        assert [row.key for row in rows][-2:] == [None, "self-care"]
        assert rows[-1].sort_order == 21


async def test_seed_command_creates_the_categories_and_no_users(
    config: Settings, sessions: Sessions, tmp_path: Path
) -> None:
    # Run like the container entrypoint, outside the repository so no .env file is read. The
    # first administrator comes from the login page (``setup``), not from the seed.
    async with sessions() as db:
        await db.execute(delete(Category))
        await db.execute(delete(AppSetting))
        await db.commit()
    env = {
        name: value
        for name, value in os.environ.items()
        if name.lower() not in Settings.model_fields
    }
    env.update(
        DATABASE_URL=config.database_url,
        AUTH_SECRET=config.auth_secret.get_secret_value(),
        PUBLIC_ORIGIN=TEST_ORIGIN,
        AUTH_COOKIE_SECURE="false",
        ADMIN_EMAILS="ana@example.com",  # no longer used: ignored
        MEDIA_DIR=str(tmp_path / "media"),
    )
    result = subprocess.run(
        [sys.executable, "-m", "timelife.seed"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert "Timelife seed complete" in result.stdout
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(Category)) == 11
        assert await db.scalar(select(func.count()).select_from(User)) == 0
