"""Preview frames and exports, produced by running generated code through Manim."""

from __future__ import annotations

import hashlib
import shutil
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, Protocol

from manim.mobject.mobject import Mobject
from manim.renderer.cairo_renderer import CairoRenderer
from manim.utils.exceptions import EndSceneEarlyException
from PIL import Image
from pydantic import BaseModel

from engine.catalogue.model import Catalogue
from engine.codegen import GeneratedCode, ManimCodeGenerator, SourceMap
from engine.document.model import GroupDefinition, SceneDocument, Settings
from engine.render.runner import (
    QUIET,
    PreviewFileWriter,
    RenderError,
    run_scene,
)

RENDER_ERROR = -32000
_QUIET = QUIET
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
    subtitles: str | None = None


Progress = Callable[[float], None]


class Renderer(Protocol):
    def frame(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        settings: Settings,
        time: float,
        width: int | None = None,
        groups: Iterable[GroupDefinition] = (),
    ) -> FrameResult: ...

    def export(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        settings: Settings,
        directory: Path,
        fmt: str = "mp4",
        progress: Progress | None = None,
        groups: Iterable[GroupDefinition] = (),
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
        groups: Iterable[GroupDefinition] = (),
    ) -> FrameResult:
        generated = self._generate(scene, catalogue, groups)
        overrides = _config_for(settings, width)
        key = hashlib.sha1(
            f"{generated.code}|{time}|{sorted(overrides.items())}".encode()
        ).hexdigest()[:16]
        path = self.cache_dir / f"{scene.name}-{key}.png"
        record = path.with_suffix(".json")
        if path.exists() and record.exists():
            return FrameResult.model_validate_json(record.read_text())
        instance, locals_, renderer = run_scene(
            generated,
            scene.name,
            {**overrides, "dry_run": True},
            lambda camera: _StopAtRenderer(
                time, None, camera_class=camera, file_writer_class=PreviewFileWriter
            ),
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
        groups: Iterable[GroupDefinition] = (),
    ) -> ExportResult:
        if fmt not in _EXPORT_FORMATS:
            raise RenderError(f"unsupported export format {fmt}", None, None, None)
        generated = self._generate(scene, catalogue, groups)
        work = self.cache_dir / f"export-{scene.name}"
        shutil.rmtree(work, ignore_errors=True)
        overrides = {
            **_config_for(settings, None),
            **_EXPORT_FORMATS[fmt],
            "format": fmt,
            "media_dir": str(work),
            # An absolute output name keeps Manim's subtitle file inside the work dir.
            "output_file": str(work / scene.name),
        }
        instance, _, renderer = run_scene(
            generated,
            scene.name,
            overrides,
            lambda camera: _StopAtRenderer(float("inf"), progress, camera_class=camera),
        )
        produced = Path(getattr(instance.renderer.file_writer, _OUTPUT_ATTRIBUTE[fmt]))
        directory.mkdir(parents=True, exist_ok=True)
        final = directory / produced.name
        shutil.move(str(produced), final)
        subtitles = (work / scene.name).with_suffix(".srt")
        moved_subtitles = None
        if subtitles.exists():
            moved_subtitles = directory / subtitles.name
            shutil.move(str(subtitles), moved_subtitles)
        shutil.rmtree(work, ignore_errors=True)
        return ExportResult(
            path=str(final),
            duration=renderer.time,
            subtitles=str(moved_subtitles) if moved_subtitles else None,
        )

    def _generate(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        groups: Iterable[GroupDefinition] = (),
    ) -> GeneratedCode:
        generated = self.generator.generate(scene, catalogue, groups)
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
