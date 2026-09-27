"""Reusable vertex/index buffers and VAOs for Manim's mesh submission path."""

from __future__ import annotations

from collections import OrderedDict
from typing import Any

import moderngl
from manim.renderer.shader import filter_attributes


class MeshBuffers:
    def __init__(self, context: moderngl.Context) -> None:
        self.context = context
        self.entries: OrderedDict[tuple[Any, ...], dict[str, Any]] = OrderedDict()
        self.slot = 0
        self.bytes = 0
        self.uploads = 0
        self.reuses = 0
        self.allocations = 0

    def begin_frame(self) -> None:
        self.slot = 0

    def render(self, mesh: Any) -> None:
        if mesh.skip_render:
            return
        program = mesh.shader.shader_program
        names = [
            name
            for name, member in program._members.items()
            if isinstance(member, moderngl.Attribute)
        ]
        attributes = filter_attributes(mesh.attributes, names)
        vertices = attributes.tobytes()
        indices = (
            mesh.indices.astype("i4").tobytes() if mesh.indices is not None else b""
        )
        # Draw order is a reusable slot, not an assumption about object identity.
        # Comparing contents on every submission catches points/style/index edits.
        key = (self.slot, program.glo, str(attributes.dtype), bool(indices))
        self.slot += 1
        entry = self.entries.pop(key, None)
        if entry is not None and (len(vertices), len(indices)) != (
            len(entry["vertices"]),
            len(entry["indices"]),
        ):
            self._release(entry)
            entry = None
        if entry is None:
            vbo = self.context.buffer(vertices, dynamic=True)
            ibo = self.context.buffer(indices, dynamic=True) if indices else None
            vao = self.context.simple_vertex_array(
                program, vbo, *(attributes.dtype.names or ()), index_buffer=ibo
            )
            entry = dict(vbo=vbo, ibo=ibo, vao=vao, vertices=vertices, indices=indices)
            self.bytes += len(vertices) + len(indices)
            self.allocations += 1
            self.uploads += 1
        else:
            changed = False
            for data, buffer_name in ((vertices, "vbo"), (indices, "ibo")):
                field = "vertices" if buffer_name == "vbo" else "indices"
                if data != entry[field]:
                    # Orphaning gives the driver fresh storage without waiting
                    # for previous draws to finish; VAO bindings remain valid.
                    entry[buffer_name].orphan()
                    entry[buffer_name].write(data)
                    entry[field] = data
                    changed = True
            self.uploads += int(changed)
            self.reuses += int(not changed)
        self.entries[key] = entry
        if mesh.use_depth_test:
            self.context.enable(moderngl.DEPTH_TEST)
        else:
            self.context.disable(moderngl.DEPTH_TEST)
        entry["vao"].render(mesh.primitive)
        # Bound both GPU memory and the retained CPU comparison data.
        while len(self.entries) > 256 or self.bytes > 64 * 1024**2:
            _, old = self.entries.popitem(last=False)
            self._release(old)

    def _release(self, entry: dict[str, Any]) -> None:
        self.bytes -= len(entry["vertices"]) + len(entry["indices"])
        entry["vao"].release()
        entry["vbo"].release()
        if entry["ibo"] is not None:
            entry["ibo"].release()

    def close(self) -> None:
        for entry in self.entries.values():
            self._release(entry)
        self.entries.clear()
