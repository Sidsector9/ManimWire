"""Resumable OpenGL previews on the RPC thread, with simulation-only advancement.

The suspended Python stack retains Manim's animation loop, updater closures and
TracedPath history. Configuration/compatibility patches and the GL context are
active only during a request; no rendering thread or global config is left active.
"""

from __future__ import annotations

import random
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from types import FrameType
from typing import Any

import numpy as np
from greenlet import GreenletExit, getcurrent, greenlet
from manim import config, tempconfig

from engine.codegen import GeneratedCode
from engine.render.compat import opengl_compatibility
from engine.render.objects import object_aliases
from engine.render.opengl import EditorOpenGLRenderer
from engine.render.runner import PreviewFileWriter, compile_scene, locate


class SeekRenderer(EditorOpenGLRenderer):
    def __init__(self, session: SeekSession, backend: str | None) -> None:
        super().__init__(backend=backend, file_writer_class=PreviewFileWriter)
        self.session = session
        self.frozen_frame = False

    def render(self, scene: Any, frame_offset: float, moving_mobjects: Any) -> None:
        if not self.skip_animations:
            self.frozen_frame = False
            self.capture(scene)

    def update_frame(self, scene: Any) -> None:
        # Frozen waits call this before their frame clock starts. The requested
        # frame is drawn explicitly by tick(), including within a frozen wait.
        self.frozen_frame = True

    def draw(self, scene: Any) -> None:
        super().update_frame(scene)

    def capture(self, scene: Any) -> None:
        self.time += 1 / config.frame_rate
        self.session.tick(scene)

    def scene_finished(self, scene: Any) -> None:
        self.draw(scene)


class SeekSession:
    def __init__(
        self,
        generated: GeneratedCode,
        name: str,
        overrides: dict[str, Any],
        backend: str | None,
    ) -> None:
        self.generated, self.name = generated, name
        self.overrides = {**overrides, "dry_run": True, "from_animation_number": 0}
        self.backend = backend
        self.renderer: SeekRenderer | None = None
        self.scene: Any = None
        self.locals: dict[str, Any] = {}
        self.target: Callable[[], float] = lambda: 0
        self.textures = tempfile.TemporaryDirectory(prefix="mnw-seek-textures-")
        self.task = greenlet(self._run)
        self.closed = False
        self.draws = 0
        self.updates = 0
        self.random_state: Any = None
        self.numpy_state: Any = None

    @property
    def time(self) -> float:
        return self.renderer.time if self.renderer is not None else 0.0

    def _run(self) -> None:
        namespace: dict[str, Any] = {}
        code, capture_name = compile_scene(self.generated.code, self.name)

        def capture() -> None:
            self.locals = dict(sys._getframe(1).f_locals)

        namespace[capture_name] = capture
        exec(code, namespace)
        namespace.update(object_aliases(Path(self.textures.name)))
        self.renderer = SeekRenderer(self, self.backend)
        self.scene = namespace[self.name](renderer=self.renderer)
        self.scene.render()

    def tick(self, scene: Any) -> None:
        assert self.renderer is not None
        self.updates += 1
        target = self.target()
        ready = self.time + 1e-6 >= target
        if ready:
            frame: FrameType | None = sys._getframe()
            while (
                frame is not None and frame.f_code is not type(scene).construct.__code__
            ):
                frame = frame.f_back
            if frame is not None:
                self.locals = dict(frame.f_locals)
            self.renderer.draw(scene)
            self.draws += 1
            parent = getcurrent().parent
            assert parent is not None
            parent.switch()
        elif not self.renderer.frozen_frame:
            # Shader preparation can mutate Manim's geometry/style caches (e.g.
            # Create's partial filled paths). Preserve those CPU-side effects,
            # while omitting mesh submission, rasterization and pixel readback.
            for mob in scene.mobjects:
                if mob.should_render:
                    mob.get_shader_wrapper_list()

    def advance(
        self,
        target: Callable[[], float],
        on_snapshot: Callable[[Any, dict[str, Any]], None] | None = None,
    ) -> tuple[Any, dict[str, Any], Any]:
        if self.closed:
            raise RuntimeError("Seek session is closed")
        self.target = target
        outer_random, outer_numpy = random.getstate(), np.random.get_state()
        try:
            with tempconfig(self.overrides), opengl_compatibility(True):
                if self.random_state is not None:
                    random.setstate(self.random_state)
                    np.random.set_state(self.numpy_state)
                self._activate()
                try:
                    if not self.task.dead and (
                        self.renderer is None or self.time < target() - 1e-6
                    ):
                        self.task.switch()
                    elif self.renderer is not None:
                        self.renderer.draw(self.scene)
                    assert self.renderer is not None
                    if on_snapshot is not None:
                        on_snapshot(self.scene, self.locals)
                    pixels = self.renderer.get_frame().copy()
                    return self.scene, self.locals, pixels
                finally:
                    self.random_state, self.numpy_state = (
                        random.getstate(),
                        np.random.get_state(),
                    )
                    self._release_context()
        except Exception as exc:
            self.close()
            raise locate(exc, self.generated.source_map) from exc
        finally:
            random.setstate(outer_random)
            np.random.set_state(outer_numpy)

    def _activate(self) -> None:
        if self.renderer is not None and self.renderer.resources is not None:
            self.renderer.frame_buffer_object = self.renderer.resources.begin(
                (self.overrides["pixel_width"], self.overrides["pixel_height"])
            )
            for index, texture in enumerate(self.renderer.textures):
                texture.use(location=index)

    def _release_context(self) -> None:
        if self.renderer is not None and self.renderer.resources is not None:
            self.renderer.resources.end()

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            with tempconfig(self.overrides), opengl_compatibility(True):
                self._activate()
                try:
                    if not self.task.dead:
                        self.task.throw(GreenletExit)
                    if self.renderer is not None:
                        self.renderer.close(capture=False)
                finally:
                    self._release_context()
        finally:
            self.textures.cleanup()
            self.locals.clear()
            self.scene = None
