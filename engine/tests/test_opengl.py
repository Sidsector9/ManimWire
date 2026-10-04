"""Exercise the selected renderer and its real GPU path when available."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import patch

import av
import numpy as np
import pytest
from PIL import Image

from engine.catalogue import Catalogue
from engine.codegen import GeneratedCode, SourceMap
from engine.document import SceneDocument, Settings, WaitStep
from engine.render import CairoRenderService, FrameResult, RenderService
from engine.render.device import RenderDevice, acceleration_for, detect_device
from engine.render.opengl import EditorOpenGLRenderer
from engine.render.runner import run_scene

SMALL = Settings(pixel_width=256, pixel_height=144, frame_rate=15)


@pytest.fixture
def gl_service(tmp_path: Path) -> RenderService:
    device = detect_device()
    if device.renderer != "opengl":
        pytest.skip(device.reason or "OpenGL not available")
    return RenderService(tmp_path, device)


@pytest.mark.parametrize(
    ("vendor", "name", "expected"),
    [
        ("Apple", "Apple M3 Pro", "hardware"),
        ("Intel", "Intel UHD Graphics", "hardware"),
        ("NVIDIA", "GeForce RTX", "hardware"),
        ("Mesa", "llvmpipe (LLVM 15)", "software"),
        ("Google", "SwiftShader", "software"),
        ("unknown", "virtual adapter", "unknown"),
    ],
)
def test_driver_classification(vendor: str, name: str, expected: str) -> None:
    assert acceleration_for(vendor, name) == expected


def probe_result(name: str, vendor: str = "Mesa") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(
        [],
        0,
        json.dumps(
            {
                "GL_RENDERER": name,
                "GL_VENDOR": vendor,
                "GL_VERSION": "4.1",
            }
        ),
        "",
    )


def test_probe_prefers_hardware_over_software() -> None:
    with patch(
        "engine.render.device.subprocess.run",
        side_effect=[
            probe_result("llvmpipe"),
            probe_result("Intel UHD", "Intel"),
        ],
    ):
        result = detect_device.__wrapped__()
    assert result.renderer == "opengl"
    assert result.acceleration == "hardware" and result.backend == "egl"


def test_probe_retains_software_when_hardware_is_unavailable() -> None:
    with patch(
        "engine.render.device.subprocess.run",
        side_effect=[
            probe_result("llvmpipe"),
            subprocess.CalledProcessError(1, "probe"),
        ],
    ):
        result = detect_device.__wrapped__()
    assert result.renderer == "opengl" and result.acceleration == "software"


def test_probe_failure_falls_back_to_cairo() -> None:
    with patch(
        "engine.render.device.subprocess.run",
        side_effect=subprocess.TimeoutExpired("probe", 10),
    ):
        result = detect_device.__wrapped__()
    assert result.renderer == "cairo" and result.reason


def test_frozen_probe_uses_engine_entry_point() -> None:
    with (
        patch("engine.render.device.sys.frozen", True, create=True),
        patch(
            "engine.render.device.subprocess.run",
            return_value=probe_result("Apple GPU", "Apple"),
        ) as run,
    ):
        result = detect_device.__wrapped__()
    assert run.call_args.args[0][1:] == ["--probe-device", "default"]
    assert result.acceleration == "hardware"


def test_no_gl_fallback_still_renders(
    tmp_path: Path, catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    service = RenderService(tmp_path, RenderDevice(reason="No driver"))
    frame = service.frame(simple_scene, catalogue, SMALL, 0.5)
    assert Path(frame.path).is_file()


def test_frame_sequence_scrubbing_and_renderer_cache_separation(
    gl_service: RenderService,
    catalogue: Catalogue,
    simple_scene: SceneDocument,
) -> None:
    # Include a frozen wait: it must produce frames and obey scrub stop times too.
    simple_scene.steps.append(WaitStep(duration=1))
    frames: list[FrameResult] = []
    sequence = gl_service.sequence(
        simple_scene, catalogue, SMALL, 0.5, 2.5, on_frame=frames.append
    )
    assert sequence.frames == len(frames) == 31
    assert frames[0].time == pytest.approx(8 / 15)
    assert frames[-1].time == pytest.approx(38 / 15)
    count = gl_service.render_count
    cached = gl_service.frame(simple_scene, catalogue, SMALL, 0.75)
    assert gl_service.render_count == count
    assert cached.time == pytest.approx(0.8)
    assert next(b for b in cached.bounds if b.node == "c").on_screen
    # An independent render must match the frame emitted during playback.
    independent = RenderService(gl_service.cache_dir / "independent", gl_service.device)
    direct = independent.frame(simple_scene, catalogue, SMALL, 0.75)
    assert np.array_equal(
        np.array(Image.open(cached.path)), np.array(Image.open(direct.path))
    )
    after_playback = gl_service.frame(simple_scene, catalogue, SMALL, 0.1)
    assert after_playback.time == pytest.approx(2 / 15)
    end = gl_service.frame(simple_scene, catalogue, SMALL, 99)
    assert end.time == pytest.approx(3)
    cpu = CairoRenderService(gl_service.cache_dir).frame(
        simple_scene, catalogue, SMALL, 0.1
    )
    assert cpu.path != after_playback.path


@pytest.mark.parametrize("fmt", ["mp4", "gif", "png", "webm", "mov"])
def test_gl_export(
    gl_service: RenderService,
    catalogue: Catalogue,
    simple_scene: SceneDocument,
    fmt: str,
) -> None:
    times: list[float] = []
    result = gl_service.export(
        simple_scene, catalogue, SMALL, gl_service.cache_dir / "out", fmt, times.append
    )
    assert Path(result.path).stat().st_size > 100
    assert result.duration == pytest.approx(2)
    assert times == sorted(times)
    if fmt == "mp4":
        with av.open(result.path) as video:
            frames = list(video.decode(video=0))
        assert len(frames) == 30
        assert np.max(frames[-1].to_ndarray()) > 100


def render_code(
    gl_service: RenderService,
    code: str,
    *,
    width: int = 256,
    frames: list[np.ndarray] | None = None,
) -> EditorOpenGLRenderer:
    generated = GeneratedCode(
        code="from manim import *\nclass Test(ThreeDScene):\n    def construct(self):\n"
        + "\n".join("        " + line for line in code.splitlines()),
        source_map=SourceMap(),
    )
    _, _, renderer = run_scene(
        generated,
        "Test",
        {
            "renderer": "opengl",
            "dry_run": True,
            "preview": False,
            "pixel_width": width,
            "pixel_height": width * 9 // 16,
            "frame_rate": 15,
            "media_dir": str(gl_service.cache_dir),
            "progress_bar": "none",
        },
        lambda _: EditorOpenGLRenderer(
            backend=gl_service.device.backend,
            on_frame=(
                (lambda i, t, p, s: frames.append(p.copy()))
                if frames is not None
                else None
            ),
        ),
    )
    return renderer


def test_labelled_axes_write(gl_service: RenderService) -> None:
    renderer = render_code(
        gl_service, "self.play(Write(Axes().add_coordinates(), run_time=.4))"
    )
    assert renderer.time == pytest.approx(0.4)
    assert np.max(renderer.get_frame()[:, :, :3]) > 100


def test_illusion_rotation_stops(gl_service: RenderService) -> None:
    pixels: list[np.ndarray] = []
    generated = GeneratedCode(
        code="""from manim import *
class Test(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=75*DEGREES, theta=30*DEGREES)
        self.add(Circle(), ThreeDAxes())
        self.begin_3dillusion_camera_rotation(rate=2)
        self.wait(1)
        self.stop_3dillusion_camera_rotation()
        self.wait(.5)
""",
        source_map=SourceMap(),
    )
    run_scene(
        generated,
        "Test",
        {
            "renderer": "opengl",
            "dry_run": True,
            "preview": False,
            "pixel_width": 256,
            "pixel_height": 144,
            "frame_rate": 15,
            "media_dir": str(gl_service.cache_dir),
            "progress_bar": "none",
        },
        lambda _: EditorOpenGLRenderer(
            backend=gl_service.device.backend,
            on_frame=lambda i, t, p, s: pixels.append(p.copy()),
        ),
    )
    assert np.mean(np.abs(pixels[0].astype(float) - pixels[12])) > 1
    assert np.array_equal(pixels[-1], pixels[-4])


def test_moving_camera_frame(gl_service: RenderService) -> None:
    renderer = render_code(
        gl_service,
        "self.add(Square())\n"
        "self.play(self.camera.frame.animate.scale(.5), run_time=.4)",
    )
    assert renderer.camera.width == pytest.approx(14.222222 / 2)
    assert np.max(renderer.get_frame()[:, :, :3]) > 100


@pytest.mark.parametrize(
    "code",
    [
        "self.play(FadeIn(ImageMobject(np.full((32,32,3), 255, dtype=np.uint8), "
        "scale_to_resolution=128)), run_time=.4)",
        "self.play(FadeIn(PGroup(PointCloudDot(radius=1, density=10))), run_time=.4)",
    ],
)
def test_images_and_point_clouds(gl_service: RenderService, code: str) -> None:
    renderer = render_code(gl_service, code)
    assert np.count_nonzero(renderer.get_frame()[:, :, :3]) > 10


def test_context_reuse_resizing_textures_and_shader_isolation(
    gl_service: RenderService,
) -> None:
    from manim.renderer.shader import shader_program_cache

    from engine.render.gl_resources import get_resources, release_resources

    release_resources()
    circle = "self.add(Circle(color=RED, fill_opacity=.7))"
    first = render_code(gl_service, circle)
    context = first.context
    programs = dict(shader_program_cache)
    assert programs
    # A different scene, resolution and shader must not leak state into the next.
    other = render_code(
        gl_service,
        "self.add(ImageMobject(np.full((32,32,3), 255, dtype=np.uint8)))",
        width=512,
    )
    assert other.get_frame().shape == (288, 512, 4)
    assert other.context is context
    again = render_code(gl_service, circle)
    assert again.context is context
    assert all(shader_program_cache[k] is v for k, v in programs.items())
    assert np.array_equal(first.get_frame(), again.get_frame())
    resources = get_resources(gl_service.device.backend)
    assert not resources.active and not context.objects
    # Compare reused resources against a genuinely fresh context.
    release_resources()
    fresh = render_code(gl_service, circle)
    assert fresh.context is not context
    assert np.array_equal(first.get_frame(), fresh.get_frame())


def test_surface_batching_preserves_rendered_pixels(gl_service: RenderService) -> None:
    from manim.mobject.three_d.three_dimensions import Surface

    code = (
        "self.set_camera_orientation(phi=75*DEGREES, theta=-30*DEGREES)\n"
        "s = Surface(lambda u,v: np.array([u,v,np.exp(-u*u-v*v)]), "
        "resolution=(8, 6), u_range=(-2,2), v_range=(-2,2))\n"
        "s.set_fill_by_checkerboard(ORANGE, BLUE, opacity=.5)\n"
        "self.add(s, ThreeDAxes())"
    )
    # Same GPU, shaders and resolution; only face construction differs.
    with patch("engine.render.compat._setup_surface", Surface._setup_in_uv_space):
        reference = render_code(gl_service, code).get_frame()
    actual = render_code(gl_service, code).get_frame()
    assert np.array_equal(reference, actual)


def test_preview_skips_plays_without_running_a_timing_pass(
    gl_service: RenderService, catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    simple_scene.steps.append(WaitStep(duration=1))
    frames: list[FrameResult] = []
    gl_service.sequence(simple_scene, catalogue, SMALL, 0, 2.5, on_frame=frames.append)
    expected = np.asarray(Image.open(frames[-1].path)).copy()
    # Separate cache forces a direct late scrub, skipping FadeIn and the first wait.
    fresh = RenderService(gl_service.cache_dir / "direct", gl_service.device)
    with patch.object(
        fresh, "_plays_before", side_effect=AssertionError("timing pass")
    ):
        result = fresh.frame(simple_scene, catalogue, SMALL, frames[-1].time)
    assert np.array_equal(expected, np.asarray(Image.open(result.path)))
    assert result.time == pytest.approx(frames[-1].time)


def test_reused_mesh_buffers_match_fresh_buffers_through_animation(
    gl_service: RenderService,
) -> None:
    from manim.renderer.shader import Mesh

    from engine.render.gl_resources import get_resources, release_resources
    from engine.render.meshes import MeshBuffers

    code = (
        "shape = Circle(fill_opacity=.8, color=RED)\n"
        "self.play(Create(shape), run_time=.4)\n"
        "self.play(shape.animate.set_color(BLUE).shift(RIGHT), run_time=.4)\n"
        "self.play(Transform(shape, Square(fill_opacity=.5)), run_time=.4)\n"
        "self.wait(.2)"
    )
    original = Mesh.render
    reference_frames: list[np.ndarray] = []
    actual_frames: list[np.ndarray] = []
    with patch.object(MeshBuffers, "render", lambda cache, mesh: original(mesh)):
        expected = render_code(gl_service, code, frames=reference_frames).get_frame()
    release_resources()
    actual = render_code(gl_service, code, frames=actual_frames).get_frame()
    assert np.array_equal(expected, actual)
    assert len(actual_frames) == len(reference_frames) > 10
    assert all(
        np.array_equal(a, b)
        for a, b in zip(actual_frames, reference_frames, strict=True)
    )
    buffers = get_resources(gl_service.device.backend).meshes
    allocations = buffers.allocations
    render_code(gl_service, "self.add(Square(fill_opacity=.5))")
    render_code(gl_service, "self.add(Square(fill_opacity=.5))")
    assert buffers.reuses > 0
    assert buffers.bytes <= 64 * 1024**2
    assert buffers.allocations < allocations + 5


def test_errors_release_context_and_restore_compatibility(
    gl_service: RenderService,
) -> None:
    from manim import config
    from manim.animation.creation import DrawBorderThenFill

    from engine.render import RenderError

    method = DrawBorderThenFill.interpolate_submobject
    original_renderer = config.renderer
    with pytest.raises(RenderError, match="division by zero"):
        render_code(gl_service, "self.add(Circle())\n1/0")
    assert DrawBorderThenFill.interpolate_submobject is method
    assert config.renderer == original_renderer
    renderer = render_code(gl_service, "self.add(Circle())")
    assert np.count_nonzero(renderer.get_frame()[:, :, :3]) > 10
