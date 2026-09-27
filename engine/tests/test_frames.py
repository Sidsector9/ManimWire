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


def test_seek_control_ignores_out_of_order_and_expired_updates(tmp_path: Path) -> None:
    cache = BinaryFrames(tmp_path)
    try:
        url = cache.begin_seek(8)
        for suffix in ("2/2", "7/1"):
            with urlopen(Request(url + suffix, method="POST")):
                pass
        assert cache.seek_time == 2
        for suffix in ("nan/3", "-1/3", "bad", "inf/3"):
            with pytest.raises(HTTPError) as error:
                urlopen(Request(url + suffix, method="POST"))
            assert error.value.code == 400
        cache.end_seek()
        with pytest.raises(HTTPError) as error:
            urlopen(Request(url + "4/4", method="POST"))
        assert error.value.code == 404
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


def test_compact_delivery_is_lossless_bounded_and_invalidated(tmp_path: Path) -> None:
    import io

    pixels = np.zeros((48, 64, 4), dtype=np.uint8)
    pixels[:, :, 3] = 255
    pixels[10:30, 10:20] = [255, 64, 32, 128]
    raw = pixels.tobytes()
    cache = BinaryFrames(
        tmp_path, memory_limit=len(raw), disk_limit=0, delivery_limit=4096
    )
    try:
        record = cache.put("one", raw, {"width": 64, "height": 48})
        with urlopen(
            Request(record["path"], headers={"Accept": "image/png"})
        ) as response:
            initial = response.read()
            assert response.headers["Content-Type"] == "application/octet-stream"
            assert initial == raw
        with cache.ready:
            assert cache.ready.wait_for(lambda: "one" in cache.delivery, timeout=3)
        with urlopen(
            Request(record["path"], headers={"Accept": "image/png"})
        ) as response:
            assert response.headers["Content-Type"] == "image/png"
            assert np.array_equal(
                np.asarray(Image.open(io.BytesIO(response.read()))), pixels
            )
        # Raw consumers still receive exactly RGBA, regardless of PNG preparation.
        with urlopen(record["path"]) as response:
            assert response.read() == raw
        assert 0 < cache.delivery_bytes <= cache.delivery_limit
        cache.put("two", raw, {"width": 64, "height": 48})
        assert "one" not in cache.delivery  # Raw eviction invalidates its variant.
        assert cache.response("one", True) is None
    finally:
        cache.close()
    assert cache.delivery_bytes == 0
    assert not cache.encoder.is_alive()


def test_delivery_preparation_never_blocks_requests_or_acknowledges_future_frames(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    entered, release = Event(), Event()
    save = Image.Image.save

    def slow_save(*args: object, **kwargs: object) -> None:
        entered.set()
        assert release.wait(3)
        save(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(Image.Image, "save", slow_save)
    cache = BinaryFrames(tmp_path)
    raw = bytes([0, 0, 0, 255]) * 64 * 48
    try:
        cache.put("first", raw, {"width": 64, "height": 48})
        assert cache.response("first", True) == (raw, "application/octet-stream")
        assert entered.wait(2)
        # Encoding is deliberately blocked, but the HTTP fallback still returns.
        assert cache.response("first", True) == (raw, "application/octet-stream")
        cache.begin_sequence(paced=True)
        assert cache.reserve("future", len(raw))
        cache.put("future", raw, {"width": 64, "height": 48})
        release.set()
        with cache.ready:
            assert cache.ready.wait_for(lambda: "future" in cache.delivery, timeout=3)
            assert "future" in cache.waiting
        assert cache.response("future", True)[1] == "image/png"  # type: ignore[index]
        assert not cache.waiting
    finally:
        release.set()
        cache.close()


def test_noisy_frames_keep_raw_delivery(tmp_path: Path) -> None:
    cache = BinaryFrames(tmp_path)
    raw = (
        np.random.default_rng(1).integers(0, 256, (48, 64, 4), dtype=np.uint8).tobytes()
    )
    try:
        cache.put("noise", raw, {"width": 64, "height": 48})
        cache.response("noise", True)
        with cache.ready:
            assert cache.ready.wait_for(lambda: "noise" in cache.delivery, timeout=3)
        assert cache.delivery["noise"] is None
        assert cache.delivery_bytes == 0
        assert cache.response("noise", True) == (raw, "application/octet-stream")
    finally:
        cache.close()


def test_delivery_budget_does_not_retain_oversized_images(tmp_path: Path) -> None:
    cache = BinaryFrames(tmp_path, delivery_limit=32)
    raw = bytes([0, 0, 0, 255]) * 64 * 48
    try:
        cache.put("large", raw, {"width": 64, "height": 48})
        cache.response("large", True)
        with cache.ready:
            assert cache.ready.wait_for(
                lambda: cache.encoding_active is None and not cache.encoding, timeout=3
            )
        assert not cache.delivery
        assert cache.delivery_bytes == 0
        assert cache.read("large") == raw
    finally:
        cache.close()
