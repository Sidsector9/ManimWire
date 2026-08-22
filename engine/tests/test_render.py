from __future__ import annotations

import subprocess
import sys
import threading
from pathlib import Path
from typing import BinaryIO, cast

import pytest
from PIL import Image

from engine.__main__ import build_dispatcher
from engine.catalogue import Catalogue
from engine.codegen import SourceMap
from engine.document import (
    Document,
    Node,
    SceneDocument,
    Settings,
    SoundStep,
    SubcaptionStep,
    WaitStep,
)
from engine.render import CairoRenderService, RenderError
from engine.render.runner import locate as _locate
from engine.rpc import read_message, write_message

SMALL = Settings(pixel_width=256, pixel_height=144, frame_rate=15)


@pytest.fixture
def service(tmp_path: Path) -> CairoRenderService:
    return CairoRenderService(tmp_path)


def test_frame_at_start_and_end_of_the_animation(
    service: CairoRenderService, catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    start = service.frame(simple_scene, catalogue, SMALL, 0.0)
    end = service.frame(simple_scene, catalogue, SMALL, 2.0)
    assert start.path != end.path
    for result in (start, end):
        with Image.open(result.path) as image:
            assert image.size == (256, 144)
    with Image.open(end.path) as image:
        pixel = image.getpixel((128, 72))
        assert isinstance(pixel, tuple) and pixel[:3] == (88, 196, 221)
    assert end.time == pytest.approx(2.0, abs=1 / 15)
    bounds = {b.node: b for b in end.bounds}
    assert bounds["c"].width == pytest.approx(4.0, abs=0.01)
    assert bounds["c"].center == pytest.approx((0.0, 0.0), abs=0.01)
    assert bounds["c"].on_screen is True
    assert "f" in bounds  # set_fill shares the circle's variable


def test_frame_beyond_the_end_reports_the_scene_duration(
    service: CairoRenderService, catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    simple_scene.steps.append(WaitStep(duration=1.0))
    result = service.frame(simple_scene, catalogue, SMALL, 99.0)
    assert result.time == pytest.approx(3.0, abs=1 / 15)


def test_repeated_frame_requests_are_served_from_the_cache(
    service: CairoRenderService, catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    first = service.frame(simple_scene, catalogue, SMALL, 1.0)
    second = service.frame(simple_scene, catalogue, SMALL, 1.0)
    assert first == second
    assert service.render_count == 1
    simple_scene.nodes[0].values["radius"] = 1.0
    changed = service.frame(simple_scene, catalogue, SMALL, 1.0)
    assert changed.path != first.path
    assert service.render_count == 2


def test_syntax_error_location_comes_from_the_exception() -> None:
    try:
        compile("def (:\n", "<scene>", "exec")
    except SyntaxError as exc:
        located = _locate(exc, SourceMap(nodes={"n": [1]}))
    assert located.line == 1
    assert located.node == "n"


def test_export_gif_and_png(
    service: CairoRenderService,
    catalogue: Catalogue,
    simple_scene: SceneDocument,
    tmp_path: Path,
) -> None:
    gif = service.export(simple_scene, catalogue, SMALL, tmp_path, fmt="gif")
    assert Path(gif.path).name == "BlueCircle.gif"
    png = service.export(simple_scene, catalogue, SMALL, tmp_path, fmt="png")
    assert Path(png.path).name == "BlueCircle.png"
    with Image.open(png.path) as image:
        assert image.size == (256, 144)
    with pytest.raises(RenderError, match="unsupported export format"):
        service.export(simple_scene, catalogue, SMALL, tmp_path, fmt="avi")


def test_preview_width_keeps_the_aspect_ratio(
    service: CairoRenderService, catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    result = service.frame(simple_scene, catalogue, Settings(), 0.0, width=320)
    with Image.open(result.path) as image:
        assert image.size == (320, 180)


def test_manim_error_names_the_node_and_line(
    service: CairoRenderService, catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    simple_scene.nodes[1].values["color"] = (
        "#GGGGGG"  # passes validation, fails in Manim
    )
    with pytest.raises(RenderError) as info:
        service.frame(simple_scene, catalogue, SMALL, 0.0)
    assert info.value.node == "f"
    assert info.value.line == 7
    assert "ValueError" in str(info.value)


def test_invalid_document_is_refused_before_rendering(
    service: CairoRenderService, catalogue: Catalogue
) -> None:
    scene = SceneDocument(nodes=[Node(id="f", catalogue="VMobject.set_fill")])
    with pytest.raises(RenderError) as info:
        service.frame(scene, catalogue, SMALL, 0.0)
    assert info.value.node == "f"


def test_export_writes_a_video_and_reports_progress(
    service: CairoRenderService,
    catalogue: Catalogue,
    simple_scene: SceneDocument,
    tmp_path: Path,
) -> None:
    times: list[float] = []
    result = service.export(
        simple_scene, catalogue, SMALL, tmp_path / "out", progress=times.append
    )
    output = Path(result.path)
    assert output == tmp_path / "out" / "BlueCircle.mp4"
    assert output.stat().st_size > 1000
    assert result.duration == pytest.approx(2.0, abs=1 / 15)
    assert times == sorted(times) and times[-1] == pytest.approx(2.0, abs=1 / 15)
    assert list((tmp_path / "out").iterdir()) == [output]


def test_render_error_reaches_rpc_with_location(
    simple_scene: SceneDocument, tmp_path: Path
) -> None:
    simple_scene.nodes[1].values["color"] = "#GGGGGG"
    dispatcher = build_dispatcher(tmp_path)
    document = Document(scenes=[simple_scene], settings=SMALL).model_dump()
    response = dispatcher.handle(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "render.frame",
            "params": {"document": document, "scene": "BlueCircle", "time": 0.0},
        }
    )
    assert response is not None
    assert response["error"]["code"] == -32000
    assert response["error"]["data"] == {"node": "f", "step": None, "line": 7}


def test_engine_process_keeps_the_protocol_clean(
    simple_scene: SceneDocument, tmp_path: Path
) -> None:
    """Manim logs must not corrupt stdout: render through a real engine process."""
    process = subprocess.Popen(
        [sys.executable, "-m", "engine"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=Path(__file__).resolve().parents[1],
    )
    stdin = cast(BinaryIO, process.stdin)
    stdout = cast(BinaryIO, process.stdout)
    document = Document(scenes=[simple_scene], settings=SMALL).model_dump()
    watchdog = threading.Timer(120, process.kill)
    watchdog.start()
    try:
        write_message(stdin, {"jsonrpc": "2.0", "id": 1, "method": "engine.info"})
        write_message(
            stdin,
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "render.export",
                "params": {
                    "document": document,
                    "scene": "BlueCircle",
                    "directory": str(tmp_path),
                },
            },
        )
        stdin.close()
        messages = []
        while (message := read_message(stdout)) is not None:
            messages.append(message)
        assert process.wait(timeout=30) == 0
    finally:
        watchdog.cancel()
        process.kill()
    assert messages[0]["result"]["manim"] == "0.21.0"
    progress = [m for m in messages if m.get("method") == "render.progress"]
    assert progress and progress[0]["params"]["scene"] == "BlueCircle"
    assert Path(messages[-1]["result"]["path"]).exists()


def test_preview_ignores_subtitles_and_missing_sounds(
    service: CairoRenderService, catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    simple_scene.steps.insert(0, SoundStep(file="missing.wav"))
    simple_scene.steps.append(SubcaptionStep(content="a circle", duration=1.0))
    result = service.frame(simple_scene, catalogue, SMALL, 2.0)
    assert Path(result.path).exists()
    assert not list(Path.cwd().glob("*.srt"))


def test_export_keeps_the_subtitle_file_next_to_the_video(
    service: CairoRenderService,
    catalogue: Catalogue,
    simple_scene: SceneDocument,
    tmp_path: Path,
) -> None:
    simple_scene.steps.append(SubcaptionStep(content="a circle", duration=1.0))
    result = service.export(simple_scene, catalogue, SMALL, tmp_path / "out")
    assert result.subtitles == str(tmp_path / "out" / "BlueCircle.srt")
    assert "a circle" in Path(result.subtitles).read_text()
    assert sorted(p.name for p in (tmp_path / "out").iterdir()) == [
        "BlueCircle.mp4",
        "BlueCircle.srt",
    ]
