"""One reusable offscreen context for the engine's serial rendering thread."""

from __future__ import annotations

import atexit
from threading import get_ident
from typing import Any

import moderngl
from manim.renderer.shader import shader_program_cache

from engine.render.meshes import MeshBuffers


class GLResources:
    def __init__(self, backend: str | None) -> None:
        kwargs: dict[str, Any] = {} if backend is None else {"backend": backend}
        self.context = moderngl.create_context(standalone=True, require=330, **kwargs)
        # Release abandoned Manim resources only on the rendering thread, while
        # its context is current. Explicitly owned textures survive until close.
        self.context.gc_mode = "context_gc"
        self.backend = backend
        self.thread = get_ident()
        self.framebuffer: moderngl.Framebuffer | None = None
        self.active = False
        self.meshes = MeshBuffers(self.context)

    def begin(self, size: tuple[int, int]) -> moderngl.Framebuffer:
        if self.thread != get_ident() or self.active:
            raise RuntimeError("OpenGL rendering must be serial on its owning thread")
        self.context.__enter__()  # type: ignore[no-untyped-call]
        self.active = True
        try:
            return self._prepare_framebuffer(size)
        except BaseException:
            self.end()
            raise

    def _prepare_framebuffer(self, size: tuple[int, int]) -> moderngl.Framebuffer:
        if self.framebuffer is not None and self.framebuffer.size != size:
            self._release_framebuffer()
        if self.framebuffer is None:
            self.framebuffer = self.context.framebuffer(
                color_attachments=self.context.texture(size, components=4),
                depth_attachment=self.context.depth_renderbuffer(size),
            )
        self.framebuffer.use()
        self.framebuffer.viewport = (0, 0, *size)
        self.context.enable_only(moderngl.BLEND)
        self.context.scissor = None
        self.context.wireframe = False
        return self.framebuffer

    def end(self) -> None:
        if self.active:
            try:
                self.collect()
            finally:
                self.context.__exit__(None, None, None)  # type: ignore[no-untyped-call]
                self.active = False

    def _release_framebuffer(self) -> None:
        if self.framebuffer is not None:
            for attachment in self.framebuffer.color_attachments:
                attachment.release()
            if self.framebuffer.depth_attachment is not None:
                self.framebuffer.depth_attachment.release()
            self.framebuffer.release()
            self.framebuffer = None

    def collect(self) -> None:
        # ModernGL also queues InvalidObject sentinels for resources Manim has
        # already released explicitly. Context.gc() in 5.12 tries to release
        # those twice. Drain the queue while skipping only those sentinels.
        while self.context.objects:
            resource = self.context.objects.popleft()
            if not isinstance(resource, moderngl.InvalidObject):
                resource.release()

    def close(self) -> None:
        if self.active:
            raise RuntimeError("Cannot release an active OpenGL context")
        with self.context:
            self.meshes.close()
            self._release_framebuffer()
            for name, program in list(shader_program_cache.items()):
                if program.ctx is self.context:
                    program.release()
                    del shader_program_cache[name]
            self.collect()
        self.context.release()


_resources: GLResources | None = None


def get_resources(backend: str | None) -> GLResources:
    global _resources
    if _resources is not None and _resources.backend != backend:
        release_resources()
    if _resources is None:
        _resources = GLResources(backend)
    return _resources


def release_resources() -> None:
    """Release persistent GPU storage at engine shutdown (also used by tests)."""
    global _resources
    if _resources is not None:
        _resources.close()
        _resources = None


atexit.register(release_resources)
