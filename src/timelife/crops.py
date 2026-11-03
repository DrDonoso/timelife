"""Thumbnail framing ("crop") of event images: which square of the picture its 512 × 512 thumbnail
shows — for the cover, what the timeline circle shows.

A framing is the centre of that square, as fractions of the picture's width and height, and a
zoom: at 1 the square's side is the picture's short edge, at 2 half of it, up to ``MAX_ZOOM``.
Without a framing the thumbnail is the centred square (``x = y = 0.5``, zoom 1). Framed
thumbnails are cached next to the picture as ``thumb-<key>.webp``; the key also versions their URL.
"""

import hashlib
import uuid

MAX_ZOOM = 4.0
DECIMALS = 4

Framing = tuple[float, float, float]


def normalize(x: float, y: float, zoom: float, width: int, height: int) -> Framing | None:
    """The framing kept inside a ``width`` × ``height`` picture and rounded; None when it is the
    centred square."""
    zoom = min(MAX_ZOOM, max(1.0, zoom))
    side = min(width, height) / zoom
    half_x = side / 2 / width
    half_y = side / 2 / height
    framing = (
        round(min(1 - half_x, max(half_x, x)), DECIMALS),
        round(min(1 - half_y, max(half_y, y)), DECIMALS),
        round(zoom, DECIMALS),
    )
    if all(abs(value - default) < 10**-DECIMALS for value, default in zip(framing, (0.5, 0.5, 1))):
        return None
    return framing


def key(framing: Framing) -> str:
    """Short, stable identifier of a framing (file name and URL version of its thumbnail)."""
    x, y, zoom = framing
    return hashlib.sha256(f"crop1:{x:.4f}:{y:.4f}:{zoom:.4f}".encode()).hexdigest()[:12]


def thumb_url(image_id: uuid.UUID, framing: Framing | None) -> str:
    """URL of an image's thumbnail; framed ones carry their key (cached URLs stay correct)."""
    url = f"/api/media/{image_id}/thumb"
    return url if framing is None else f"{url}?v={key(framing)}"


def box(framing: Framing, width: int, height: int) -> tuple[float, float, float, float]:
    """Pixel box (left, top, right, bottom) a framing shows of a ``width`` × ``height`` picture."""
    x, y, zoom = framing
    side = min(width, height) / zoom
    left = min(max(x * width - side / 2, 0), width - side)
    top = min(max(y * height - side / 2, 0), height - side)
    return left, top, left + side, top + side
