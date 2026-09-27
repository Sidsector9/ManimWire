"""Scoped fixes for the bundled Manim's OpenGL paths; Cairo is unchanged."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import numpy as np
from manim.animation.composition import LaggedStartMap
from manim.animation.creation import DrawBorderThenFill
from manim.mobject.text import numbers
from manim.mobject.three_d.three_dimensions import Surface, ThreeDVMobject
from manim.mobject.types.vectorized_mobject import VGroup
from manim.scene.three_d_scene import ThreeDScene

_OPENGL_NUMBER_CACHE: dict[str, Any] = {}


def _setup_surface(self: Any) -> None:
    """Manim's Surface setup, adding faces in one batch instead of N batches.

    Keep the public vector-face representation, ordering, indices and styles.
    Each OpenGL add() refreshes the group's entire family; adding one face at a
    time traverses O(N²) objects before a single triangle reaches the GPU.
    Mirrors the bundled Surface._setup_in_uv_space except for batched insertion.
    """
    u_values, v_values = self._get_u_values_and_v_values()
    self.list_of_faces = []
    for i in range(len(u_values) - 1):
        for j in range(len(v_values) - 1):
            u1, u2 = u_values[i : i + 2]
            v1, v2 = v_values[j : j + 2]
            face = ThreeDVMobject()
            face.set_points_as_corners(
                [(u1, v1, 0), (u2, v1, 0), (u2, v2, 0), (u1, v2, 0), (u1, v1, 0)]
            )
            face.u_index, face.v_index = i, j
            face.u1, face.u2, face.v1, face.v2 = u1, u2, v1, v2
            self.list_of_faces.append(face)
    faces = VGroup(*self.list_of_faces)
    faces.set_fill(color=self.fill_color, opacity=self.fill_opacity)
    faces.set_stroke(
        color=self.stroke_color, width=self.stroke_width, opacity=self.stroke_opacity
    )
    self.add(*faces)
    if self.checkerboard_colors:
        self.set_fill_by_checkerboard(*self.checkerboard_colors)


@contextmanager
def opengl_compatibility(enabled: bool) -> Iterator[None]:
    if not enabled:
        yield
        return
    original_number_cache = numbers.string_to_mob_map
    numbers.string_to_mob_map = _OPENGL_NUMBER_CACHE
    original_map = LaggedStartMap.__init__
    original_interpolate = DrawBorderThenFill.interpolate_submobject
    original_begin = ThreeDScene.begin_3dillusion_camera_rotation
    original_stop = ThreeDScene.stop_3dillusion_camera_rotation

    def interpolate(
        self: Any, sub: Any, starting: Any, outline: Any, alpha: float
    ) -> None:
        if alpha >= 0.5:
            # Partial OpenGL paths can have fewer points (notably axis arrow tips).
            # Restore their full shape before interpolating into the filled object.
            sub.pointwise_become_partial(outline, 0, 1)
        original_interpolate(self, sub, starting, outline, alpha)

    def begin(
        self: Any,
        rate: float = 1,
        origin_phi: float | None = None,
        origin_theta: float | None = None,
    ) -> None:
        stop(self)
        camera = self.renderer.camera
        theta = camera.euler_angles[0] if origin_theta is None else origin_theta
        phi = camera.euler_angles[1] if origin_phi is None else origin_phi
        elapsed = 0.0

        def rotate(dt: float) -> None:
            nonlocal elapsed
            elapsed += dt * rate
            camera.set_theta(theta + 0.2 * np.sin(elapsed))
            camera.set_phi(phi + 0.1 * np.cos(elapsed) - 0.1)

        self._mnw_illusion_updater = rotate
        self.add_updater(rotate)

    def stop(self: Any) -> None:
        updater = getattr(self, "_mnw_illusion_updater", None)
        if updater is not None:
            self.remove_updater(updater)
            del self._mnw_illusion_updater

    def map_init(
        self: Any,
        animation_class: Any,
        mobject: Any,
        arg_creator: Any = None,
        **kwargs: Any,
    ) -> None:
        # OpenGL leaf objects iterate over children only, unlike Cairo's Mobject.
        if arg_creator is None:

            def arg_creator(mob: Any) -> tuple[Any]:
                return (mob,)

        original_map(self, animation_class, mobject, arg_creator=arg_creator, **kwargs)

    patches = [
        (Surface, "_setup_in_uv_space", _setup_surface, Surface._setup_in_uv_space),
        (
            DrawBorderThenFill,
            "interpolate_submobject",
            interpolate,
            original_interpolate,
        ),
        (ThreeDScene, "begin_3dillusion_camera_rotation", begin, original_begin),
        (ThreeDScene, "stop_3dillusion_camera_rotation", stop, original_stop),
        (LaggedStartMap, "__init__", map_init, original_map),
    ]
    for cls, name, replacement, _ in patches:
        setattr(cls, name, replacement)
    try:
        yield
    finally:
        numbers.string_to_mob_map = original_number_cache
        for cls, name, _, original in reversed(patches):
            setattr(cls, name, original)
