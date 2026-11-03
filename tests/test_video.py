"""Videos and Live Photos: identification, conversion commands, ``.livp`` files, uploads, the
background conversions, serving and their place in events."""

import asyncio
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import time
import uuid
import zipfile
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from timelife import media, video
from timelife.config import Settings
from timelife.db import Image, create_db_engine
from timelife.errors import AppError

from .conftest import app_client, login_as, run_db
from .helpers_events import add_child, category_ids, create_event, listed, trash, update_event
from .helpers_media import clip, image_bytes, image_row, requires_ffmpeg, upload, wait_for_videos

Sessions = async_sessionmaker[AsyncSession]
MOV = "video/quicktime"


# Identification ----------------------------------------------------------------------------


def report(**changes: Any) -> dict[str, Any]:
    """An ffprobe report of an iPhone clip: portrait HEVC HLG, AAC audio and a metadata track."""
    stream = {
        "index": 0,
        "codec_type": "video",
        "codec_name": "hevc",
        "pix_fmt": "yuv420p10le",
        "width": 1920,
        "height": 1080,
        "avg_frame_rate": "30000/1001",
        "r_frame_rate": "30/1",
        "color_transfer": "arib-std-b67",
        "bit_rate": "8000000",
        "side_data_list": [{"side_data_type": "Display Matrix", "rotation": -90}],
    }
    streams = [
        {**stream, **changes.pop("stream", {})},
        {"index": 1, "codec_type": "audio", "codec_name": "aac", "channels": 2},
        {"index": 2, "codec_type": "data", "codec_name": "none"},
    ]
    fmt = {
        "format_name": "mov,mp4,m4a,3gp,3g2,mj2",
        "duration": "12.345",
        "bit_rate": "9000000",
        "tags": {"major_brand": "qt  "},
    }
    return {"streams": changes.pop("streams", streams), "format": {**fmt, **changes}}


def test_probe_reports_describe_the_video_as_displayed() -> None:
    assert video.parse_probe(report()) == video.VideoInfo(
        extension="mov",
        content_type=MOV,
        duration=12.345,
        stream=0,
        codec="hevc",
        pixel_format="yuv420p10le",
        width=1080,
        height=1920,
        frame_rate=pytest.approx(29.97, abs=0.01),
        bit_rate=8_000_000,
        rotated=True,
        hdr=True,
        audio="aac",
        channels=2,
    )


@pytest.mark.parametrize(
    ("format_name", "brand", "codec", "expected"),
    [
        ("mov,mp4,m4a,3gp,3g2,mj2", "isom", "h264", ("mp4", "video/mp4")),
        ("mov,mp4,m4a,3gp,3g2,mj2", "mp42", "h264", ("mp4", "video/mp4")),
        ("mov,mp4,m4a,3gp,3g2,mj2", "3gp4", "h264", ("3gp", "video/3gpp")),
        ("mov,mp4,m4a,3gp,3g2,mj2", "3g2a", "h264", ("3g2", "video/3gpp2")),
        ("mov,mp4,m4a,3gp,3g2,mj2", "M4V ", "h264", ("m4v", "video/x-m4v")),
        ("matroska,webm", "", "vp9", ("webm", "video/webm")),
        ("matroska,webm", "", "h264", ("mkv", "video/x-matroska")),
        ("avi", "", "mjpeg", ("avi", "video/x-msvideo")),
        ("mpegts", "", "h264", ("mts", "video/mp2t")),
    ],
)
def test_accepted_containers(
    format_name: str, brand: str, codec: str, expected: tuple[str, str]
) -> None:
    streams = [{"index": 0, "codec_type": "video", "codec_name": codec, "width": 64, "height": 48}]
    info = video.parse_probe(
        report(format_name=format_name, tags={"major_brand": brand}, streams=streams)
    )
    assert (info.extension, info.content_type, info.audio, info.rotated) == (
        *expected,
        None,
        False,
    )


@pytest.mark.parametrize(
    ("side_data", "tags", "size", "rotated"),
    [
        ([{"side_data_type": "Display Matrix", "rotation": 90}], {}, (1080, 1920), True),
        ([{"side_data_type": "Display Matrix", "rotation": 180}], {}, (1920, 1080), True),
        ([{"side_data_type": "Display Matrix", "rotation": -270.0}], {}, (1080, 1920), True),
        ([], {"rotate": "270"}, (1080, 1920), True),
        ([], {}, (1920, 1080), False),
    ],
)
def test_rotation_swaps_the_displayed_size(
    side_data: list[Any], tags: dict[str, str], size: tuple[int, int], rotated: bool
) -> None:
    info = video.parse_probe(report(stream={"side_data_list": side_data, "tags": tags}))
    assert ((info.width, info.height), info.rotated) == (size, rotated)


def test_attached_pictures_are_not_the_video() -> None:
    cover = {
        "index": 0,
        "codec_type": "video",
        "codec_name": "mjpeg",
        "width": 300,
        "height": 300,
        "disposition": {"attached_pic": 1},
    }
    clip_stream = {"index": 1, "codec_type": "video", "codec_name": "h264", "width": 640,
                   "height": 360, "avg_frame_rate": "0/0", "r_frame_rate": "25/1"}
    info = video.parse_probe(report(streams=[cover, clip_stream]))
    assert (info.stream, info.codec, info.width, info.frame_rate) == (1, "h264", 640, 25.0)


@pytest.mark.parametrize(
    "broken",
    [
        None,
        [],
        {"streams": [], "format": {"format_name": "mov", "duration": "3"}},
        report(streams=[{"index": 0, "codec_type": "audio", "codec_name": "aac"}]),
        report(stream={"width": 0}),
        report(stream={"height": 9000}),
        report(stream={"width": "1920"}),
        report(stream={"index": None}),
        report(duration="N/A"),
        report(duration="0"),
        report(duration="nan"),
        report(format_name="gif"),
    ],
)
def test_reports_that_are_no_usable_video_are_refused(broken: Any) -> None:
    with pytest.raises(AppError) as error:
        video.parse_probe(broken)
    assert (error.value.code, error.value.status) == ("unsupported_video", 422)


def box(kind: bytes, brand: bytes = b"") -> bytes:
    return b"\x00\x00\x00\x18" + kind + brand + bytes(200)


@pytest.mark.parametrize(
    ("head", "expected"),
    [
        (box(b"ftyp", b"qt  "), True),
        (box(b"ftyp", b"isom"), True),
        (box(b"ftyp", b"mp42"), True),
        (box(b"moov"), True),
        (box(b"wide"), True),
        (box(b"ftyp", b"heic"), False),
        (box(b"ftyp", b"mif1"), False),
        (box(b"ftyp", b"avif"), False),
        (b"\x1a\x45\xdf\xa3" + bytes(60), True),
        (b"RIFF\x00\x00\x00\x00AVI LIST" + bytes(60), True),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 " + bytes(60), False),
        (b"\x47" + bytes(187) + b"\x47" + bytes(187), True),
        (bytes(4) + b"\x47" + bytes(191) + b"\x47" + bytes(100), True),
        (image_bytes("JPEG"), False),
        (b"PK\x03\x04" + bytes(60), False),
        (b"", False),
    ],
)
def test_videos_are_recognised_before_being_staged(head: bytes, expected: bool) -> None:
    source = io.BytesIO(head)
    assert video.looks_like_video(source) is expected
    assert source.tell() == 0


# Commands -----------------------------------------------------------------------------------

SDR = video.VideoInfo(
    extension="mp4",
    content_type="video/mp4",
    duration=10.0,
    stream=0,
    codec="h264",
    pixel_format="yuv420p",
    width=1920,
    height=1080,
    frame_rate=30.0,
    bit_rate=8_000_000,
    rotated=False,
    hdr=False,
    audio="aac",
    channels=2,
)


def command(info: video.VideoInfo) -> list[str]:
    return video.conversion_command("ffmpeg", Path("in.mov"), Path("out.mp4"), info)


def option(arguments: list[str], name: str) -> str | None:
    return arguments[arguments.index(name) + 1] if name in arguments else None


def test_web_ready_videos_are_only_remuxed_without_metadata() -> None:
    arguments = command(SDR)
    assert arguments[:8] == ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                             "-i", "in.mov"]
    assert arguments[-8:] == ["-movflags", "+faststart", "-f", "mp4", "-progress", "pipe:1",
                              "-nostats", "out.mp4"]
    joined = " ".join(arguments)
    for part in ("-map 0:0", "-map 0:a:0?", "-map_metadata -1", "-map_chapters -1", "-sn", "-dn"):
        assert part in joined
    assert (option(arguments, "-c:v"), option(arguments, "-c:a")) == ("copy", "copy")
    assert "-vf" not in arguments


@pytest.mark.parametrize(
    "changes",
    [
        {"codec": "hevc"},
        {"pixel_format": "yuv420p10le"},
        {"width": 3840, "height": 2160},
        {"width": 1080, "height": 2400},
        {"frame_rate": 120.0},
        {"frame_rate": 0.0},
        {"rotated": True},
        {"hdr": True},
        {"bit_rate": 40_000_000},
    ],
)
def test_other_videos_are_converted_to_h264(changes: dict[str, Any]) -> None:
    arguments = command(replace(SDR, **changes))
    assert option(arguments, "-c:v") == "libx264"
    assert (option(arguments, "-crf"), option(arguments, "-pix_fmt")) == ("23", "yuv420p")
    filters = option(arguments, "-vf") or ""
    assert filters.startswith("scale=w='min(1920,iw)':h='min(1920,ih)'")
    assert filters.endswith("format=yuv420p")
    assert ("fps=60" in filters) is (changes.get("frame_rate") == 120.0)
    # Audio is re-encoded along with the video.
    assert (option(arguments, "-c:a"), option(arguments, "-b:a")) == ("aac", "128k")


def test_hdr_is_tone_mapped_when_ffmpeg_can(monkeypatch: pytest.MonkeyPatch) -> None:
    hdr = replace(SDR, codec="hevc", pixel_format="yuv420p10le", hdr=True)
    monkeypatch.setattr(video, "can_tonemap", lambda ffmpeg: True)
    mapped = command(hdr)
    assert "tonemap=tonemap=hable" in (option(mapped, "-vf") or "")
    assert [option(mapped, name) for name in ("-color_primaries", "-color_trc", "-colorspace")] == [
        "bt709"
    ] * 3
    monkeypatch.setattr(video, "can_tonemap", lambda ffmpeg: False)
    assert "tonemap" not in (option(command(hdr), "-vf") or "")


@pytest.mark.parametrize(
    ("changes", "audio"),
    [
        ({"audio": None, "channels": 0}, None),
        ({"audio": "pcm_s16le"}, ["-c:a", "aac", "-b:a", "128k"]),
        ({"audio": "aac", "channels": 6, "codec": "hevc"}, ["-c:a", "aac", "-b:a", "128k", "-ac", "2"]),
        ({"audio": "mp3"}, ["-c:a", "aac", "-b:a", "128k"]),
    ],
)
def test_audio_becomes_stereo_aac(changes: dict[str, Any], audio: list[str] | None) -> None:
    arguments = command(replace(SDR, **changes))
    if audio is None:
        assert "-c:a" not in arguments
    else:
        start = arguments.index("-c:a")
        assert arguments[start : start + len(audio)] == audio
        assert "-ac" in arguments if "-ac" in audio else "-ac" not in arguments


def test_poster_filters_keep_rgb_frames_within_the_display_edge() -> None:
    assert video.filters(SDR, edge=2048, tonemap=True, still=True) == (
        "scale=w='min(2048,iw)':h='min(2048,ih)':force_original_aspect_ratio=decrease,"
        "format=rgb24"
    )


# Staging and .livp ---------------------------------------------------------------------------


def livp(entries: dict[str, bytes], compression: int = zipfile.ZIP_STORED) -> io.BytesIO:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    buffer.seek(0)
    return buffer


def test_a_livp_holds_a_photo_and_its_clip(tmp_path: Path) -> None:
    still, motion = image_bytes("JPEG"), b"\x00\x00\x00\x18ftypqt  " + bytes(500)
    source = livp(
        {"__MACOSX/._IMG_7.JPG": b"x", "Fotos/IMG_7.JPG": still, "Fotos/IMG_7.MOV": motion}
    )
    files = video.extract_livp(source, tmp_path, 10_000, 10_000)
    assert files.still_name == "IMG_7.JPG"
    assert (files.still.read_bytes(), files.motion.read_bytes()) == (still, motion)
    assert source.tell() == 0


@pytest.mark.parametrize(
    "entries",
    [
        {"IMG_7.JPG": b"photo"},
        {"IMG_7.MOV": b"clip"},
        {"IMG_7.JPG": b"photo", "IMG_8.HEIC": b"photo", "IMG_7.MOV": b"clip"},
        {"IMG_7.JPG": b"photo", "IMG_7.MOV": b"clip", "IMG_7.MP4": b"clip"},
        {"notes.txt": b"hello"},
    ],
)
def test_a_livp_needs_exactly_one_photo_and_one_clip(
    tmp_path: Path, entries: dict[str, bytes]
) -> None:
    with pytest.raises(AppError) as error:
        video.extract_livp(livp(entries), tmp_path, 10_000, 10_000)
    assert (error.value.code, error.value.status) == ("unsupported_media", 422)


def test_damaged_or_oversized_livp_files_are_refused(tmp_path: Path) -> None:
    with pytest.raises(AppError) as damaged:
        video.extract_livp(io.BytesIO(b"PK\x03\x04" + bytes(100)), tmp_path, 100, 100)
    assert damaged.value.code == "unsupported_media"
    entries = {"IMG_7.HEIC": bytes(50), "IMG_7.MOV": bytes(150)}
    with pytest.raises(AppError) as too_large:
        video.extract_livp(livp(entries), tmp_path, 100, 100)
    assert (too_large.value.code, too_large.value.status) == ("upload_too_large", 413)


def unreadable_livp(kind: str) -> bytes:
    entries = {"IMG_é.HEIC": bytes(500), "IMG_é.MOV": bytes(500)}
    if kind == "lzma":
        return livp(entries, zipfile.ZIP_LZMA).getvalue()
    if kind == "bzip2":
        return livp(entries, zipfile.ZIP_BZIP2).getvalue()
    if kind == "name-not-utf8":
        # Flagged as UTF-8 (as every non-ASCII name is) but holding other bytes.
        return livp(entries).getvalue().replace("é".encode(), b"\xff\xfe")
    # The photo's deflated data (the first entry) starts with a reserved block type.
    data = bytearray(livp(entries, zipfile.ZIP_DEFLATED).getvalue())
    name_length, extra_length = struct.unpack_from("<HH", data, 26)
    data[30 + name_length + extra_length] = 0xFF
    return bytes(data)


@pytest.mark.parametrize("kind", ["damaged-deflate", "lzma", "bzip2", "name-not-utf8"])
def test_unreadable_livp_files_are_unsupported(tmp_path: Path, kind: str) -> None:
    with pytest.raises(AppError) as error:
        video.extract_livp(io.BytesIO(unreadable_livp(kind)), tmp_path, 10_000, 10_000)
    assert (error.value.code, error.value.status) == ("unsupported_media", 422)


def test_stale_staging_folders_are_removed(tmp_path: Path) -> None:
    video.remove_stale_staging(tmp_path)  # no staging folder yet
    old, recent = video.staging_folder(tmp_path), video.staging_folder(tmp_path)
    (old / "source").write_bytes(b"x")
    two_hours_ago = time.time() - 7200
    os.utime(old, (two_hours_ago, two_hours_ago))
    video.remove_stale_staging(tmp_path)
    assert (old.exists(), recent.exists()) == (False, True)
    assert old.parent == tmp_path / ".incoming"


def test_the_clip_to_convert(tmp_path: Path) -> None:
    assert video.source_file(tmp_path, "video", "mov") is None
    (tmp_path / "original.mov").write_bytes(b"x")
    assert video.source_file(tmp_path, "video", "mov") == tmp_path / "original.mov"
    assert video.source_file(tmp_path, "image", "heic") is None
    (tmp_path / "motion.mov").write_bytes(b"x")
    assert video.source_file(tmp_path, "image", "heic") == tmp_path / "motion.mov"


# Uploads (real ffmpeg) -----------------------------------------------------------------------


@pytest.fixture(scope="module")
def clips(tmp_path_factory: pytest.TempPathFactory) -> dict[str, bytes]:
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        pytest.skip("ffmpeg/ffprobe are not installed")
    folder = tmp_path_factory.mktemp("clips")
    tiny = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast"]
    clip(folder, "hlg.mov", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=0.6",
         "-vf", "setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc,"
         "format=yuv420p10le", "-c:v", "libx265", "-x265-params", "log-level=error",
         "-tag:v", "hvc1")
    return {
        "mp4": clip(
            folder, "paseo.mp4", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=1.2",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", *tiny, "-c:a", "aac",
            "-shortest", "-metadata", "location=+40.4168-003.7038/", "-metadata",
            "title=Paseo por Madrid", "-metadata", "make=Apple",
        ),
        # Portrait (rotated 90°) HDR HLG, as an iPhone records it.
        "hdr": clip(folder, "retrato.mov", "-display_rotation", "90", "-i",
                    str(folder / "hlg.mov"), "-c", "copy", "-brand", "qt  "),
        "motion": clip(
            folder, "IMG_0001.MOV", "-f", "lavfi", "-i", "testsrc=size=240x180:rate=15:duration=1",
            "-f", "lavfi", "-i", "sine=frequency=880:duration=1", *tiny, "-c:a", "aac",
            "-shortest", "-brand", "qt  ",
        ),
        "long_motion": clip(folder, "IMG_0002.MOV", "-f", "lavfi", "-i",
                            "testsrc=size=64x48:rate=2:duration=11", *tiny, "-brand", "qt  "),
        "long": clip(folder, "largo.mp4", "-f", "lavfi", "-i",
                     "testsrc=size=64x48:rate=1:duration=61", *tiny),
    }


def ffprobe(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
         str(path)],
        capture_output=True,
        check=True,
    )
    report_: dict[str, Any] = json.loads(result.stdout)
    return report_


def stream_of(report_: dict[str, Any], kind: str) -> dict[str, Any]:
    return next(stream for stream in report_["streams"] if stream["codec_type"] == kind)


def stored_row(client: TestClient, image_id: str) -> Image | None:
    async def load(db: AsyncSession) -> Image | None:
        return await db.get(Image, uuid.UUID(image_id))

    return run_db(client, load)


def image_total(client: TestClient) -> int:
    async def count(db: AsyncSession) -> int:
        return await db.scalar(select(func.count()).select_from(Image)) or 0

    return run_db(client, count)


def stored_folders(config: Settings) -> list[str]:
    """Image folders in ``media_dir`` (the ``.incoming`` staging folder aside)."""
    if not config.media_dir.exists():
        return []
    return [path.name for path in config.media_dir.iterdir() if path.name != video.INCOMING]


def upload_status(client: TestClient, image_id: str) -> dict[str, Any]:
    response = client.get(f"/api/admin/uploads/{image_id}")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


@requires_ffmpeg
def test_a_video_upload_is_converted_in_the_background(
    admin: TestClient, config: Settings, clips: dict[str, bytes]
) -> None:
    response = upload(admin, data=clips["mp4"], filename="Paseo.mp4", content_type="video/mp4")
    assert response.status_code == 201, response.text
    body = response.json()
    image_id = body["id"]
    assert {key: body[key] for key in ("name", "kind", "width", "height", "crop", "live")} == {
        "name": "Paseo",
        "kind": "video",
        "width": 320,
        "height": 240,
        "crop": None,
        "live": False,
    }
    assert (body["video_status"], body["video_url"]) == ("processing", None)
    assert body["duration"] == pytest.approx(1.2, abs=0.1)
    # Null once the conversion (a quick remux here) is already over.
    assert body["progress"] is None or 0 <= body["progress"] <= 1
    row = stored_row(admin, image_id)
    assert row is not None
    assert (row.original_ext, row.content_type, row.byte_size, row.purpose) == (
        "mp4",
        "video/mp4",
        len(clips["mp4"]),
        "event",
    )
    folder = config.media_dir / image_id
    assert {"original.mp4", "thumb.webp", "display.webp"} <= {p.name for p in folder.iterdir()}
    assert (folder / "original.mp4").read_bytes() == clips["mp4"]

    wait_for_videos(admin)
    done = upload_status(admin, image_id)
    assert (done["video_status"], done["video_url"], done["progress"]) == (
        "ready",
        f"/api/media/{image_id}/video",
        None,
    )
    assert {p.name for p in folder.iterdir()} == {
        "original.mp4",
        "thumb.webp",
        "display.webp",
        "video.mp4",
    }
    served = admin.get(done["video_url"])
    assert served.status_code == 200
    assert (served.headers["content-type"], served.headers["cache-control"]) == (
        "video/mp4",
        "private, max-age=31536000, immutable",
    )
    assert served.headers["accept-ranges"] == "bytes"
    assert served.content == (folder / "video.mp4").read_bytes()
    part = admin.get(done["video_url"], headers={"range": "bytes=0-99"})
    assert (part.status_code, part.headers["content-range"], part.content) == (
        206,
        f"bytes 0-99/{len(served.content)}",
        served.content[:100],
    )
    cached = admin.get(done["video_url"], headers={"if-none-match": served.headers["etag"]})
    assert cached.status_code == 304

    # Already H.264: copied as it is, without the place, title or device.
    converted = ffprobe(folder / "video.mp4")
    picture, sound = stream_of(converted, "video"), stream_of(converted, "audio")
    assert (picture["codec_name"], picture["width"], picture["height"]) == ("h264", 320, 240)
    assert sound["codec_name"] == "aac"
    tags = {key.lower() for key in converted["format"].get("tags", {})}
    assert not tags & {"location", "title", "make", "com.apple.quicktime.location.iso6709"}
    original_tags = ffprobe(folder / "original.mp4")["format"]["tags"]
    assert "location" in original_tags


@requires_ffmpeg
def test_portrait_hdr_videos_become_upright_sdr(
    admin: TestClient, config: Settings, clips: dict[str, bytes]
) -> None:
    body = upload(admin, data=clips["hdr"], filename="retrato.mov", content_type=MOV).json()
    assert (body["kind"], body["width"], body["height"]) == ("video", 360, 640)
    assert stored_row(admin, body["id"]).original_ext == "mov"  # type: ignore[union-attr]
    wait_for_videos(admin)
    assert upload_status(admin, body["id"])["video_status"] == "ready"
    picture = stream_of(ffprobe(config.media_dir / body["id"] / "video.mp4"), "video")
    assert (picture["codec_name"], picture["pix_fmt"]) == ("h264", "yuv420p")
    assert (picture["width"], picture["height"]) == (360, 640)
    assert not picture.get("side_data_list")
    if video.can_tonemap(video.tool("ffmpeg")):
        assert (picture["color_transfer"], picture["color_primaries"]) == ("bt709", "bt709")


@requires_ffmpeg
def test_live_photos_pair_a_photo_with_its_clip(
    admin: TestClient, config: Settings, clips: dict[str, bytes]
) -> None:
    still = image_bytes("JPEG", (400, 300), (30, 120, 200))
    response = upload(
        admin,
        data=still,
        filename="IMG_0001.JPG",
        motion=("IMG_0001.MOV", clips["motion"], MOV),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert {key: body[key] for key in ("name", "kind", "width", "height", "live")} == {
        "name": "IMG_0001",
        "kind": "image",
        "width": 400,
        "height": 300,
        "live": True,
    }
    assert body["video_status"] == "processing"
    assert body["duration"] == pytest.approx(1.0, abs=0.1)
    folder = config.media_dir / body["id"]
    assert (folder / "original.jpg").read_bytes() == still
    assert (folder / "motion.mov").read_bytes() == clips["motion"]
    wait_for_videos(admin)
    done = upload_status(admin, body["id"])
    assert (done["video_status"], done["video_url"]) == ("ready", f"/api/media/{body['id']}/video")
    clip_stream = stream_of(ffprobe(folder / "video.mp4"), "video")
    assert (clip_stream["codec_name"], clip_stream["width"]) == ("h264", 240)


@requires_ffmpeg
def test_icloud_livp_files_are_live_photos(
    admin: TestClient, config: Settings, clips: dict[str, bytes]
) -> None:
    heic = image_bytes("HEIF", (300, 200))
    data = livp({"IMG_0007.HEIC": heic, "IMG_0007.MOV": clips["motion"]}).getvalue()
    response = upload(admin, data=data, filename="IMG_0007.livp", content_type="application/zip")
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["name"], body["kind"], body["live"], body["video_status"]) == (
        "IMG_0007",
        "image",
        True,
        "processing",
    )
    row = stored_row(admin, body["id"])
    assert row is not None
    assert (row.original_filename, row.original_ext, row.byte_size) == (
        "IMG_0007.HEIC",
        "heic",
        len(heic),
    )
    folder = config.media_dir / body["id"]
    assert (folder / "original.heic").read_bytes() == heic
    wait_for_videos(admin)
    assert upload_status(admin, body["id"])["video_status"] == "ready"
    assert stored_folders(config) == [body["id"]]
    assert not list((config.media_dir / video.INCOMING).iterdir())


@requires_ffmpeg
def test_a_live_photo_clip_must_be_a_short_video(
    admin: TestClient, config: Settings, clips: dict[str, bytes]
) -> None:
    still = image_bytes("JPEG")
    cases = [
        upload(admin, data=still, motion=("IMG_0002.MOV", clips["long_motion"], MOV)),
        upload(admin, data=still, motion=("IMG_0002.JPG", image_bytes("JPEG"), "image/jpeg")),
        upload(admin, "avatar", data=still, motion=("IMG_0001.MOV", clips["motion"], MOV)),
        upload(
            admin,
            data=livp({"IMG_0002.JPG": still, "IMG_0002.MOV": clips["long_motion"]}).getvalue(),
            filename="IMG_0002.livp",
        ),
    ]
    assert [(r.status_code, r.json()) for r in cases] == [
        (422, {"code": "invalid_live_photo"})
    ] * 4
    # The photo of a pair must be a photo.
    swapped = upload(admin, data=clips["motion"], motion=("IMG_0001.MOV", clips["motion"], MOV))
    assert (swapped.status_code, swapped.json()) == (422, {"code": "unsupported_image"})
    assert image_total(admin) == 0
    assert stored_folders(config) == []


@requires_ffmpeg
def test_videos_over_the_limits_are_refused(
    config_factory: Callable[..., Settings], clips: dict[str, bytes]
) -> None:
    with app_client(config_factory(max_video_minutes=1, max_video_upload_mb=1)) as client:
        login_as(client, "admin")
        too_long = upload(client, data=clips["long"], filename="largo.mp4")
        assert (too_long.status_code, too_long.json()) == (422, {"code": "video_too_long"})
        padded = clips["mp4"] + bytes(1024 * 1024 + 1 - len(clips["mp4"]))
        too_large = upload(client, data=padded, filename="grande.mp4")
        assert (too_large.status_code, too_large.json()) == (413, {"code": "upload_too_large"})
        assert image_total(client) == 0


@requires_ffmpeg
def test_videos_are_for_events_only_and_must_be_readable(
    admin: TestClient, config: Settings, clips: dict[str, bytes]
) -> None:
    avatar = upload(admin, "avatar", data=clips["mp4"], filename="paseo.mp4")
    assert (avatar.status_code, avatar.json()) == (422, {"code": "unsupported_image"})
    damaged = upload(admin, data=clips["mp4"][:2000], filename="roto.mp4")
    assert (damaged.status_code, damaged.json()) == (422, {"code": "unsupported_video"})
    junk = upload(admin, data=box(b"ftyp", b"isom") + bytes(5000), filename="nada.mov")
    assert (junk.status_code, junk.json()) == (422, {"code": "unsupported_video"})
    assert image_total(admin) == 0
    assert stored_folders(config) == []


@requires_ffmpeg
def test_without_ffmpeg_videos_are_unavailable(
    admin: TestClient, clips: dict[str, bytes], monkeypatch: pytest.MonkeyPatch
) -> None:
    def missing(name: str) -> str:
        raise AppError("video_unavailable", 503)

    monkeypatch.setattr(video, "tool", missing)
    response = upload(admin, data=clips["mp4"], filename="paseo.mp4")
    assert (response.status_code, response.json()) == (503, {"code": "video_unavailable"})
    assert upload(admin).status_code == 201  # photos keep working


def test_upload_status_needs_an_administrator(client: TestClient) -> None:
    missing = f"/api/admin/uploads/{uuid.uuid4()}"
    assert client.get(missing).status_code == 401
    login_as(client, "viewer")
    assert client.get(missing).status_code == 403
    login_as(client, "admin")
    assert (client.get(missing).status_code, client.get(missing).json()) == (
        404,
        {"code": "image_not_found"},
    )
    photo = upload(client).json()
    assert client.get(f"/api/admin/uploads/{photo['id']}").json() == photo


# Events and serving -------------------------------------------------------------------------


@pytest.fixture
def family(admin: TestClient) -> dict[str, int]:
    return {"lucia": add_child(admin), **category_ids(admin)}


@requires_ffmpeg
def test_events_show_videos_and_respect_the_live_choice(
    admin: TestClient, family: dict[str, int], clips: dict[str, bytes]
) -> None:
    movie = upload(admin, data=clips["mp4"], filename="paseo.mp4").json()
    live = upload(admin, data=image_bytes("JPEG"), filename="IMG_0001.JPG",
                  motion=("IMG_0001.MOV", clips["motion"], MOV)).json()
    photo = upload(admin, filename="foto.jpg").json()
    wait_for_videos(admin)
    login_as(admin, "viewer")
    # Pending uploads stay private.
    assert admin.get(f"/api/media/{movie['id']}/video").status_code == 404
    login_as(admin, "admin")
    assert admin.get(f"/api/media/{live['id']}/video").status_code == 200

    event = create_event(
        admin,
        [family["lucia"]],
        [family["general"]],
        images=[
            {"id": movie["id"], "name": "Paseo"},
            {"id": live["id"], "name": "Risas", "live": False},
            {"id": photo["id"], "name": "Foto", "live": True},
        ],
    )
    shown = {image["name"]: image for image in event["images"]}
    assert {name: (item["kind"], item["video_status"], item["live"]) for name, item in
            shown.items()} == {
        "Paseo": ("video", "ready", False),
        "Risas": ("image", "ready", False),
        "Foto": ("image", None, False),
    }
    assert shown["Risas"]["video_url"] == f"/api/media/{live['id']}/video"
    assert event["cover_image_id"] == movie["id"]

    login_as(admin, "viewer")
    viewer_event = admin.get(f"/api/events/{event['id']}").json()
    assert viewer_event["images"] == event["images"]
    assert admin.get(shown["Paseo"]["video_url"]).status_code == 200
    # The admin switched the Live Photo off: its clip is not served to viewers.
    assert admin.get(shown["Risas"]["video_url"]).status_code == 404
    assert admin.get(shown["Risas"]["display_url"]).status_code == 200
    assert admin.get(f"/api/media/{photo['id']}/video").status_code == 404

    login_as(admin, "admin")
    assert admin.get(shown["Risas"]["video_url"]).status_code == 200
    changed = update_event(
        admin,
        event,
        images=[{"id": image["id"], "name": image["name"]} for image in event["images"]],
    )
    assert changed.status_code == 200, changed.text
    assert [image["live"] for image in changed.json()["images"]] == [False, True, False]
    login_as(admin, "viewer")
    assert admin.get(shown["Risas"]["video_url"]).status_code == 200

    login_as(admin, "admin")
    summary = listed(admin)["items"][0]
    assert (summary["image_count"], summary["video_count"]) == (3, 1)
    assert admin.delete(f"/api/admin/events/{event['id']}").status_code == 204
    item = trash(admin)[0]
    assert (item["image_count"], item["video_count"]) == (3, 1)


def test_videos_are_served_only_once_ready(admin: TestClient, config: Settings) -> None:
    async def add(db: AsyncSession) -> uuid.UUID:
        row = image_row(expires_at=None)
        row.kind, row.video_status = "video", "processing"
        db.add(row)
        await db.commit()
        return row.id

    image_id = run_db(admin, add)
    folder = config.media_dir / str(image_id)
    folder.mkdir(parents=True)
    (folder / "video.mp4").write_bytes(b"not yet")
    assert admin.get(f"/api/media/{image_id}/video").status_code == 404
    assert upload_status(admin, str(image_id))["video_url"] is None


# Background conversions ---------------------------------------------------------------------


def add_video_row(client: TestClient, config: Settings, original: bytes) -> str:
    """A pending video being processed, whose original is ``original``."""

    async def add(db: AsyncSession) -> uuid.UUID:
        row = image_row()
        row.kind, row.video_status, row.original_ext = "video", "processing", "mp4"
        db.add(row)
        await db.commit()
        return row.id

    image_id = run_db(client, add)
    folder = config.media_dir / str(image_id)
    folder.mkdir(parents=True)
    (folder / "original.mp4").write_bytes(original)
    return str(image_id)


def enqueue(client: TestClient, image_id: str) -> None:
    app: Any = client.app
    assert client.portal is not None
    client.portal.call(enqueue_in_loop, app.state.video_jobs, uuid.UUID(image_id))


async def enqueue_in_loop(jobs: video.VideoJobs, image_id: uuid.UUID) -> None:
    jobs.enqueue(image_id)


@requires_ffmpeg
def test_a_failed_conversion_is_reported(admin: TestClient, config: Settings) -> None:
    image_id = add_video_row(admin, config, b"\x00\x00\x00\x18ftypisom" + bytes(3000))
    enqueue(admin, image_id)
    wait_for_videos(admin)
    status = upload_status(admin, image_id)
    assert (status["video_status"], status["video_url"], status["progress"]) == (
        "failed",
        None,
        None,
    )
    assert {path.name for path in (config.media_dir / image_id).iterdir()} == {"original.mp4"}


@requires_ffmpeg
def test_deleting_an_image_stops_its_conversion(
    admin: TestClient, config: Settings, clips: dict[str, bytes], monkeypatch: pytest.MonkeyPatch
) -> None:
    sleeper = [sys.executable, "-c", "import time; time.sleep(60)"]
    monkeypatch.setattr(video, "conversion_command", lambda *args: sleeper)
    body = upload(admin, data=clips["mp4"], filename="paseo.mp4").json()

    async def delete(db: AsyncSession) -> None:
        image = await db.get(Image, uuid.UUID(body["id"]))
        assert image is not None
        await media.delete_images(db, [image], config.media_dir)
        await db.commit()

    started = time.monotonic()
    run_db(admin, delete)
    wait_for_videos(admin)
    assert time.monotonic() - started < 30
    assert not (config.media_dir / body["id"]).exists()
    assert stored_row(admin, body["id"]) is None


def insert_row(config: Settings, row: Image) -> None:
    """Add ``row`` before any app is started."""

    async def add() -> None:
        engine = create_db_engine(config.database_url)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                db.add(row)
                await db.commit()
        finally:
            await engine.dispose()

    asyncio.run(add())


@requires_ffmpeg
def test_interrupted_conversions_resume_at_startup(
    config: Settings, clips: dict[str, bytes]
) -> None:
    row = image_row(expires_at=None)
    row.kind, row.video_status, row.original_ext = "video", "processing", "mp4"
    insert_row(config, row)
    folder = config.media_dir / str(row.id)
    folder.mkdir(parents=True)
    (folder / "original.mp4").write_bytes(clips["mp4"])
    stale = video.staging_folder(config.media_dir)
    two_hours_ago = time.time() - 7200
    os.utime(stale, (two_hours_ago, two_hours_ago))

    with app_client(config) as client:
        login_as(client, "admin")
        wait_for_videos(client)
        assert upload_status(client, str(row.id))["video_status"] == "ready"
    assert (folder / "video.mp4").is_file()
    assert not stale.exists()


async def test_new_columns_default_to_a_plain_photo(sessions: Sessions) -> None:
    async with sessions() as db:
        row = image_row()
        db.add(row)
        await db.commit()
    async with sessions() as db:
        stored = await db.get(Image, row.id)
    assert stored is not None
    assert (stored.kind, stored.video_status, stored.duration, stored.live) == (
        "image",
        None,
        None,
        False,
    )
    assert (stored.video_url, stored.is_live_photo) == (None, False)
    stored.video_status = "ready"
    assert (stored.video_url, stored.is_live_photo) == (f"/api/media/{stored.id}/video", True)


async def test_byte_size_holds_videos_beyond_2_gib(sessions: Sessions) -> None:
    # MAX_VIDEO_UPLOAD_MB goes up to 4096; a PostgreSQL INTEGER stops just under 2 GiB.
    row = image_row()
    row.byte_size = 4096 * 1024 * 1024
    async with sessions() as db:
        db.add(row)
        await db.commit()
    async with sessions() as db:
        stored = await db.scalar(select(Image.byte_size).where(Image.id == row.id))
    assert stored == 4096 * 1024 * 1024
