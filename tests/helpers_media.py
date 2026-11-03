"""Image helpers for the tests of any module.

* ``image_bytes(format, size, color)``: an encoded image generated with Pillow.
* ``upload(client, purpose, ...)`` posts ``/api/admin/uploads`` (the client must be signed in as
  an administrator) and returns the response; ``uploaded(...)`` asserts 201 and returns the
  ``ImageOut`` JSON of the new pending image (its files really exist in ``media_dir``).
* ``image_row(purpose, ...)`` builds an ``Image`` row without files (pending unless
  ``expires_at=None``) and ``add_folder(media_dir, image_id)`` creates a dummy image folder, for
  tests that insert rows directly (``run_db`` or the ``sessions`` fixture).
* Videos: ``requires_ffmpeg`` skips a test without ffmpeg/ffprobe, ``clip(folder, name, *args)``
  encodes a file with ffmpeg (lavfi sources) and ``wait_for_videos(client)`` waits until the
  app's background conversions are done.
"""

import io
import shutil
import subprocess
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image as Pillow

from timelife.db import Image, utcnow

UNSET: Any = object()
# ``ImageOut`` fields of a plain photo (no video, no Live Photo clip).
PHOTO_FIELDS: dict[str, Any] = {
    "kind": "image",
    "video_status": None,
    "video_url": None,
    "duration": None,
    "live": False,
}
requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe are not installed",
)


def clip(folder: Path, name: str, *args: str) -> bytes:
    """Encode ``folder/name`` with ``ffmpeg -y <args> <path>`` and return its bytes."""
    path = folder / name
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", *args, str(path)],
        check=True,
        capture_output=True,
    )
    return path.read_bytes()


def wait_for_videos(client: TestClient) -> None:
    """Wait (in the app's event loop) until every queued video conversion is finished."""
    assert client.portal is not None
    app: Any = client.app
    client.portal.call(app.state.video_jobs.idle)


def image_bytes(
    image_format: str = "JPEG",
    size: tuple[int, int] = (64, 48),
    color: float | tuple[int, ...] | str = (200, 40, 40),
    *,
    mode: str = "RGB",
    **options: Any,
) -> bytes:
    """A ``size`` image of one ``color``, saved as ``image_format`` with ``options``."""
    buffer = io.BytesIO()
    Pillow.new(mode, size, color).save(buffer, image_format, **options)
    return buffer.getvalue()


def upload(
    client: TestClient,
    purpose: str = "event",
    *,
    data: bytes | None = None,
    filename: str = "photo.jpg",
    content_type: str = "image/jpeg",
    motion: tuple[str, bytes, str] | None = None,
) -> httpx.Response:
    """Post an upload; ``motion`` (file name, bytes, content type) is a Live Photo's clip."""
    files: dict[str, tuple[str, bytes, str]] = {
        "file": (filename, image_bytes() if data is None else data, content_type)
    }
    if motion is not None:
        files["motion"] = motion
    return client.post("/api/admin/uploads", params={"purpose": purpose}, files=files)


def uploaded(client: TestClient, purpose: str = "event", **options: Any) -> dict[str, Any]:
    """The ``ImageOut`` of a new upload (its ``UploadOut`` without ``progress``)."""
    response = upload(client, purpose, **options)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    body.pop("progress")
    return body


def image_row(
    purpose: str = "event",
    *,
    event_id: int | None = None,
    expires_at: datetime | None = UNSET,
    name: str = "photo",
    position: int = 0,
) -> Image:
    """An ``Image`` row (no files). Pending (expires in 24 h) unless ``expires_at`` is given."""
    now = utcnow()
    return Image(
        id=uuid.uuid4(),
        purpose=purpose,
        event_id=event_id,
        name=name,
        original_filename=f"{name}.jpg",
        original_ext="jpg",
        content_type="image/jpeg",
        byte_size=1024,
        width=640,
        height=480,
        dominant_color="#336699",
        position=position,
        created_at=now,
        expires_at=now + timedelta(hours=24) if expires_at is UNSET else expires_at,
    )


def add_folder(media_dir: Path, image_id: uuid.UUID) -> Path:
    """``media_dir/<image_id>/`` holding placeholder original, thumb and display files."""
    folder = media_dir / str(image_id)
    folder.mkdir(parents=True)
    for name in ("original.jpg", "thumb.webp", "display.webp"):
        (folder / name).write_bytes(b"placeholder")
    return folder
