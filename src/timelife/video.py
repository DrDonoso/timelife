"""Videos and Live Photo motions: identification (ffprobe), poster frames and their conversion
(ffmpeg) to an MP4 every browser plays.

A video is stored like a photo — ``media_dir/<uuid>/original.<ext>`` (never served) with the
``thumb.webp``/``display.webp`` of a poster frame — plus ``video.mp4``: H.264/AAC, long edge at most
1920 px, at most 60 fps, SDR, without metadata (place, device…) and ready to stream
(``+faststart``). A Live Photo is a photo with ``motion.<ext>`` (the original clip of its motion)
and the ``video.mp4`` of that clip.

The upload answers once the files are stored: ``VideoJobs`` writes ``video.mp4`` in the background,
one conversion at a time, and moves ``images.video_status`` from ``processing`` to ``ready`` (or
``failed``). Conversions a restart interrupted run again at startup. The queue lives in this
process: run a single Uvicorn worker (as the container does)."""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import weakref
import zipfile
import zlib
from dataclasses import dataclass
from functools import cache
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.concurrency import run_in_threadpool

from .db import Image
from .errors import AppError

log = logging.getLogger(__name__)

# Folder of ``media_dir`` where uploads are staged while they are identified.
INCOMING = ".incoming"
STALE_INCOMING_SECONDS = 3600
SNIFF_BYTES = 512
# Converted videos: long edge, frame rate, x264 quality; a source already within them (H.264,
# 8-bit 4:2:0, SDR, upright, moderate bitrate) is only remuxed.
MAX_EDGE = 1920
MAX_FPS = 60
CRF = 23
REMUX_MAX_BITRATE = 12_000_000
AUDIO_BITRATE = "128k"
MAX_FRAME_EDGE = 8192
# Live Photo motions last about 3 s; anything much longer is not one.
LIVE_MOTION_SECONDS = 10.0
POSTER_SECONDS = 1.0
PROBE_TIMEOUT = 60
POSTER_TIMEOUT = 120
# A conversion may take this long (at least MIN_CONVERSION_SECONDS) per second of video.
CONVERSION_FACTOR = 20
MIN_CONVERSION_SECONDS = 600
HDR_TRANSFERS = frozenset({"arib-std-b67", "smpte2084"})
AUDIO_COPY = frozenset({"aac"})
WEBM_CODECS = frozenset({"vp8", "vp9", "av1", "opus", "vorbis"})
# ISO base media (MP4, MOV, 3GP) files start with one of these boxes; HEIF/AVIF pictures share the
# format, with these brands.
ISO_BOXES = frozenset({b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot"})
PICTURE_BRANDS = frozenset(
    {b"avif", b"avis", b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1"}
)
PROGRESS_KEYS = ("out_time_us", "out_time_ms")


@dataclass(frozen=True)
class VideoInfo:
    """What ``probe`` found: container, duration and the first video (and audio) stream."""

    extension: str
    content_type: str
    duration: float
    stream: int
    codec: str
    pixel_format: str
    # As displayed (rotation applied).
    width: int
    height: int
    frame_rate: float
    bit_rate: int | None
    rotated: bool
    hdr: bool
    audio: str | None
    channels: int


# Tools --------------------------------------------------------------------------------------


def tool(name: str) -> str:
    """Path of ``ffmpeg``/``ffprobe``; 503 ``video_unavailable`` when it is not installed."""
    path = shutil.which(name)
    if path is None:
        raise AppError("video_unavailable", 503)
    return path


@cache
def can_tonemap(ffmpeg: str) -> bool:
    """Whether this ffmpeg has the filters that map HDR to SDR (``zscale`` and ``tonemap``)."""
    try:
        result = subprocess.run(
            [ffmpeg, "-hide_banner", "-filters"],
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    names = {fields[1] for line in result.stdout.splitlines() if len(fields := line.split()) > 1}
    return {"zscale", "tonemap"} <= names


def lower_priority() -> list[str]:
    """Command prefix that runs a conversion at a low CPU priority (POSIX ``nice``)."""
    nice = shutil.which("nice") if os.name == "posix" else None
    return [nice, "-n", "10"] if nice else []


# Identification -----------------------------------------------------------------------------


def looks_like_video(source: BinaryIO) -> bool:
    """Whether the file starts like a container ``probe`` accepts (MP4/MOV/3GP, Matroska/WebM,
    AVI or MPEG-TS), so that other files are refused without being staged."""
    source.seek(0)
    head = source.read(SNIFF_BYTES)
    source.seek(0)
    if len(head) >= 12 and head[4:8] in ISO_BOXES:
        return not (head[4:8] == b"ftyp" and head[8:12] in PICTURE_BRANDS)
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return True
    if head.startswith(b"RIFF") and head[8:12] == b"AVI ":
        return True
    return (len(head) > 188 and head[0] == 0x47 and head[188] == 0x47) or (
        len(head) > 196 and head[4] == 0x47 and head[196] == 0x47
    )


def number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result and result not in (float("inf"), float("-inf")) else None


def mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def rate(value: Any) -> float | None:
    """``"30000/1001"`` → 29.97; None when missing or zero."""
    if not isinstance(value, str):
        return None
    top, _, bottom = value.partition("/")
    numerator, denominator = number(top), number(bottom or "1")
    if not numerator or not denominator:
        return None
    return numerator / denominator


def rotation(stream: dict[str, Any]) -> int:
    """Clockwise quarter turns the player applies (display matrix, or the older ``rotate`` tag)."""
    degrees: float | None = None
    for data in stream.get("side_data_list") or []:
        if isinstance(data, dict) and data.get("side_data_type") == "Display Matrix":
            degrees = number(data.get("rotation"))
    if degrees is None:
        degrees = number(mapping(stream.get("tags")).get("rotate"))
    return round((degrees or 0) / 90) % 4


def container(format_name: str, brand: str, codecs: set[str]) -> tuple[str, str] | None:
    """Extension and content type of the stored original, from the demuxer that read it."""
    names = set(format_name.split(","))
    if "mov" in names or "mp4" in names:
        if brand == "qt":
            return "mov", "video/quicktime"
        if brand.startswith("3g2"):
            return "3g2", "video/3gpp2"
        if brand.startswith("3gp"):
            return "3gp", "video/3gpp"
        if brand == "m4v":
            return "m4v", "video/x-m4v"
        return "mp4", "video/mp4"
    if "matroska" in names or "webm" in names:
        if codecs <= WEBM_CODECS:
            return "webm", "video/webm"
        return "mkv", "video/x-matroska"
    if "avi" in names:
        return "avi", "video/x-msvideo"
    if "mpegts" in names:
        return "mts", "video/mp2t"
    return None


def parse_probe(report: Any) -> VideoInfo:
    """``VideoInfo`` from ffprobe's JSON report; 422 ``unsupported_video`` when it is no video
    this app can show."""
    if not isinstance(report, dict):
        raise AppError("unsupported_video")
    streams = [item for item in report.get("streams") or [] if isinstance(item, dict)]
    videos = [
        item
        for item in streams
        if item.get("codec_type") == "video"
        and not mapping(item.get("disposition")).get("attached_pic")
    ]
    audios = [item for item in streams if item.get("codec_type") == "audio"]
    if not videos:
        raise AppError("unsupported_video")
    stream = videos[0]
    audio = audios[0] if audios else None
    fmt = mapping(report.get("format"))
    tags = mapping(fmt.get("tags"))
    codecs = {str(item.get("codec_name", "")) for item in (stream, audio) if item is not None}
    kind = container(
        str(fmt.get("format_name", "")), str(tags.get("major_brand", "")).strip().lower(), codecs
    )
    width, height = stream.get("width"), stream.get("height")
    duration = number(fmt.get("duration")) or number(stream.get("duration"))
    index = stream.get("index")
    if (
        kind is None
        or not isinstance(width, int)
        or not isinstance(height, int)
        or not 0 < width <= MAX_FRAME_EDGE
        or not 0 < height <= MAX_FRAME_EDGE
        or duration is None
        or duration <= 0
        or not isinstance(index, int)
    ):
        raise AppError("unsupported_video")
    turns = rotation(stream)
    if turns % 2:
        width, height = height, width
    bit_rate = number(stream.get("bit_rate")) or number(fmt.get("bit_rate"))
    channels = audio.get("channels") if audio is not None else 0
    return VideoInfo(
        extension=kind[0],
        content_type=kind[1],
        duration=duration,
        stream=index,
        codec=str(stream.get("codec_name", "")),
        pixel_format=str(stream.get("pix_fmt", "")),
        width=width,
        height=height,
        frame_rate=rate(stream.get("avg_frame_rate")) or rate(stream.get("r_frame_rate")) or 0.0,
        bit_rate=None if bit_rate is None else int(bit_rate),
        rotated=turns != 0,
        hdr=stream.get("color_transfer") in HDR_TRANSFERS,
        audio=None if audio is None else str(audio.get("codec_name", "")),
        channels=channels if isinstance(channels, int) else 0,
    )


def probe(path: Path) -> VideoInfo:
    """Identify the video at ``path``: 422 ``unsupported_video`` unless ffprobe reads a video
    stream in an accepted container; 503 ``video_unavailable`` without ffprobe."""
    command = [
        tool("ffprobe"),
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-i",
        str(path),
    ]
    try:
        result = subprocess.run(
            command, capture_output=True, timeout=PROBE_TIMEOUT, stdin=subprocess.DEVNULL
        )
        report = json.loads(result.stdout) if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError, ValueError):
        raise AppError("unsupported_video") from None
    return parse_probe(report)


# Filters and commands -----------------------------------------------------------------------


def filters(info: VideoInfo, *, edge: int, tonemap: bool, still: bool = False) -> str:
    """Filter graph: shrink to ``edge`` (never enlarge), map HDR to SDR when possible, cap the
    frame rate (videos) and convert to RGB (``still``) or 8-bit 4:2:0. Rotation is applied by
    ffmpeg before the filters."""
    divisible = "" if still else ":force_divisible_by=2"
    steps = [
        f"scale=w='min({edge},iw)':h='min({edge},ih)':force_original_aspect_ratio=decrease"
        + divisible
    ]
    if info.hdr and tonemap:
        steps += [
            "zscale=t=linear:npl=100",
            "format=gbrpf32le",
            "zscale=p=bt709",
            "tonemap=tonemap=hable:desat=0",
            "zscale=t=bt709:m=bt709:r=tv",
        ]
    if not still and info.frame_rate > MAX_FPS:
        steps.append(f"fps={MAX_FPS}")
    steps.append("format=rgb24" if still else "format=yuv420p")
    return ",".join(steps)


def remuxable(info: VideoInfo) -> bool:
    """Whether the video stream can be copied as it is (already what a conversion produces)."""
    return (
        info.codec == "h264"
        and info.pixel_format in ("yuv420p", "yuvj420p")
        and max(info.width, info.height) <= MAX_EDGE
        and 0 < info.frame_rate <= MAX_FPS
        and not info.hdr
        and not info.rotated
        and (info.bit_rate is None or info.bit_rate <= REMUX_MAX_BITRATE)
    )


def poster_command(ffmpeg: str, path: Path, info: VideoInfo, at: float, edge: int) -> list[str]:
    return [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{at:.3f}",
        "-i",
        str(path),
        "-map",
        f"0:{info.stream}",
        "-frames:v",
        "1",
        "-vf",
        filters(info, edge=edge, tonemap=can_tonemap(ffmpeg), still=True),
        "-f",
        "image2pipe",
        "-c:v",
        "png",
        "pipe:1",
    ]


def poster(path: Path, info: VideoInfo, edge: int) -> bytes:
    """PNG of a frame near the start (``POSTER_SECONDS``, or the middle of shorter clips), upright,
    SDR and at most ``edge`` pixels long; 422 ``unsupported_video`` when none can be decoded."""
    ffmpeg = tool("ffmpeg")
    for at in dict.fromkeys((min(POSTER_SECONDS, info.duration / 2), 0.0)):
        try:
            result = subprocess.run(
                poster_command(ffmpeg, path, info, at, edge),
                capture_output=True,
                timeout=POSTER_TIMEOUT,
                stdin=subprocess.DEVNULL,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if result.returncode == 0 and result.stdout:
            return result.stdout
    raise AppError("unsupported_video")


def conversion_command(ffmpeg: str, source: Path, target: Path, info: VideoInfo) -> list[str]:
    """ffmpeg arguments writing the MP4 of ``source`` to ``target`` (progress on stdout)."""
    command = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-map",
        f"0:{info.stream}",
        "-map",
        "0:a:0?",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-sn",
        "-dn",
    ]
    copy = remuxable(info)
    if copy:
        command += ["-c:v", "copy"]
    else:
        tonemap = info.hdr and can_tonemap(ffmpeg)
        command += [
            "-vf",
            filters(info, edge=MAX_EDGE, tonemap=tonemap),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            str(CRF),
            "-profile:v",
            "high",
            "-pix_fmt",
            "yuv420p",
        ]
        if info.hdr:
            command += ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
    if info.audio is not None:
        if copy and info.audio in AUDIO_COPY:
            command += ["-c:a", "copy"]
        else:
            command += ["-c:a", "aac", "-b:a", AUDIO_BITRATE]
            if info.channels > 2:
                command += ["-ac", "2"]
    return [
        *command,
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        "-progress",
        "pipe:1",
        "-nostats",
        str(target),
    ]


# Staging ------------------------------------------------------------------------------------


def staging_folder(media_dir: Path) -> Path:
    """A new folder in ``media_dir/.incoming`` (same file system: files move out by renaming)."""
    folder = media_dir / INCOMING / uuid.uuid4().hex
    folder.mkdir(parents=True)
    return folder


def stage(source: BinaryIO, path: Path) -> int:
    """Copy an upload to ``path``; returns its size."""
    source.seek(0)
    with open(path, "xb") as handle:
        shutil.copyfileobj(source, handle, 1024 * 1024)
        size = handle.tell()
    source.seek(0)
    return size


def remove_stale_staging(media_dir: Path, older_than: float = STALE_INCOMING_SECONDS) -> None:
    """Delete staging folders left behind (crash or failed clean-up) for over ``older_than`` s."""
    root = media_dir / INCOMING
    limit = time.time() - older_than
    try:
        entries = list(root.iterdir())
    except OSError:
        return
    for entry in entries:
        try:
            if entry.stat().st_mtime < limit:
                shutil.rmtree(entry, ignore_errors=True)
        except OSError:
            continue


def source_file(folder: Path, kind: str, original_ext: str) -> Path | None:
    """The clip to convert: ``original.<ext>`` of a video, ``motion.<ext>`` of a Live Photo."""
    if kind == "video":
        path: Path | None = folder / f"original.{original_ext}"
    else:
        path = next(iter(sorted(folder.glob("motion.*"))), None)
    return path if path is not None and path.is_file() else None


# Live Photos from iCloud (.livp) ------------------------------------------------------------

LIVP_STILLS = frozenset({"heic", "heif", "jpg", "jpeg"})
LIVP_MOTIONS = frozenset({"mov", "mp4"})
# Stored or deflated, as every ZIP tool writes them; others (LZMA, bzip2…) are refused.
LIVP_COMPRESSIONS = frozenset({zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED})


@dataclass(frozen=True)
class LivePhotoFiles:
    """The two halves of a ``.livp``, extracted to a staging folder."""

    still_name: str
    still: Path
    motion: Path


def is_zip(source: BinaryIO) -> bool:
    source.seek(0)
    head = source.read(4)
    source.seek(0)
    return head == b"PK\x03\x04"


def entry_extension(name: str) -> str:
    return PurePosixPath(name).suffix.lower().lstrip(".")


def hidden_entry(name: str) -> bool:
    """macOS metadata stored next to the real files (``__MACOSX/``, ``._name``)."""
    path = PurePosixPath(name)
    return path.parts[:1] == ("__MACOSX",) or path.name.startswith("._")


def copy_entry(archive: zipfile.ZipFile, entry: zipfile.ZipInfo, path: Path, limit: int) -> None:
    with archive.open(entry) as reader, open(path, "xb") as writer:
        copied = 0
        while chunk := reader.read(1024 * 1024):
            copied += len(chunk)
            if copied > limit:
                raise AppError("upload_too_large", 413)
            writer.write(chunk)


def extract_livp(
    source: BinaryIO, folder: Path, max_still: int, max_motion: int
) -> LivePhotoFiles:
    """The photo and the clip of an iCloud ``.livp`` (a ZIP holding both), copied to ``folder``.
    422 ``unsupported_media`` unless it holds exactly one photo (HEIC/JPEG) and one clip
    (MOV/MP4); 413 ``upload_too_large`` beyond the photo or video limit."""
    source.seek(0)
    try:
        with zipfile.ZipFile(source) as archive:
            entries = [
                entry
                for entry in archive.infolist()
                if not entry.is_dir() and not hidden_entry(entry.filename)
            ]
            stills = [entry for entry in entries if entry_extension(entry.filename) in LIVP_STILLS]
            motions = [
                entry for entry in entries if entry_extension(entry.filename) in LIVP_MOTIONS
            ]
            if len(stills) != 1 or len(motions) != 1:
                raise AppError("unsupported_media")
            still, motion = stills[0], motions[0]
            if {still.compress_type, motion.compress_type} - LIVP_COMPRESSIONS:
                raise AppError("unsupported_media")
            if still.file_size > max_still or motion.file_size > max_motion:
                raise AppError("upload_too_large", 413)
            files = LivePhotoFiles(
                still_name=PurePosixPath(still.filename).name,
                still=folder / "still",
                motion=folder / "motion-source",
            )
            copy_entry(archive, still, files.still, max_still)
            copy_entry(archive, motion, files.motion, max_motion)
    except (
        zipfile.BadZipFile,
        zipfile.LargeZipFile,
        NotImplementedError,
        RuntimeError,
        EOFError,
        zlib.error,
        UnicodeError,
    ):
        # Damaged (also its deflated data or its UTF-8 names) or encrypted.
        raise AppError("unsupported_media") from None
    finally:
        source.seek(0)
    return files


# Background conversions ---------------------------------------------------------------------

_JOBS: "weakref.WeakSet[VideoJobs]" = weakref.WeakSet()


def cancel(media_dir: Path, image_id: uuid.UUID) -> None:
    """Stop converting ``image_id`` (its image is being deleted), in every running app."""
    for jobs in list(_JOBS):
        if jobs.media_dir == media_dir:
            jobs.cancel(image_id)


class VideoJobs:
    """Converts uploaded videos and Live Photo motions to ``video.mp4``, one at a time."""

    def __init__(self, sessions: async_sessionmaker[AsyncSession], media_dir: Path) -> None:
        self.sessions = sessions
        self.media_dir = media_dir
        self.queue: asyncio.Queue[uuid.UUID] | None = None
        self.pending: set[uuid.UUID] = set()
        self.cancelled: set[uuid.UUID] = set()
        self.fractions: dict[uuid.UUID, float] = {}
        self.running: tuple[uuid.UUID, subprocess.Popen[bytes]] | None = None
        self.stopping = False
        self.worker: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the worker and queue the conversions a restart interrupted."""
        await run_in_threadpool(remove_stale_staging, self.media_dir)
        self.stopping = False
        self.queue = asyncio.Queue()
        self.worker = asyncio.create_task(self.work(), name="timelife-video-jobs")
        _JOBS.add(self)
        async with self.sessions() as db:
            waiting = list(
                await db.scalars(
                    select(Image.id)
                    .where(Image.video_status == "processing")
                    .order_by(Image.created_at, Image.id)
                )
            )
        for image_id in waiting:
            self.enqueue(image_id)

    async def stop(self) -> None:
        _JOBS.discard(self)
        if self.worker is None:
            return
        # A conversion being started sees the flag; a running one is killed (it runs again at
        # the next startup).
        self.stopping = True
        self.worker.cancel()
        self.kill()
        try:
            await self.worker
        except asyncio.CancelledError:
            pass
        self.worker = None

    def enqueue(self, image_id: uuid.UUID) -> None:
        if self.queue is None or image_id in self.pending:
            return
        self.pending.add(image_id)
        self.cancelled.discard(image_id)
        self.fractions[image_id] = 0.0
        self.queue.put_nowait(image_id)

    def progress(self, image_id: uuid.UUID) -> float | None:
        """Share of the conversion done (0–1) while queued or running; None otherwise."""
        return self.fractions.get(image_id)

    def cancel(self, image_id: uuid.UUID) -> None:
        if image_id not in self.pending:
            return
        self.cancelled.add(image_id)
        running = self.running
        if running is not None and running[0] == image_id:
            self.kill()

    def kill(self) -> None:
        running = self.running
        if running is not None:
            try:
                running[1].kill()
            except OSError:
                pass

    async def idle(self) -> None:
        """Wait until every queued conversion is finished (tests)."""
        if self.queue is not None:
            await self.queue.join()

    async def work(self) -> None:
        assert self.queue is not None
        while True:
            image_id = await self.queue.get()
            try:
                if image_id not in self.cancelled:
                    await self.convert(image_id)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log.error("Video conversion failed unexpectedly (%s)", type(error).__name__)
                try:
                    await self.finish(image_id, "failed")
                except Exception as finish_error:
                    log.error("Video status not saved (%s)", type(finish_error).__name__)
            finally:
                self.pending.discard(image_id)
                self.cancelled.discard(image_id)
                self.fractions.pop(image_id, None)
                self.queue.task_done()

    async def convert(self, image_id: uuid.UUID) -> None:
        async with self.sessions() as db:
            image = await db.get(Image, image_id)
            if image is None or image.video_status != "processing":
                return
            kind, original_ext = image.kind, image.original_ext
        try:
            ffmpeg = tool("ffmpeg")
            tool("ffprobe")
        except AppError:
            # Not marked failed: the conversion runs once ffmpeg is installed and the app restarts.
            log.warning("ffmpeg/ffprobe not found: video conversions are waiting")
            return
        folder = self.media_dir / str(image_id)
        source = await run_in_threadpool(source_file, folder, kind, original_ext)
        target = folder / ".video.mp4.partial"
        status = "failed"
        if source is not None:
            try:
                info = await run_in_threadpool(probe, source)
            except AppError:
                info = None
            if info is not None and image_id not in self.cancelled:
                command = [
                    *lower_priority(),
                    *conversion_command(ffmpeg, source, target, info),
                ]
                limit = max(MIN_CONVERSION_SECONDS, info.duration * CONVERSION_FACTOR)
                done = await run_in_threadpool(self.run_ffmpeg, image_id, command, info, limit)
                if done and image_id not in self.cancelled:
                    try:
                        await run_in_threadpool(publish, target, folder / "video.mp4")
                        status = "ready"
                    except OSError as error:
                        log.warning("Converted video not stored (%s)", type(error).__name__)
        await run_in_threadpool(remove_file, target)
        if image_id in self.cancelled:
            await run_in_threadpool(remove_folder, folder)
            return
        if self.stopping:
            return
        if not await self.finish(image_id, status):
            # Deleted meanwhile: its folder may have been recreated by the conversion.
            await run_in_threadpool(remove_folder, folder)

    def run_ffmpeg(
        self, image_id: uuid.UUID, command: list[str], info: VideoInfo, limit: float
    ) -> bool:
        """Run a conversion (worker thread), recording its progress; False when it fails, is
        cancelled or exceeds ``limit`` seconds."""
        with tempfile.TemporaryFile() as errors:
            try:
                process = subprocess.Popen(
                    command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=errors
                )
            except OSError as error:
                log.warning("ffmpeg could not start (%s)", type(error).__name__)
                return False
            self.running = (image_id, process)
            timer = threading.Timer(limit, process.kill)
            timer.daemon = True
            timer.start()
            try:
                if image_id in self.cancelled or self.stopping:
                    process.kill()
                assert process.stdout is not None
                for line in process.stdout:
                    key, _, value = line.decode("ascii", "replace").strip().partition("=")
                    if key in PROGRESS_KEYS and value.isdigit():
                        done = int(value) / 1_000_000 / info.duration
                        self.fractions[image_id] = round(min(0.99, max(0.0, done)), 3)
                code = process.wait()
            finally:
                timer.cancel()
                self.running = None
            if code != 0 and image_id not in self.cancelled and not self.stopping:
                errors.seek(0)
                lines = errors.read().decode("utf-8", "replace").strip().splitlines()
                log.warning(
                    "Video conversion failed (ffmpeg exit %s): %s",
                    code,
                    (lines[-1] if lines else "")[:200],
                )
            return code == 0

    async def finish(self, image_id: uuid.UUID, status: str) -> bool:
        """Save the conversion's outcome; False when the image no longer exists."""
        async with self.sessions() as db:
            result: Any = await db.execute(
                update(Image)
                .where(Image.id == image_id, Image.video_status == "processing")
                .values(video_status=status),
                execution_options={"synchronize_session": False},
            )
            await db.commit()
            if result.rowcount:
                return True
            return await db.scalar(select(Image.id).where(Image.id == image_id)) is not None


def publish(partial: Path, target: Path) -> None:
    os.replace(partial, target)


def remove_file(path: Path) -> None:
    path.unlink(missing_ok=True)


def remove_folder(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
