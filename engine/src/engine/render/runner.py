"""Execute generated scene code through Manim with a chosen renderer.

Shared by the render service (frames, exports) and the timeline (timings).
"""

from __future__ import annotations

import sys
import traceback
from collections.abc import Callable
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


def run_scene[R: CairoRenderer](
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
        exec(compile(generated.code, SOURCE_NAME, "exec"), namespace)
        construct_code = namespace[scene_name].construct.__code__

        def profiler(frame: Any, event: str, arg: Any) -> None:
            if event == "return" and frame.f_code is construct_code:
                captured.update(frame.f_locals)

        with tempconfig(overrides):
            renderer = make_renderer(camera_class_for(namespace[scene_name]))
            instance = namespace[scene_name](renderer=renderer)
            previous = sys.getprofile()
            sys.setprofile(profiler)
            try:
                instance.render()
            finally:
                sys.setprofile(previous)
    except Exception as exc:
        raise locate(exc, generated.source_map) from exc
    return instance, captured, renderer


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
