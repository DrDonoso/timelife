"""Idempotent seed: the default categories.

Run with ``python -m timelife.seed`` (after ``alembic upgrade head``); tests call ``seed(db)``.
The first administrator is created from the login page (see ``setup``)."""

import asyncio
from typing import NamedTuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .config import Settings
from .db import AppSetting, Category, create_db_engine, utcnow

# app_settings key remembering which default categories were ever created, so categories that an
# admin deleted are not resurrected by the next container start.
SEEDED_CATEGORIES_KEY = "seeded_categories"


class SeedCategory(NamedTuple):
    key: str
    name_es: str
    name_en: str
    name_pt: str
    icon: str
    color: str


CATEGORIES: tuple[SeedCategory, ...] = (
    SeedCategory("general", "General", "General", "Geral", "star", "#64748b"),
    SeedCategory("academic", "Académico", "Academic", "Académico", "school", "#4f46e5"),
    SeedCategory("teething", "Dentición", "Teething", "Dentição", "dental", "#14b8a6"),
    SeedCategory(
        "language", "Lenguaje y comunicación", "Language & communication",
        "Linguagem e comunicação", "message-circle", "#f59e0b",
    ),
    SeedCategory("sleep", "Sueño", "Sleep", "Sono", "moon", "#8b5cf6"),
    SeedCategory(
        "gross-motor", "Motricidad gruesa", "Gross motor skills", "Motricidade global", "walk",
        "#ef4444",
    ),
    SeedCategory(
        "fine-motor", "Motricidad fina", "Fine motor skills", "Motricidade fina", "hand-finger",
        "#f97316",
    ),
    SeedCategory(
        "cognitive", "Desarrollo cognitivo", "Cognitive development",
        "Desenvolvimento cognitivo", "brain", "#3b82f6",
    ),
    SeedCategory(
        "social-emotional", "Desarrollo social y emocional", "Social & emotional development",
        "Desenvolvimento social e emocional", "heart-handshake", "#ec4899",
    ),
    SeedCategory("feeding", "Alimentación", "Feeding", "Alimentação", "baby-bottle", "#22c55e"),
    SeedCategory(
        "self-care", "Autonomía y cuidado personal", "Independence & self-care",
        "Autonomia e cuidados pessoais", "shirt", "#06b6d4",
    ),
)


async def seed_categories(db: AsyncSession) -> int:
    """Create default categories never seeded before (never touches existing rows); commits."""
    marker = await db.get(AppSetting, SEEDED_CATEGORIES_KEY)
    seeded: set[str] = set()
    if marker is not None and isinstance(marker.value, list):
        seeded = {str(key) for key in marker.value}
    existing = set(await db.scalars(select(Category.key).where(Category.key.is_not(None))))
    highest = await db.scalar(select(func.max(Category.sort_order)))
    sort_order = -1 if highest is None else highest
    now = utcnow()
    added = 0
    for item in CATEGORIES:
        if item.key in seeded or item.key in existing:
            continue
        sort_order += 1
        added += 1
        db.add(
            Category(
                key=item.key,
                name_es=item.name_es,
                name_en=item.name_en,
                name_pt=item.name_pt,
                icon=item.icon,
                color=item.color,
                sort_order=sort_order,
                created_at=now,
                updated_at=now,
            )
        )
    keys = sorted(seeded | {item.key for item in CATEGORIES})
    if marker is None:
        db.add(AppSetting(key=SEEDED_CATEGORIES_KEY, value=keys, updated_at=now))
    elif marker.value != keys:
        marker.value = keys
        marker.updated_at = now
    await db.commit()
    return added


async def seed(db: AsyncSession) -> None:
    await seed_categories(db)


async def main() -> None:
    config = Settings()
    engine = create_db_engine(config.database_url)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            await seed(db)
    finally:
        await engine.dispose()
    print("Timelife seed complete")


if __name__ == "__main__":
    asyncio.run(main())
