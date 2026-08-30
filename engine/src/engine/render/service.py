"""Preview frames and exports, produced by running generated code through Manim."""

from __future__ import annotations

import hashlib
import math
import shutil
from collections.abc import Callable, Iterable
from pathlib import Path
from time import perf_counter
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
    TimingRenderer,
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
    # Wall-clock time Manim took to produce the frame; 0 when it came from the cache.
    render_ms: float = 0


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
        if self.time + 1e-6 >= self.target:
            raise EndSceneEarlyException()


OnFrame = Callable[[int, float, Any], None]


class _SequenceRenderer(CairoRenderer):
    """Cairo renderer that hands every frame between two times to a callback."""

    def __init__(
        self, start: float, end: float, on_frame: OnFrame, **kwargs: Any
    ) -> None:
        super().__init__(**kwargs)
        self.start = start
        self.end = end
        self.on_frame = on_frame

    def add_frame(self, frame: Any, num_frames: int = 1) -> None:
        if self.skip_animations:
            return
        dt = 1 / self.camera.frame_rate
        for _ in range(num_frames):
            self.time += dt
            if self.time + 1e-9 >= self.start:
                self.on_frame(
                    round(self.time * self.camera.frame_rate), self.time, frame
                )
            if self.time >= self.end - 1e-9:
                raise EndSceneEarlyException()


class SequenceResult(BaseModel):
    frames: int
    start: float
    end: float


class CairoRenderService:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        cache_dir.mkdir(parents=True, exist_ok=True)
        self.generator = ManimCodeGenerator()
        self.render_count = 0
        # Play times per generated code, so a frame request can skip earlier plays.
        self.timings: dict[str, list[tuple[float, float]]] = {}

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
        index = frame_index(time, settings.frame_rate)
        path = self._frame_path(scene.name, generated.code, index, overrides)
        record = path.with_suffix(".json")
        if path.exists() and record.exists():
            return FrameResult.model_validate_json(record.read_text())
        started = perf_counter()
        target = index / settings.frame_rate
        instance, locals_, renderer = run_scene(
            generated,
            scene.name,
            {
                **overrides,
                "dry_run": True,
                # Plays that end before the target are skipped: Manim jumps each to its
                # end state without drawing, as it does for its own -n option.
                "from_animation_number": self._plays_before(
                    generated, scene.name, target
                ),
            },
            lambda camera: _StopAtRenderer(
                target, None, camera_class=camera, file_writer_class=PreviewFileWriter
            ),
        )
        self.render_count += 1
        Image.fromarray(renderer.get_frame(), "RGBA").save(path)
        result = FrameResult(
            path=str(path),
            time=renderer.time,
            bounds=_bounds(instance, locals_, generated.source_map),
            render_ms=(perf_counter() - started) * 1000,
        )
        record.write_text(result.model_dump_json())
        return result

    def sequence(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        settings: Settings,
        start: float,
        end: float,
        width: int | None = None,
        groups: Iterable[GroupDefinition] = (),
        on_frame: Callable[[FrameResult], None] | None = None,
    ) -> SequenceResult:
        """Render every frame between two times into the cache, in one run of the scene.

        Later ``frame`` calls for those times are cache hits, so playback only reads
        images. ``on_frame`` is told about each frame as it is written.
        """
        generated = self._generate(scene, catalogue, groups)
        overrides = _config_for(settings, width)
        written = 0

        def store(index: int, time: float, pixels: Any) -> None:
            nonlocal written
            path = self._frame_path(scene.name, generated.code, index, overrides)
            record = path.with_suffix(".json")
            if not (path.exists() and record.exists()):
                Image.fromarray(pixels, "RGBA").save(path)
                record.write_text(
                    FrameResult(path=str(path), time=time, bounds=[]).model_dump_json()
                )
            written += 1
            if on_frame is not None:
                on_frame(FrameResult.model_validate_json(record.read_text()))

        first = max(1, frame_index(start, settings.frame_rate)) / settings.frame_rate
        run_scene(
            generated,
            scene.name,
            {
                **overrides,
                "dry_run": True,
                "from_animation_number": self._plays_before(
                    generated, scene.name, first
                ),
            },
            lambda camera: _SequenceRenderer(
                first,
                end,
                store,
                camera_class=camera,
                file_writer_class=PreviewFileWriter,
            ),
        )
        self.render_count += 1
        return SequenceResult(frames=written, start=first, end=end)

    def _frame_path(
        self, name: str, code: str, index: int, overrides: dict[str, Any]
    ) -> Path:
        key = hashlib.sha1(
            f"{code}|{index}|{sorted(overrides.items())}".encode()
        ).hexdigest()[:16]
        return self.cache_dir / f"{name}-{key}.png"

    def _plays_before(self, generated: GeneratedCode, name: str, target: float) -> int:
        """How many plays end before ``target``: Manim's ``from_animation_number``."""
        key = hashlib.sha1(generated.code.encode()).hexdigest()
        if key not in self.timings:
            _, _, timing = run_scene(
                generated,
                name,
                {**_QUIET, "dry_run": True},
                lambda camera: TimingRenderer(camera_class=camera),
            )
            self.timings[key] = [(p.start, p.start + p.duration) for p in timing.plays]
        return sum(1 for _, end in self.timings[key] if end < target - 1e-9)

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


def frame_index(time: float, frame_rate: float) -> int:
    """The frame shown at ``time``: Manim's first frame sits at 1 / frame_rate."""
    return max(1, math.ceil(time * frame_rate - 1e-6))


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
