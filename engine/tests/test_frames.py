from pathlib import Path
from threading import Event, Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
import pytest
from PIL import Image

from engine.catalogue import Catalogue
from engine.document import SceneDocument, Settings
from engine.render import RenderService
from engine.render.device import RenderDevice
from engine.render.frames import BinaryFrames


def test_binary_cache_spills_and_evicts_with_bounded_storage(tmp_path: Path) -> None:
    cache = BinaryFrames(tmp_path, memory_limit=8, disk_limit=8)
    try:
        one = cache.put("one", b"12345678", {})
        cache.put("two", b"abcdefgh", {})
        assert cache.memory_bytes == cache.disk_bytes == 8
        with urlopen(one["path"]) as response:
            assert response.read() == b"12345678"
        cache.put("three", b"ABCDEFGH", {})
        assert cache.read("one") is None and cache.record("one") is None
        assert cache.memory_bytes == cache.disk_bytes == 8
        assert cache.read("two") == b"abcdefgh"
        # Paths are looked up in the cache, never interpreted as arbitrary files.
        for url in (
            cache.base_url + "../outside",
            one["path"].replace(cache.token, "bad"),
        ):
            with pytest.raises(HTTPError) as error:
                urlopen(url)
            assert error.value.code == 404
    finally:
        cache.close()
    assert list(tmp_path.iterdir()) == []


def test_cancel_control_is_scoped_to_one_sequence(tmp_path: Path) -> None:
    cache = BinaryFrames(tmp_path)
    try:
        old = cache.begin_sequence()
        with urlopen(Request(old, method="POST")) as response:
            assert response.status == 204
        assert cache.cancelled.is_set()
        current = cache.begin_sequence()
        with pytest.raises(HTTPError):
            urlopen(Request(old, method="POST"))
        assert not cache.cancelled.is_set()
        with urlopen(Request(current, method="POST")):
            pass
        assert cache.cancelled.is_set()
    finally:
        cache.close()


def test_playback_backpressure_waits_for_reader_and_can_cancel(tmp_path: Path) -> None:
    cache = BinaryFrames(tmp_path, memory_limit=8, disk_limit=24)
    blocked = [Event(), Event()]
    done = Event()
    produced: list[int] = []
    cancel = cache.begin_sequence(paced=True)

    def produce() -> None:
        try:
            for index in range(6):
                if index in (2, 4):
                    blocked[index // 2 - 1].set()
                if not cache.reserve(str(index), 8):
                    return
                cache.put(str(index), bytes([index]) * 8, {})
                produced.append(index)
        finally:
            done.set()

    worker = Thread(target=produce)
    worker.start()
    try:
        assert blocked[0].wait(2)
        assert not done.wait(0.05)
        assert produced == [0, 1]
        # The UI skips frame zero. Fetching one releases both queue slots.
        with urlopen(cache.base_url + "1") as response:
            assert response.read() == bytes([1]) * 8
        assert blocked[1].wait(2)
        assert produced == [0, 1, 2, 3]
        assert cache.read("2") == bytes([2]) * 8
        # Stop must also interrupt a producer waiting for the viewer.
        with urlopen(Request(cancel, method="POST")):
            pass
        assert done.wait(2)
        assert cache.memory_bytes <= 8 and cache.disk_bytes <= 24
    finally:
        cache.cancelled.set()
        worker.join(timeout=2)
        cache.close()


@pytest.mark.parametrize("device", [RenderDevice(), None])
def test_binary_preview_preserves_pixels_and_does_not_encode_png(
    tmp_path: Path,
    catalogue: Catalogue,
    simple_scene: SceneDocument,
    monkeypatch: pytest.MonkeyPatch,
    device: RenderDevice | None,
) -> None:
    settings = Settings(pixel_width=256, pixel_height=144, frame_rate=15)
    png = RenderService(tmp_path / "png", device)
    reference = png.frame(simple_scene, catalogue, settings, 0.5)
    expected = np.asarray(Image.open(reference.path)).tobytes()
    binary = RenderService(tmp_path / "raw", device, binary=True)
    try:

        def no_png(*args: object, **kwargs: object) -> None:
            raise AssertionError("Preview invoked a PNG encoder")

        monkeypatch.setattr(Image.Image, "save", no_png)
        result = binary.frame(simple_scene, catalogue, settings, 0.5)
        assert result.format == "rgba" and (result.width, result.height) == (256, 144)
        with urlopen(result.path) as response:
            assert response.read() == expected
        assert not list(binary.cache_dir.rglob("*.png"))
        assert not list(binary.cache_dir.rglob("*.json"))
        hit = binary.frame(simple_scene, catalogue, settings, 0.5)
        assert binary.render_count == 1 and hit.render_ms == 0
    finally:
        binary.close()


def test_binary_sequence_can_cancel_while_render_rpc_is_busy(
    tmp_path: Path,
    catalogue: Catalogue,
    simple_scene: SceneDocument,
) -> None:
    service = RenderService(tmp_path, RenderDevice(), binary=True)
    cancel = ""
    received = []

    def started(url: str) -> None:
        nonlocal cancel
        cancel = url

    def ready(frame: object) -> None:
        received.append(frame)
        if len(received) == 3:
            with urlopen(Request(cancel, method="POST")):
                pass

    try:
        result = service.sequence(
            simple_scene,
            catalogue,
            Settings(pixel_width=256, pixel_height=144),
            0,
            2,
            on_start=started,
            on_frame=ready,
        )
        assert result.frames == 3
        assert result.cancelled and not result.cache_complete
        assert len(received) == 3
    finally:
        service.close()
