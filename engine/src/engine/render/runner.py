"""Execute generated scene code through Manim with a chosen renderer.

Shared by the render service (frames, exports) and the timeline (timings).
"""

from __future__ import annotations

import ast
import sys
import tempfile
import traceback
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import CodeType
from typing import Any

from manim import tempconfig
from manim.camera.camera import Camera
from manim.camera.moving_camera import MovingCamera
from manim.camera.three_d_camera import ThreeDCamera
from manim.renderer.cairo_renderer import CairoRenderer
from manim.scene.moving_camera_scene import MovingCameraScene
from manim.scene.scene_file_writer import SceneFileWriter
from manim.scene.three_d_scene import ThreeDScene

from engine.codegen import GeneratedCode, SourceMap
from engine.render.compat import opengl_compatibility
from engine.render.objects import object_aliases
from engine.render.opengl import EditorOpenGLRenderer

SOURCE_NAME = "<scene>"
QUIET = {"disable_caching": True, "verbosity": "ERROR", "progress_bar": "none"}


class PreviewFileWriter(SceneFileWriter):
    """Writes no sound or subtitle files and tolerates missing sounds."""

    def write_subcaption_file(self) -> None:
        return

    def add_sound(
        self, sound_file: Any, time: Any = None, gain: Any = None, **kwargs: Any
    ) -> None:
        try:
            super().add_sound(sound_file, time, gain, **kwargs)
        except OSError:
            pass


@dataclass
class Play:
    """One play call as Manim compiled it: start time, duration, animations.

    ``line`` is the line of generated code that made the call, which is how a
    caller tells apart the several plays one loop step makes.
    """

    start: float
    duration: float
    animations: list[Any]
    line: int | None = None


class TimingRenderer(CairoRenderer):
    """Records each play call's compiled animations instead of rendering them.

    Skipping every animation makes Manim jump to each end state, so a scene's
    timings come out in milliseconds without drawing a frame.
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(
            file_writer_class=PreviewFileWriter, skip_animations=True, **kwargs
        )
        self.plays: list[Play] = []

    def play(self, scene: Any, *args: Any, **kwargs: Any) -> None:
        scene.compile_animation_data(*args, **kwargs)
        self.plays.append(
            Play(self.time, scene.duration, list(scene.animations), scene_line())
        )
        self.time += scene.duration
        self.num_plays += 1

    def scene_finished(self, scene: Any) -> None:
        # Cairo's implementation draws static scenes even in dry_run mode.
        # A timing-only execution must never rasterize a frame.
        return


def scene_line() -> int | None:
    """The line of generated code that called into Manim, if the call came from one."""
    frame: Any = sys._getframe()
    while frame is not None:
        if frame.f_code.co_filename == SOURCE_NAME:
            return int(frame.f_lineno)
        frame = frame.f_back
    return None


class RenderError(Exception):
    """A Manim failure, located in the document when the traceback allows it."""

    def __init__(
        self, message: str, node: str | None, step: int | None, line: int | None
    ) -> None:
        super().__init__(message)
        self.node = node
        self.step = step
        self.line = line

    def data(self) -> dict[str, Any]:
        return {"node": self.node, "step": self.step, "line": self.line}


def run_scene[R: CairoRenderer | EditorOpenGLRenderer](
    generated: GeneratedCode,
    scene_name: str,
    overrides: dict[str, Any],
    make_renderer: Callable[[type[Camera]], R],
) -> tuple[Any, dict[str, Any], R]:
    """Run the generated scene. Returns the scene, construct's locals, and the renderer.

    The renderer is created inside ``tempconfig`` because Manim's camera reads
    the resolution and frame rate from the global config when it is built. It
    gets the camera class the scene type would choose itself (``Scene.__init__``
    only does that when no renderer is passed).
    """
    namespace: dict[str, Any] = {}
    captured: dict[str, Any] = {}
    try:
        with (
            tempfile.TemporaryDirectory(prefix="mnw-textures-") as textures,
            tempconfig(overrides),
            opengl_compatibility(overrides.get("renderer") == "opengl"),
        ):
            code, capture_name = compile_scene(generated.code, scene_name)

            def capture_locals() -> None:
                captured.update(sys._getframe(1).f_locals)

            namespace[capture_name] = capture_locals
            exec(code, namespace)
            if overrides.get("renderer") == "opengl":
                namespace.update(object_aliases(Path(textures)))
            renderer = make_renderer(camera_class_for(namespace[scene_name]))
            success = False
            try:
                instance = namespace[scene_name](renderer=renderer)
                instance.render()
                success = True
            finally:
                if isinstance(renderer, EditorOpenGLRenderer):
                    renderer.close(capture=success)
    except Exception as exc:
        raise locate(exc, generated.source_map) from exc
    return instance, captured, renderer


def compile_scene(source: str, scene_name: str) -> tuple[CodeType, str]:
    """Capture construct's locals once, including when a preview stops early.

    A global profiling hook previously ran on every Python/C call and return in
    Manim. A finally block has no per-call overhead, leaves debuggers/profilers
    alone, and preserves the original source locations used by error reporting.
    The exported Python source itself is not changed.
    """
    tree = ast.parse(source, filename=SOURCE_NAME)
    capture_name = "_mnw_capture_construct_locals"
    while capture_name in source:
        capture_name += "_"
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == scene_name:
            for method in node.body:
                if isinstance(method, ast.FunctionDef) and method.name == "construct":
                    capture = ast.Expr(
                        value=ast.Call(
                            func=ast.Name(id=capture_name, ctx=ast.Load()),
                            args=[],
                            keywords=[],
                        )
                    )
                    ast.copy_location(capture, method.body[-1])
                    block = ast.Try(
                        body=method.body, handlers=[], orelse=[], finalbody=[capture]
                    )
                    ast.copy_location(block, method.body[0])
                    method.body = [block]
    ast.fix_missing_locations(tree)
    return compile(tree, SOURCE_NAME, "exec"), capture_name


def camera_class_for(scene_class: type) -> type[Camera]:
    if issubclass(scene_class, ThreeDScene):
        return ThreeDCamera
    if issubclass(scene_class, MovingCameraScene):
        return MovingCamera
    return Camera


def locate(exc: Exception, source_map: SourceMap) -> RenderError:
    line = None
    if isinstance(exc, SyntaxError) and exc.filename == SOURCE_NAME:
        line = exc.lineno
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename == SOURCE_NAME:
            line = frame.lineno
    node = next((n for n, lines in source_map.nodes.items() if line in lines), None)
    step = next((s for s, lines in source_map.steps.items() if line in lines), None)
    return RenderError(f"{type(exc).__name__}: {exc}", node, step, line)
