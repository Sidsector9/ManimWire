"""Scrubbing must preserve state accumulated during uninterrupted playback."""

from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import pytest
from manim import config

from engine.catalogue import Catalogue
from engine.codegen import GeneratedCode, SourceMap
from engine.document import Document, SceneDocument, Settings
from engine.render import RenderError, RenderService
from engine.render.device import detect_device
from engine.render.opengl import EditorOpenGLRenderer
from engine.render.runner import run_scene
from engine.render.seeking import SeekSession


@pytest.mark.parametrize(
    "body",
    [
        "c = Circle(fill_opacity=.8)\nself.play(Create(c), run_time=2)",
        "self.play(Write(Axes().add_coordinates()), run_time=2)",
        "c = Circle(fill_opacity=.8)\n"
        "self.play(Create(c), run_time=1)\n"
        "self.play(Transform(c, Square(fill_opacity=.4)), run_time=1)",
        "c = Dot()\n"
        "c.add_updater(lambda m, dt: m.shift(dt * RIGHT))\n"
        "p = TracedPath(c.get_center)\n"
        "l = always_redraw(lambda: Line(ORIGIN, c.get_center()))\n"
        "self.add(c, p, l)\n"
        "self.wait(1)\n"
        "self.wait(1)",
        "self.set_camera_orientation(phi=75*DEGREES, theta=30*DEGREES)\n"
        "self.add(ThreeDAxes(), Circle())\n"
        "self.begin_3dillusion_camera_rotation(rate=2)\n"
        "self.wait(1.5)\n"
        "self.stop_3dillusion_camera_rotation()\n"
        "self.wait(.5)",
        "c = Dot()\n"
        "c.add_updater(lambda m, dt: m.shift(np.random.uniform(-1, 1)*dt*RIGHT))\n"
        "self.add(c)\n"
        "self.wait(2)",
        "image = ImageMobject(np.full((8, 8, 3), [255, 128, 0], dtype=np.uint8))\n"
        "self.play(FadeIn(image), run_time=1)\n"
        "self.play(image.animate.shift(RIGHT), run_time=1)",
        "surface = Surface(lambda u, v: np.array([u, v, .2*u*v]),\n"
        "                  u_range=[-1, 1], v_range=[-1, 1], resolution=(4, 4))\n"
        "self.add(surface)\n"
        "self.begin_ambient_camera_rotation(rate=.2)\n"
        "self.wait(2)",
    ],
)
def test_resumed_seeks_match_uninterrupted_frames(
    body: str, catalogue: Catalogue
) -> None:
    device = detect_device()
    if device.renderer != "opengl":
        pytest.skip("Requires OpenGL")
    generated = GeneratedCode(
        code="from manim import *\n"
        "import numpy as np\n"
        "class Test(ThreeDScene):\n"
        "    def construct(self):\n"
        "        np.random.seed(17)\n"
        + "\n".join("        " + line for line in body.splitlines()),
        source_map=SourceMap(),
    )
    overrides = dict(
        renderer="opengl",
        dry_run=True,
        preview=False,
        pixel_width=256,
        pixel_height=144,
        frame_rate=15,
        progress_bar="none",
        verbosity="ERROR",
    )
    expected: dict[int, np.ndarray] = {}
    _, _, reference = run_scene(
        generated,
        "Test",
        overrides,
        lambda _: EditorOpenGLRenderer(
            backend=device.backend,
            on_frame=lambda i, t, p, s: expected.__setitem__(i, p.copy()),
        ),
    )
    session = SeekSession(generated, "Test", overrides, device.backend)
    original_renderer = config.renderer
    try:
        for index in [3, 7, 12, 19, 27]:
            # Interleaved work must not perturb the suspended scene's RNG state.
            np.random.random(10)

            def target(index: int = index) -> float:
                return index / 15

            _, _, pixels = session.advance(target)
            assert np.array_equal(pixels, expected[index]), (
                body,
                index,
                np.count_nonzero(pixels != expected[index]),
            )
            assert config.renderer == original_renderer
            assert (
                session.renderer is not None and session.renderer.resources is not None
            )
            assert not session.renderer.resources.active
        assert session.draws == 5
        assert session.updates == 27
        _, _, final = session.advance(lambda: 1e6)
        assert np.array_equal(final, reference.get_frame())
    finally:
        session.close()


def test_background_preparation_caches_scrub_frames_and_edits_invalidate(
    tmp_path: Path,
    catalogue: Catalogue,
    simple_scene: SceneDocument,
) -> None:
    device = detect_device()
    if device.renderer != "opengl":
        pytest.skip("Requires OpenGL")
    service = RenderService(tmp_path, device, binary=True)
    settings = Settings(pixel_width=256, pixel_height=144, frame_rate=15)
    try:
        service.frame(simple_scene, catalogue, settings, 1e6)
        service.sequence(simple_scene, catalogue, settings, 0, 2)
        runs = service.render_count
        for at in [1.5, 0.5, 1.0, 0.2]:
            frame = service.frame(simple_scene, catalogue, settings, at)
            assert frame.render_ms == 0
        assert service.render_count == runs
        service.frame(simple_scene, catalogue, settings, 0.6, width=288)
        before = service.seek
        service.frame(simple_scene, catalogue, settings, 0.6, width=320)
        assert service.seek is not before and before is not None and before.closed
        before = service.seek
        simple_scene.nodes[0].values["radius"] = 3
        service.frame(simple_scene, catalogue, settings, 0.6, width=320)
        assert service.seek is not before and before is not None and before.closed
    finally:
        service.close()


def test_busy_seek_retargets_backwards_at_next_update(
    tmp_path: Path,
    catalogue: Catalogue,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    device = detect_device()
    if device.renderer != "opengl":
        pytest.skip("Requires OpenGL")
    doc = Document.model_validate_json(
        (
            Path(__file__).parents[2] / "examples/7.sine-curve-unit-circle.mnw"
        ).read_text()
    )
    service = RenderService(tmp_path, device, binary=True)
    url = ""
    changed = False
    ticks = 0
    original = SeekSession.tick

    def started(value: str) -> None:
        nonlocal url
        url = value

    def tick(session: SeekSession, scene: object) -> None:
        nonlocal changed, ticks
        ticks += 1
        if not changed and session.time >= 1:
            changed = True
            with urlopen(Request(url + "0.2/1", method="POST")):
                pass
        original(session, scene)

    monkeypatch.setattr(SeekSession, "tick", tick)
    try:
        frame = service.frame(
            doc.scenes[0],
            catalogue,
            doc.settings,
            8,
            width=256,
            groups=doc.groups,
            on_start=started,
        )
        assert frame.time == pytest.approx(0.2)
        assert ticks < 90  # The abandoned seek must not advance to 8 seconds.
        cached = service.frame(
            doc.scenes[0], catalogue, doc.settings, 0.2, width=256, groups=doc.groups
        )
        assert cached.path == frame.path and cached.render_ms == 0
        assert service.frames is not None and service.frames.seek_key == ""
    finally:
        service.close()


def test_sine_example_matches_full_history_before_and_after_wait_boundary(
    tmp_path: Path,
    catalogue: Catalogue,
) -> None:
    device = detect_device()
    if device.renderer != "opengl":
        pytest.skip("Requires OpenGL")
    doc = Document.model_validate_json(
        (
            Path(__file__).parents[2] / "examples/7.sine-curve-unit-circle.mnw"
        ).read_text()
    )
    service = RenderService(tmp_path, device, binary=True)
    generated = service.generator.generate(doc.scenes[0], catalogue, doc.groups)
    expected: dict[int, np.ndarray] = {}

    def collect(index: int, time: float, pixels: np.ndarray, scene: object) -> None:
        if index in (60, 240, 480, 570):
            expected[index] = pixels.copy()

    _, _, reference = run_scene(
        generated,
        doc.scenes[0].name,
        dict(
            renderer="opengl",
            dry_run=True,
            preview=False,
            pixel_width=256,
            pixel_height=144,
            frame_rate=60,
            progress_bar="none",
            verbosity="ERROR",
        ),
        lambda _: EditorOpenGLRenderer(backend=device.backend, on_frame=collect),
    )
    try:
        for at in [1, 4, 8, 9.5, 1e6]:
            frame = service.frame(
                doc.scenes[0], catalogue, doc.settings, at, width=256, groups=doc.groups
            )
            with urlopen(frame.path) as response:
                actual = np.frombuffer(response.read(), dtype=np.uint8).reshape(
                    144, 256, 4
                )
            pixels = reference.get_frame() if at == 1e6 else expected[round(at * 60)]
            assert np.array_equal(actual, pixels), at
        assert service.render_count == 1
    finally:
        service.close()


def test_seek_error_releases_state_and_next_preview_recovers(
    tmp_path: Path,
    catalogue: Catalogue,
    simple_scene: SceneDocument,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    device = detect_device()
    if device.renderer != "opengl":
        pytest.skip("Requires OpenGL")
    service = RenderService(tmp_path, device, binary=True)
    bad = GeneratedCode(
        code="from manim import *\nclass BlueCircle(Scene):\n"
        "    def construct(self):\n        self.add(Circle())\n"
        "        self.wait(.1)\n        1 / 0",
        source_map=SourceMap(),
    )
    try:
        with monkeypatch.context() as patcher:
            patcher.setattr(service, "_generate", lambda *args: bad)
            with pytest.raises(RenderError, match="division by zero"):
                service.frame(simple_scene, catalogue, Settings(), 1)
        assert service.seek is None
        assert service.frames is not None and service.frames.seek_key == ""
        frame = service.frame(simple_scene, catalogue, Settings(), 0.2, width=256)
        assert frame.format == "rgba"
    finally:
        service.close()
