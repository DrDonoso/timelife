"""The backup archive (``GET /api/admin/backup/export``, read back by the import).

A ZIP holding ``manifest.json`` (format ``timelife-backup``, ``VERSION``), a short ``README.txt``
and the original file of every photo, video and Live Photo clip, in folders people can browse::

    manifest.json
    README.txt
    events/2025/2025-03-01 Primeros pasos/IMG_1234.HEIC   (+ IMG_1234.MOV, a Live Photo's clip)
    trash/2024/2024-05-01 Primer diente/photo.jpg          (events in the trash)
    children/emma/avatar.jpg
    appearance/background.jpg

The manifest describes users, categories, children, events (with their images), year colours and
settings without database specifics: categories and children keep their ``id`` (a "replace"
import keeps them too; events reference them by it), users are named by e-mail. Media entries name
their archive path, which is only ever looked up in the archive's directory, never used as a path
on disk. Thumbnails, display copies and converted videos are not exported: an import makes them
again from the originals, through the upload pipeline."""

import datetime as dt
import json
import re
import unicodedata
import zipfile
from collections.abc import Iterable, Iterator
from typing import Annotated, Any, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    ValidationError,
    model_validator,
)

from .contracts import (
    ICON_PATTERN,
    SLUG_PATTERN,
    BackupSummaryOut,
    Direction,
    HexColor,
    ImageCrop,
    MediaKind,
    Role,
    Zoom,
)
from .errors import AppError

FORMAT = "timelife-backup"
# 2: children's line colour and categories' Portuguese names (copies of version 1 still import).
VERSION = 2
MANIFEST_NAME = "manifest.json"
README_NAME = "README.txt"
# An import is uploaded in pieces of this size: below the request limit of proxies such as
# Cloudflare (100 MB).
IMPORT_CHUNK_BYTES = 32 * 1024 * 1024
# Folders of the archive.
EVENTS_FOLDER = "events"
TRASH_FOLDER = "trash"
CHILDREN_FOLDER = "children"
APPEARANCE_FOLDER = "appearance"
# Reading limits: a manifest of 100 000 events stays far below these.
MAX_MANIFEST_BYTES = 256 * 1024 * 1024
MAX_ENTRIES = 1_000_000
# Compression methods every ZIP tool writes; the import refuses the others (LZMA, bzip2…).
COMPRESSIONS = frozenset({zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED})
ENCRYPTED_FLAG = 0x1
# Archive path components: event folders and file names (without the extension).
FOLDER_LENGTH = 64
STEM_LENGTH = 80
FORBIDDEN = frozenset('<>:"/\\|?*')
WINDOWS_RESERVED = frozenset(
    {
        "con",
        "prn",
        "aux",
        "nul",
        *(f"com{number}" for number in range(1, 10)),
        *(f"lpt{number}" for number in range(1, 10)),
    }
)
EXTENSION = re.compile(r"[A-Za-z0-9]{1,10}")
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+$"


# Manifest -----------------------------------------------------------------------------------


def _single_line(value: str) -> str:
    value = " ".join(value.split())
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise ValueError("Control characters are not allowed")
    return value


def _multiline(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    if any(
        unicodedata.category(character) == "Cc" and character not in "\n\t" for character in value
    ):
        raise ValueError("Control characters are not allowed")
    return value


def _blank_to_none(value: object) -> object:
    return None if isinstance(value, str) and not value.strip() else value


def _lower(value: str) -> str:
    return value.lower()


def _archive_path(value: str) -> str:
    """A relative POSIX path inside the archive (no ``..``, no empty or absolute parts)."""
    parts = value.split("/")
    if (
        "\\" in value
        or any(part in {"", ".", ".."} for part in parts)
        or any(unicodedata.category(character) == "Cc" for character in value)
        or value in {MANIFEST_NAME, README_NAME}
    ):
        raise ValueError("Expected a file of the archive")
    return value


def _unique(values: list[Any]) -> list[Any]:
    if len(set(values)) != len(values):
        raise ValueError("Items must be unique")
    return values


def _utc(value: dt.datetime) -> dt.datetime:
    return value.replace(tzinfo=dt.UTC) if value.tzinfo is None else value.astimezone(dt.UTC)


Ref = Annotated[int, Field(ge=1, le=2_147_483_647)]
Line = Annotated[str, AfterValidator(_single_line)]
Email = Annotated[
    str, Field(min_length=3, max_length=254, pattern=EMAIL_PATTERN), AfterValidator(_lower)
]
ArchivePath = Annotated[str, Field(min_length=1, max_length=1024), AfterValidator(_archive_path)]
Timestamp = Annotated[dt.datetime, AfterValidator(_utc)]


class Entry(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class MediaEntry(Entry):
    """A photo, video or Live Photo (``motion``: its clip) and how it is shown."""

    file: ArchivePath
    motion: ArchivePath | None = None
    kind: MediaKind = "image"
    name: Annotated[Line, Field(min_length=1, max_length=160)]
    original_filename: Annotated[str, Field(min_length=1, max_length=255)]
    crop: ImageCrop | None = None
    live: bool = False
    uploaded_by: Email | None = None
    created_at: Timestamp | None = None

    def paths(self) -> list[str]:
        return [self.file] if self.motion is None else [self.file, self.motion]


class UserEntry(Entry):
    email: Email
    name: Annotated[
        Annotated[Line, Field(min_length=1, max_length=120)] | None,
        BeforeValidator(_blank_to_none),
    ] = None
    role: Role
    disabled: bool = False
    invited_by: Email | None = None
    created_at: Timestamp | None = None
    last_login_at: Timestamp | None = None


class CategoryEntry(Entry):
    id: Ref
    key: Annotated[str, Field(min_length=1, max_length=64)] | None = None
    name_es: Annotated[Line, Field(min_length=1, max_length=60)]
    name_en: Annotated[Line, Field(min_length=1, max_length=60)]
    # Since format 2. An import of an older copy translates the default categories still called as
    # when they were created and uses the Spanish name of the others (``backup_import``).
    name_pt: Annotated[Line, Field(min_length=1, max_length=60)] | None = None
    icon: Annotated[str, Field(pattern=ICON_PATTERN)]
    color: HexColor
    sort_order: int = 0
    created_at: Timestamp | None = None
    updated_at: Timestamp | None = None


class ChildEntry(Entry):
    id: Ref
    name: Annotated[Line, Field(min_length=1, max_length=80)]
    slug: Annotated[str, Field(max_length=80, pattern=SLUG_PATTERN)]
    birth_date: dt.date | None = None
    # Own line colour on the family timeline (since format 2); null = automatic.
    color: HexColor | None = None
    sort_order: int = 0
    avatar: MediaEntry | None = None
    created_at: Timestamp | None = None
    updated_at: Timestamp | None = None


class EventEntry(Entry):
    id: Ref
    title: Annotated[Line, Field(min_length=1, max_length=120)]
    date: dt.date
    day_order: int = 0
    notes: Annotated[str, Field(max_length=5000), AfterValidator(_multiline)] = ""
    location: Annotated[
        Annotated[Line, Field(max_length=200)] | None, BeforeValidator(_blank_to_none)
    ] = None
    child_ids: Annotated[list[Ref], Field(min_length=1, max_length=20), AfterValidator(_unique)]
    category_ids: Annotated[list[Ref], Field(min_length=1, max_length=20), AfterValidator(_unique)]
    images: Annotated[list[MediaEntry], Field(max_length=50)] = []
    # Index of the cover in ``images``; null = the first one.
    cover: Annotated[int, Field(ge=0)] | None = None
    version: Ref = 1
    created_at: Timestamp | None = None
    updated_at: Timestamp | None = None
    deleted_at: Timestamp | None = None
    created_by: Email | None = None
    updated_by: Email | None = None
    deleted_by: Email | None = None

    @model_validator(mode="after")
    def cover_in_images(self) -> Self:
        if self.cover is not None and self.cover >= len(self.images):
            raise ValueError("The cover must be one of the images")
        return self


class YearColorEntry(Entry):
    year: Annotated[int, Field(ge=1900, le=2200)]
    color: HexColor


class SettingsEntry(Entry):
    background: MediaEntry | None = None
    background_opacity: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)] | None = None
    default_zoom: Zoom | None = None
    direction_desktop: Direction | None = None
    direction_mobile: Direction | None = None
    # Default categories ever created (``seed.SEEDED_CATEGORIES_KEY``).
    seeded_categories: list[Annotated[str, Field(min_length=1, max_length=64)]] = []


class Manifest(Entry):
    format: Literal["timelife-backup"]
    version: Annotated[int, Field(ge=1, le=VERSION, strict=True)]
    exported_at: Timestamp
    app_version: Annotated[str, Field(max_length=64)] = ""
    users: list[UserEntry] = []
    categories: list[CategoryEntry] = []
    children: list[ChildEntry] = []
    events: list[EventEntry] = []
    year_colors: list[YearColorEntry] = []
    settings: SettingsEntry = SettingsEntry()

    @model_validator(mode="after")
    def consistent(self) -> Self:
        """Unique identities, events referencing listed children and categories, and every
        archive file used once."""
        _unique([user.email for user in self.users])
        _unique([category.id for category in self.categories])
        _unique([category.key for category in self.categories if category.key])
        _unique([child.id for child in self.children])
        _unique([child.slug for child in self.children])
        _unique([event.id for event in self.events])
        _unique([color.year for color in self.year_colors])
        children = {child.id for child in self.children}
        categories = {category.id for category in self.categories}
        for event in self.events:
            if not set(event.child_ids) <= children or not set(event.category_ids) <= categories:
                raise ValueError("An event references a child or category that is not listed")
        _unique([path for media in self.media() for path in media.paths()])
        return self

    def media(self) -> Iterator[MediaEntry]:
        """Every photo and video: event images, avatars and the background."""
        for event in self.events:
            yield from event.images
        for child in self.children:
            if child.avatar is not None:
                yield child.avatar
        if self.settings.background is not None:
            yield self.settings.background


def read_manifest(archive: zipfile.ZipFile) -> Manifest:
    """The validated manifest of an archive: 422 ``invalid_import`` (not a Timelife backup, or a
    damaged one) or ``import_version_unsupported`` (made by a newer Timelife)."""
    try:
        info = archive.getinfo(MANIFEST_NAME)
    except KeyError:
        raise AppError("invalid_import") from None
    if (
        info.file_size > MAX_MANIFEST_BYTES
        or info.compress_type not in COMPRESSIONS
        or info.flag_bits & ENCRYPTED_FLAG
    ):
        raise AppError("invalid_import")
    try:
        with archive.open(info) as handle:
            raw = json.loads(handle.read(MAX_MANIFEST_BYTES + 1))
    except (zipfile.BadZipFile, OSError, EOFError, ValueError, RecursionError):
        raise AppError("invalid_import") from None
    if not isinstance(raw, dict) or raw.get("format") != FORMAT:
        raise AppError("invalid_import")
    version = raw.get("version")
    if isinstance(version, int) and not isinstance(version, bool) and version > VERSION:
        raise AppError("import_version_unsupported")
    try:
        return Manifest.model_validate(raw)
    except ValidationError as error:
        errors = error.errors()
        location = ".".join(str(part) for part in errors[0]["loc"]) if errors else ""
        raise AppError("invalid_import", detail={"location": location[:200]}) from None


def usable_entry(info: zipfile.ZipInfo) -> bool:
    """A file entry the import can read (no folder, nothing encrypted or oddly compressed)."""
    return (
        not info.is_dir()
        and info.compress_type in COMPRESSIONS
        and not info.flag_bits & ENCRYPTED_FLAG
    )


def summarize(manifest: Manifest, sizes: dict[str, int]) -> tuple[BackupSummaryOut, int]:
    """What an archive holds, and how many of the files its manifest names it lacks
    (``sizes``: size of every usable file entry, by name)."""
    photos = live = videos = 0
    for event in manifest.events:
        for image in event.images:
            if image.kind == "video":
                videos += 1
            else:
                photos += 1
                live += image.motion is not None
    paths = [path for media in manifest.media() for path in media.paths()]
    summary = BackupSummaryOut(
        events=sum(event.deleted_at is None for event in manifest.events),
        trashed_events=sum(event.deleted_at is not None for event in manifest.events),
        photos=photos,
        live_photos=live,
        videos=videos,
        children=len(manifest.children),
        categories=len(manifest.categories),
        users=len(manifest.users),
        admins=sum(user.role == "admin" for user in manifest.users),
        year_colors=len(manifest.year_colors),
        background=manifest.settings.background is not None,
        media_bytes=sum(sizes.get(path, 0) for path in paths),
    )
    return summary, sum(path not in sizes for path in paths)


# Archive paths ------------------------------------------------------------------------------


def component(value: str, fallback: str, limit: int) -> str:
    """``value`` as one archive path component every file system accepts: no forbidden or
    invisible characters, no leading or trailing dots and spaces, no Windows device names, at
    most ``limit`` characters; ``fallback`` when nothing is left."""
    characters = (
        " "
        if character in FORBIDDEN or unicodedata.category(character) in {"Cc", "Cf", "Cs"}
        else character
        for character in unicodedata.normalize("NFC", value)
    )
    text = " ".join("".join(characters).split()).strip(" .")
    text = text[:limit].rstrip(" .") or fallback
    if text.split(".")[0].casefold() in WINDOWS_RESERVED:
        text = f"_{text}"
    return text


def split_name(filename: str, extension: str) -> tuple[str, str]:
    """Stem and extension of an exported file: the original name with the stored file's
    extension (kept as the name spells it when it is the same one)."""
    name = filename.rsplit("/", 1)[-1]
    stem, dot, suffix = name.rpartition(".")
    if not (dot and stem.strip() and EXTENSION.fullmatch(suffix)):
        stem, suffix = name, ""
    if suffix.casefold() != extension.casefold():
        suffix = extension
    return stem, suffix


class Layout:
    """Unique, browsable archive paths (compared without case, as Windows and macOS do)."""

    def __init__(self) -> None:
        self.taken = {MANIFEST_NAME.casefold(), README_NAME.casefold()}

    def claim(self, base: str, suffix: str = "") -> str:
        """``base + suffix``, else ``base (2) + suffix``, ``base (3) + suffix``…"""
        path, number = base + suffix, 1
        while path.casefold() in self.taken:
            number += 1
            path = f"{base} ({number}){suffix}"
        self.taken.add(path.casefold())
        return path

    def event_folder(self, title: str, date: dt.date, trashed: bool) -> str:
        root = TRASH_FOLDER if trashed else EVENTS_FOLDER
        name = component(f"{date.isoformat()} {title}", date.isoformat(), FOLDER_LENGTH)
        return self.claim(f"{root}/{date.year:04d}/{name}")

    def child_folder(self, slug: str) -> str:
        return self.claim(f"{CHILDREN_FOLDER}/{component(slug, 'child', FOLDER_LENGTH)}")

    @staticmethod
    def appearance_folder() -> str:
        return APPEARANCE_FOLDER

    def file(self, folder: str, filename: str, extension: str) -> str:
        stem, suffix = split_name(filename, extension)
        stem = component(stem, "image", STEM_LENGTH)
        return self.claim(f"{folder}/{stem}", f".{suffix}" if suffix else "")

    def companion(self, path: str, extension: str) -> str:
        """Path of a Live Photo's clip next to its photo: the same name, its own extension."""
        stem = path.rpartition(".")[0] or path
        return self.claim(stem, f".{extension}")


def readme(exported_at: dt.datetime, counts: Iterable[tuple[str, int]]) -> str:
    """The archive's ``README.txt`` (Spanish, then English)."""
    stamp = exported_at.strftime("%Y-%m-%d %H:%M UTC")
    lines = ", ".join(f"{name}: {count}" for name, count in counts)
    return (
        f"Copia de seguridad de Timelife ({stamp})\n"
        "==========================================\n\n"
        "Para restaurarla: Administración → Importar y exportar → Importar, y elige este archivo.\n"
        "Las fotos y vídeos originales están en events/<año>/<fecha> <título>/ (los de la\n"
        "papelera en trash/), los avatares en children/ y el fondo en appearance/. manifest.json\n"
        "describe todo lo demás. No cambies ni renombres nada si quieres volver a importarlo.\n\n"
        f"Timelife backup ({stamp})\n"
        "========================\n\n"
        "To restore it: Administration → Import & export → Import, and choose this file.\n"
        "The original photos and videos are in events/<year>/<date> <title>/ (trashed events in\n"
        "trash/), avatars in children/ and the background in appearance/. manifest.json describes\n"
        "everything else. Do not change or rename anything if you want to import it again.\n\n"
        f"{lines}\n"
    )
