"""Bounded binary preview cache, served independently of the rendering RPC loop.

Frames stay in RAM until the memory budget is reached. Older frames spill as
uncompressed RGBA to a bounded disk cache, so long playback does not require
unbounded memory. Neither path uses an image codec or base64/JSON pixel payloads.
"""

from __future__ import annotations

import secrets
import tempfile
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Condition, Event, RLock, Thread
from typing import Any


class BinaryFrames:
    def __init__(
        self,
        directory: Path,
        memory_limit: int = 128 * 1024**2,
        disk_limit: int = 2 * 1024**3,
    ) -> None:
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        self.memory_limit, self.disk_limit = memory_limit, disk_limit
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
        self.paced = False
        self.waiting: OrderedDict[str, int] = OrderedDict()
        self.waiting_bytes = 0
        self.token = secrets.token_urlsafe(32)
        self.cancel_key = ""
        self.cancelled = Event()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_POST(self) -> None:
                with owner.lock:
                    if self.path != f"/{owner.token}/cancel/{owner.cancel_key}":
                        self.send_error(404)
                        return
                    owner.cancelled.set()
                    owner.ready.notify_all()
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

            def do_GET(self) -> None:
                prefix = f"/{owner.token}/"
                key = self.path[len(prefix) :] if self.path.startswith(prefix) else ""
                pixels = owner.read(key)
                if pixels is None:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(pixels)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-store")
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
            return record

    def _spill(self, key: str, data: bytes) -> None:
        if len(data) > self.disk_limit:
            self.records.pop(key, None)
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

    def read(self, key: str) -> bytes | None:
        with self.lock:
            if key in self.memory:
                self.memory.move_to_end(key)
                self._acknowledge(key)
                return self.memory[key]
            if key in self.disk:
                self.disk.move_to_end(key)
                offset, size = self.disk[key]
                self.spool.seek(offset)
                self._acknowledge(key)
                return self.spool.read(size)
            return None

    def _remove(self, key: str) -> None:
        if key in self.memory:
            self.memory_bytes -= len(self.memory.pop(key))
        if key in self.disk:
            self.disk_bytes -= self.disk.pop(key)[1]
        self.records.pop(key, None)

    def close(self) -> None:
        with self.ready:
            self.cancelled.set()
            self.ready.notify_all()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        with self.lock:
            for key in list(self.records):
                self._remove(key)
            self.spool.close()
