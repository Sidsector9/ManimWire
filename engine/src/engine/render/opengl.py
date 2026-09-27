"""Offscreen OpenGL rendering with the editor's frame clock and capture hooks."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import moderngl
from manim import config
from manim.renderer.opengl_renderer import OpenGLRenderer
from manim.renderer.shader import Mesh
from manim.scene.scene_file_writer import SceneFileWriter
from manim.utils.exceptions import EndSceneEarlyException
from PIL import Image

from engine.render.gl_resources import GLResources, get_resources


class EditorOpenGLRenderer(OpenGLRenderer):
    def __init__(
        self,
        *,
        backend: str | None = None,
        target: float = float("inf"),
        start: float = 0,
        on_frame: Callable[..., None] | None = None,
        progress: Callable[[float], None] | None = None,
        file_writer_class: type[SceneFileWriter] = SceneFileWriter,
        timing: bool = False,
    ) -> None:
        super().__init__(file_writer_class=file_writer_class)
        # Preserve CameraFrame nodes: OpenGL's camera is itself the frame.
        camera: Any = self.camera
        camera.frame = camera
        camera._frame_center = camera
        self.backend = backend
        self.target = target
        self.start = start
        self.on_frame = on_frame
        self.progress = progress
        self.timing = timing
        self.plays: list[Any] = []
        self.snapshot: Any = None
        self.stopped = False
        self.resources: GLResources | None = None
        self.textures: list[moderngl.Texture] = []

    def update_frame(self, scene: Any) -> None:
        # Upstream creates temporary Mesh instances for shader wrappers. Redirect
        # only this render call into the persistent cache; restore on exceptions.
        if self.resources is None:
            return super().update_frame(scene)
        buffers = self.resources.meshes
        buffers.begin_frame()
        original = Mesh.render

        def render(mesh: Any) -> None:
            if mesh.shader.context is self.context:
                buffers.render(mesh)
            else:
                original(mesh)

        mesh_type: Any = Mesh
        mesh_type.render = render
        try:
            super().update_frame(scene)
        finally:
            mesh_type.render = original

    def init_scene(self, scene: Any) -> None:
        self.scene = scene
        self.file_writer = self._file_writer_class(self, type(scene).__name__)
        if self.timing:
            return
        resources = get_resources(self.backend)
        self.context = resources.context
        self.frame_buffer_object = resources.begin(
            (config.pixel_width, config.pixel_height)
        )
        self.resources = resources
        context: Any = self.context
        context.blend_func = (
            moderngl.SRC_ALPHA,
            moderngl.ONE_MINUS_SRC_ALPHA,
            moderngl.ONE,
            moderngl.ONE_MINUS_SRC_ALPHA,
        )

    def play(self, scene: Any, *args: Any, **kwargs: Any) -> None:
        from engine.render.runner import Play, scene_line

        self.skip_animations = self.timing
        scene.compile_animation_data(*args, **kwargs)
        # The play's duration is already available here. Decide whether to skip
        # it in this run instead of constructing the entire scene a second time
        # merely to obtain play boundaries for a preview request.
        skip_before = self.start if self.on_frame is not None else self.target
        if skip_before != float("inf"):
            self.skip_animations |= self.time + scene.duration < skip_before - 1e-6
        self.update_skipping_status()
        if self.timing:
            self.plays.append(
                Play(self.time, scene.duration, list(scene.animations), scene_line())
            )
            self.time += scene.duration
            self.num_plays += 1
            return
        partial = None if self.skip_animations else f"uncached_{self.num_plays:05}"
        self.animations_hashes.append(partial)
        self.file_writer.add_partial_movie_file(partial)
        self.file_writer.begin_animation(not self.skip_animations)
        if self.skip_animations:
            self.time += scene.duration
        scene.begin_animations()
        try:
            if scene.is_current_animation_frozen_frame():
                if not self.skip_animations:
                    self.update_frame(scene)
                    for _ in range(int(scene.duration * config.frame_rate)):
                        self.capture(scene)
            else:
                scene.play_internal()
        except EndSceneEarlyException:
            self.stopped = True
            raise
        finally:
            self.file_writer.end_animation(not self.skip_animations)
            self.num_plays += 1

    def render(self, scene: Any, frame_offset: float, moving_mobjects: Any) -> None:
        if self.skip_animations:
            return
        self.update_frame(scene)
        self.capture(scene)

    def capture(self, scene: Any) -> None:
        self.time += 1 / config.frame_rate
        self.file_writer.write_frame(self)
        if self.on_frame is not None and self.time + 1e-6 >= self.start:
            self.on_frame(
                round(self.time * config.frame_rate), self.time, self.get_frame(), scene
            )
        if self.progress is not None:
            self.progress(self.time)
        if self.time + 1e-6 >= self.target:
            self.stopped = True
            raise EndSceneEarlyException()

    def scene_finished(self, scene: Any) -> None:
        if self.timing:
            return
        if self.num_plays:
            self.file_writer.finish()
        if not self.stopped:
            # Capture the final state for static scenes and requests past the end.
            self.update_frame(scene)
        if config.save_last_frame:
            self.file_writer.save_image(self.get_image())

    def get_frame(self) -> Any:
        return self.snapshot if self.snapshot is not None else super().get_frame()

    def _create_texture(self, image_path: str) -> int:
        # Upstream drops the Python reference after binding. With a persistent
        # context, retain ownership and release each scene's textures explicitly.
        with Image.open(image_path) as source:
            grayscale = source.mode == "L"
            img = source if grayscale else source.convert("RGBA")
            texture = self.context.texture(
                img.size, components=1 if grayscale else 4, data=img.tobytes()
            )
        texture.repeat_x = False
        texture.repeat_y = False
        texture.filter = (moderngl.NEAREST, moderngl.NEAREST)
        texture.swizzle = "RRR1" if grayscale else "RGBA"
        tid = len(self.path_to_texture_id)
        texture.use(location=tid)
        self.path_to_texture_id[image_path] = tid
        self.textures.append(texture)
        return tid

    def close(self, *, capture: bool = True) -> None:
        if self.resources is not None:
            try:
                if capture:
                    self.snapshot = super().get_frame().copy()
            finally:
                for texture in self.textures:
                    texture.release()
                self.textures.clear()
                self.resources.end()
                self.resources = None
