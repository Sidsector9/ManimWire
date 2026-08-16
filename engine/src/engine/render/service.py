"""Preview frames and exports, produced by running generated code through Manim."""

from __future__ import annotations

import hashlib
import shutil
import sys
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from manim import tempconfig
from manim.mobject.mobject import Mobject
from manim.renderer.cairo_renderer import CairoRenderer
from manim.utils.exceptions import EndSceneEarlyException
from PIL import Image
from pydantic import BaseModel

from engine.catalogue.model import Catalogue
from engine.codegen import GeneratedCode, ManimCodeGenerator, SourceMap
from engine.document.model import SceneDocument, Settings

RENDER_ERROR = -32000
_SOURCE_NAME = "<scene>"
_QUIET = {"disable_caching": True, "verbosity": "ERROR", "progress_bar": "none"}
# Config per export format, and the SceneFileWriter attribute holding the result
# (manim/manim/scene/scene_file_writer.py: movie_file_path, gif_file_path,
# image_file_path).
_MOVIE: dict[str, Any] = {"write_to_movie": True}
_EXPORT_FORMATS: dict[str, dict[str, Any]] = {
    "mp4": _MOVIE,
    "mov": _MOVIE,
    "webm": _MOVIE,
    "gif": _MOVIE,
    "png": {"write_to_movie": False, "save_last_frame": True},
}
_OUTPUT_ATTRIBUTE = {
    "mp4": "movie_file_path",
    "mov": "movie_file_path",
    "webm": "movie_file_path",
    "gif": "gif_file_path",
    "png": "image_file_path",
}


class Bounds(BaseModel):
    node: str
    center: tuple[float, float]
    width: float
    height: float
    on_screen: bool


class FrameResult(BaseModel):
    path: str
    time: float
    bounds: list[Bounds]


class ExportResult(BaseModel):
    path: str
    duration: float


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


Progress = Callable[[float], None]


class Renderer(Protocol):
    def frame(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        settings: Settings,
        time: float,
        width: int | None = None,
    ) -> FrameResult: ...

    def export(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        settings: Settings,
        directory: Path,
        fmt: str = "mp4",
        progress: Progress | None = None,
    ) -> ExportResult: ...


class _StopAtRenderer(CairoRenderer):
    """Cairo renderer that ends the scene once the clock reaches a target time."""

    def __init__(self, target: float, progress: Progress | None, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.target = target
        self.progress = progress

    def add_frame(self, frame: Any, num_frames: int = 1) -> None:
        super().add_frame(frame, num_frames)
        if self.progress is not None:
            self.progress(self.time)
        if self.time >= self.target:
            raise EndSceneEarlyException()


class CairoRenderService:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self.generator = ManimCodeGenerator()
        self.render_count = 0

    def frame(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        settings: Settings,
        time: float,
        width: int | None = None,
    ) -> FrameResult:
        generated = self._generate(scene, catalogue)
        overrides = _config_for(settings, width)
        key = hashlib.sha1(
            f"{generated.code}|{time}|{sorted(overrides.items())}".encode()
        ).hexdigest()[:16]
        path = self.cache_dir / f"{scene.name}-{key}.png"
        record = path.with_suffix(".json")
        if path.exists() and record.exists():
            return FrameResult.model_validate_json(record.read_text())
        instance, locals_, renderer = _run(
            generated,
            scene.name,
            {**overrides, "dry_run": True},
            lambda: _StopAtRenderer(time, None),
        )
        self.render_count += 1
        Image.fromarray(renderer.get_frame(), "RGBA").save(path)
        result = FrameResult(
            path=str(path),
            time=renderer.time,
            bounds=_bounds(instance, locals_, generated.source_map),
        )
        record.write_text(result.model_dump_json())
        return result

    def export(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        settings: Settings,
        directory: Path,
        fmt: str = "mp4",
        progress: Progress | None = None,
    ) -> ExportResult:
        if fmt not in _EXPORT_FORMATS:
            raise RenderError(f"unsupported export format {fmt}", None, None, None)
        generated = self._generate(scene, catalogue)
        work = self.cache_dir / f"export-{scene.name}"
        shutil.rmtree(work, ignore_errors=True)
        overrides = {
            **_config_for(settings, None),
            **_EXPORT_FORMATS[fmt],
            "format": fmt,
            "media_dir": str(work),
            "output_file": scene.name,
        }
        instance, _, renderer = _run(
            generated,
            scene.name,
            overrides,
            lambda: _StopAtRenderer(float("inf"), progress),
        )
        produced = Path(getattr(instance.renderer.file_writer, _OUTPUT_ATTRIBUTE[fmt]))
        directory.mkdir(parents=True, exist_ok=True)
        final = directory / produced.name
        shutil.move(str(produced), final)
        shutil.rmtree(work, ignore_errors=True)
        return ExportResult(path=str(final), duration=renderer.time)

    def _generate(self, scene: SceneDocument, catalogue: Catalogue) -> GeneratedCode:
        generated = self.generator.generate(scene, catalogue)
        if generated.issues:
            first = generated.issues[0]
            raise RenderError(first.message, first.node, first.step, None)
        return generated


def _config_for(settings: Settings, width: int | None) -> dict[str, Any]:
    pixel_width = settings.pixel_width
    pixel_height = settings.pixel_height
    if width is not None:
        pixel_height = round(width * settings.pixel_height / settings.pixel_width)
        pixel_width = width
    return {
        **_QUIET,
        "pixel_width": pixel_width,
        "pixel_height": pixel_height,
        "frame_rate": settings.frame_rate,
        "background_color": settings.background_color,
    }


def _run(
    generated: GeneratedCode,
    scene_name: str,
    overrides: dict[str, Any],
    make_renderer: Callable[[], _StopAtRenderer],
) -> tuple[Any, dict[str, Any], _StopAtRenderer]:
    """Run the generated scene. Returns the scene, construct's locals, and the renderer.

    The renderer is created inside ``tempconfig`` because Manim's camera reads
    the resolution and frame rate from the global config when it is built.
    """
    namespace: dict[str, Any] = {}
    captured: dict[str, Any] = {}
    try:
        exec(compile(generated.code, _SOURCE_NAME, "exec"), namespace)
        construct_code = namespace[scene_name].construct.__code__

        def profiler(frame: Any, event: str, arg: Any) -> None:
            if event == "return" and frame.f_code is construct_code:
                captured.update(frame.f_locals)

        with tempconfig(overrides):
            renderer = make_renderer()
            instance = namespace[scene_name](renderer=renderer)
            previous = sys.getprofile()
            sys.setprofile(profiler)
            try:
                instance.render()
            finally:
                sys.setprofile(previous)
    except Exception as exc:
        raise _locate(exc, generated.source_map) from exc
    return instance, captured, renderer


def _locate(exc: Exception, source_map: SourceMap) -> RenderError:
    line = None
    if isinstance(exc, SyntaxError) and exc.filename == _SOURCE_NAME:
        line = exc.lineno
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename == _SOURCE_NAME:
            line = frame.lineno
    node = next((n for n, lines in source_map.nodes.items() if line in lines), None)
    step = next((s for s, lines in source_map.steps.items() if line in lines), None)
    return RenderError(f"{type(exc).__name__}: {exc}", node, step, line)


def _bounds(scene: Any, locals_: dict[str, Any], source_map: SourceMap) -> list[Bounds]:
    on_screen = set(map(id, scene.get_mobject_family_members()))
    result: list[Bounds] = []
    for node, name in source_map.variables.items():
        value = locals_.get(name)
        if not isinstance(value, Mobject):
            continue
        center = value.get_center()
        result.append(
            Bounds(
                node=node,
                center=(float(center[0]), float(center[1])),
                width=float(value.width),
                height=float(value.height),
                on_screen=id(value) in on_screen,
            )
        )
    return result
