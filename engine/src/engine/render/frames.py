"""Bounded binary preview cache, served independently of the rendering RPC loop.

Frames stay in RAM until the memory budget is reached. Older frames spill as
uncompressed RGBA to a bounded disk cache, so long playback does not require
unbounded memory. Browsers can request a bounded, lossless PNG delivery variant;
the render loop and disk spool still use raw pixels, without base64/JSON payloads.
"""

from __future__ import annotations

import io
import math
import secrets
import tempfile
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Condition, Event, RLock, Thread
from typing import Any

from PIL import Image


class BinaryFrames:
    def __init__(
        self,
        directory: Path,
        memory_limit: int = 128 * 1024**2,
        disk_limit: int = 2 * 1024**3,
        delivery_limit: int = 32 * 1024**2,
    ) -> None:
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        self.memory_limit, self.disk_limit = memory_limit, disk_limit
        # Lossless browser delivery variants are independent of the raw render
        # cache. Encoding happens on a worker, never in the render loop or while
        # a browser request is waiting for its frame.
        self.delivery_limit = delivery_limit
        self.delivery_bytes = 0
        self.delivery: OrderedDict[str, bytes | None] = OrderedDict()
        self.memory_bytes = self.disk_bytes = 0
        self.memory: OrderedDict[str, bytes] = OrderedDict()
        self.disk: OrderedDict[str, tuple[int, int]] = OrderedDict()
        # One anonymous backing file, reused as a ring. The OS releases it even
        # if the engine is killed, and a long scene cannot exhaust file handles.
        self.spool = tempfile.TemporaryFile(dir=directory)
        self.write_offset = 0
        self.records: dict[str, dict[str, Any]] = {}
        self.lock = RLock()
        self.ready = Condition(self.lock)
        self.compact_requested = False
        self.encoding: OrderedDict[str, None] = OrderedDict()
        self.encoding_active: str | None = None
        self.closing = False
        self.paced = False
        self.waiting: OrderedDict[str, int] = OrderedDict()
        self.waiting_bytes = 0
        self.token = secrets.token_urlsafe(32)
        self.cancel_key = ""
        self.seek_key = ""
        self.seek_time = 0.0
        self.seek_revision = -1
        self.cancelled = Event()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_POST(self) -> None:
                with owner.lock:
                    seek_prefix = f"/{owner.token}/seek/{owner.seek_key}/"
                    if owner.seek_key and self.path.startswith(seek_prefix):
                        try:
                            raw_time, raw_revision = self.path[
                                len(seek_prefix) :
                            ].split("/")
                            target, revision = float(raw_time), int(raw_revision)
                        except ValueError:
                            target, revision = -1, -1
                        if (
                            not math.isfinite(target)
                            or not 0 <= target <= 1e6
                            or revision < 0
                        ):
                            self.send_error(400)
                            return
                        if revision > owner.seek_revision:
                            owner.seek_time, owner.seek_revision = target, revision
                    elif self.path == f"/{owner.token}/cancel/{owner.cancel_key}":
                        owner.cancelled.set()
                        owner.ready.notify_all()
                    else:
                        self.send_error(404)
                        return
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

            def do_GET(self) -> None:
                prefix = f"/{owner.token}/"
                key = self.path[len(prefix) :] if self.path.startswith(prefix) else ""
                payload = owner.response(
                    key, "image/png" in self.headers.get("Accept", "")
                )
                if payload is None:
                    self.send_error(404)
                    return
                pixels, content_type = payload
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(pixels)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Vary", "Accept")
                self.end_headers()
                try:
                    self.wfile.write(pixels)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # The user scrubbed away before the transfer completed.

            def log_message(self, format: str, *args: Any) -> None:
                pass  # Never mix HTTP logs into the JSON-RPC stream.

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}/{self.token}/"
        self.encoder = Thread(target=self._encode_delivery, daemon=True)
        self.encoder.start()

    def begin_seek(self, time: float) -> str:
        with self.lock:
            self.seek_time = time
            self.seek_revision = -1
            self.seek_key = secrets.token_urlsafe(16)
            return self.base_url + "seek/" + self.seek_key + "/"

    def end_seek(self) -> None:
        with self.lock:
            self.seek_key = ""

    def begin_sequence(self, paced: bool = False) -> str:
        with self.lock:
            self.cancelled.clear()
            self.cancel_key = secrets.token_urlsafe(16)
            self.paced = paced
            self.waiting.clear()
            self.waiting_bytes = 0
            return self.base_url + "cancel/" + self.cancel_key

    def reserve(self, key: str, size: int) -> bool:
        """Keep live playback ahead without overwriting frames not yet viewed.

        Reading a frame acknowledges all earlier queued frames (the UI can skip
        frames to catch up). Offline sequence requests do not use backpressure.
        Half the storage budget leaves room for ring wrap and an in-flight frame.
        """
        with self.ready:
            budget = (self.memory_limit + self.disk_limit) // 2
            while (
                self.paced
                and self.waiting
                and (len(self.waiting) >= 60 or self.waiting_bytes + size > budget)
            ):
                if self.cancelled.is_set():
                    return False
                self.ready.wait(timeout=0.1)
            if self.cancelled.is_set():
                return False
            if self.paced:
                self.waiting_bytes -= self.waiting.pop(key, 0)
                self.waiting[key] = size
                self.waiting_bytes += size
            return True

    def _acknowledge(self, key: str) -> None:
        if key not in self.waiting:
            return
        while self.waiting:
            old, size = self.waiting.popitem(last=False)
            self.waiting_bytes -= size
            if old == key:
                break
        self.ready.notify_all()

    def put(self, key: str, pixels: bytes, record: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            self._remove(key)
            record = {**record, "path": self.base_url + key, "format": "rgba"}
            self.records[key] = record
            self.memory[key] = pixels
            self.memory_bytes += len(pixels)
            while self.memory_bytes > self.memory_limit and self.memory:
                old, data = self.memory.popitem(last=False)
                self.memory_bytes -= len(data)
                self._spill(old, data)
            if self.compact_requested:
                self._queue_delivery(key)
            return record

    def _spill(self, key: str, data: bytes) -> None:
        if len(data) > self.disk_limit:
            self._remove(key)
            return
        if self.write_offset + len(data) > self.disk_limit:
            self.write_offset = 0
        start, end = self.write_offset, self.write_offset + len(data)
        for old, (offset, size) in list(self.disk.items()):
            if offset < end and offset + size > start:
                self._remove(old)
        self.spool.seek(start)
        self.spool.write(data)
        self.disk[key] = (start, len(data))
        self.disk_bytes += len(data)
        self.write_offset = end

    def record(self, key: str) -> dict[str, Any] | None:
        with self.lock:
            record = self.records.get(key)
            return {**record, "render_ms": 0} if record else None

    def read(self, key: str, *, acknowledge: bool = True) -> bytes | None:
        with self.lock:
            if key in self.memory:
                self.memory.move_to_end(key)
                if acknowledge:
                    self._acknowledge(key)
                return self.memory[key]
            if key in self.disk:
                self.disk.move_to_end(key)
                offset, size = self.disk[key]
                self.spool.seek(offset)
                if acknowledge:
                    self._acknowledge(key)
                return self.spool.read(size)
            return None

    def _remove(self, key: str) -> None:
        self.encoding.pop(key, None)
        image = self.delivery.pop(key, None)
        if image is not None:
            self.delivery_bytes -= len(image)
        if key in self.memory:
            self.memory_bytes -= len(self.memory.pop(key))
        if key in self.disk:
            self.disk_bytes -= self.disk.pop(key)[1]
        self.records.pop(key, None)

    def response(self, key: str, compact: bool) -> tuple[bytes, str] | None:
        """Negotiate lossless PNG for sparse frames; retain raw for noisy images.

        A 1080p RGBA frame is 8 MB even when almost entirely black. Sending a
        compact image lets Chromium decode off the UI thread and avoids moving
        hundreds of MB per second through its network/JavaScript boundary.
        """
        with self.ready:
            if compact and (image := self.delivery.get(key)) is not None:
                self.delivery.move_to_end(key)
                self._acknowledge(key)
                return image, "image/png"
            if compact:
                self.compact_requested = True
                self._queue_delivery(key, priority=True)
            pixels = self.read(key)
            return (pixels, "application/octet-stream") if pixels is not None else None

    def _queue_delivery(self, key: str, priority: bool = False) -> None:
        record = self.records.get(key)
        if (
            self.closing
            or key in self.delivery
            or key == self.encoding_active
            or not record
            or not record.get("width")
            or not record.get("height")
        ):
            return
        if key in self.encoding:
            if priority:
                self.encoding.move_to_end(key, last=False)
            return
        # Queue keys only, not extra pixel buffers. Rendering never waits for
        # encoding, and high-entropy/long scenes cannot grow this work queue.
        if len(self.encoding) >= 16:
            if not priority:
                return
            self.encoding.popitem()
        self.encoding[key] = None
        if priority:
            self.encoding.move_to_end(key, last=False)
        self.ready.notify_all()

    def _encode_delivery(self) -> None:
        while True:
            with self.ready:
                self.ready.wait_for(lambda: self.closing or bool(self.encoding))
                if self.closing:
                    return
                key, _ = self.encoding.popitem(last=False)
                self.encoding_active = key
                record = self.records.get(key)
                # Preparation is not consumption: don't release playback's
                # backpressure until the browser actually fetches a frame.
                pixels = self.read(key, acknowledge=False)
            image = None
            try:
                if pixels is not None and record is not None:
                    width, height = record["width"], record["height"]
                    if width > 0 and height > 0 and width * height * 4 == len(pixels):
                        buffer = io.BytesIO()
                        Image.frombytes("RGBA", (width, height), pixels).save(
                            buffer, format="PNG", compress_level=1
                        )
                        candidate = buffer.getvalue()
                        if len(candidate) < len(pixels) * 0.75:
                            image = candidate
            except (OSError, ValueError):
                pass  # Raw delivery remains available if encoding fails.
            with self.ready:
                self.encoding_active = None
                if (
                    not self.closing
                    and record is not None
                    and self.records.get(key) is record
                ):
                    self.delivery[key] = image
                    self.delivery_bytes += len(image) if image is not None else 0
                    while self.delivery_bytes > self.delivery_limit:
                        _, old = self.delivery.popitem(last=False)
                        self.delivery_bytes -= len(old) if old is not None else 0
                self.ready.notify_all()

    def close(self) -> None:
        with self.ready:
            self.closing = True
            self.encoding.clear()
            self.cancelled.set()
            self.ready.notify_all()
        self.encoder.join()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        with self.lock:
            for key in list(self.records):
                self._remove(key)
            self.spool.close()
