"""Keep public Manim object names usable with the OpenGL renderer."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Self

import numpy as np
from manim import DEFAULT_POINT_DENSITY_1D, DEFAULT_QUALITY, ORIGIN, QUALITIES, config
from manim.mobject.opengl.dot_cloud import DotCloud
from manim.mobject.opengl.opengl_image_mobject import OpenGLImageMobject
from manim.mobject.opengl.opengl_point_cloud_mobject import OpenGLPGroup, OpenGLPMPoint
from manim.utils.color import BLACK, PURE_YELLOW
from manim.utils.images import get_full_raster_image_path
from PIL import Image


class EditorPointCloudDot(DotCloud):
    def __init__(
        self,
        center: Any = ORIGIN,
        radius: float = 2,
        stroke_width: float = 2,
        density: float = DEFAULT_POINT_DENSITY_1D,
        color: Any = PURE_YELLOW,
        **kwargs: Any,
    ) -> None:
        super().__init__(
            radius=radius,
            stroke_width=stroke_width,
            density=density,
            color=color,
            **kwargs,
        )
        self.shift(center)


class EditorPoint(OpenGLPMPoint):
    def __init__(
        self, location: Any = ORIGIN, color: Any = BLACK, **kwargs: Any
    ) -> None:
        super().__init__(location=location, color=color, **kwargs)  # type: ignore[no-untyped-call]


def object_aliases(directory: Path) -> dict[str, Any]:
    class EditorImage(OpenGLImageMobject):
        def __init__(
            self,
            filename_or_array: Any,
            scale_to_resolution: int = QUALITIES[DEFAULT_QUALITY]["pixel_height"],
            invert: bool = False,
            image_mode: str = "RGBA",
            **kwargs: Any,
        ) -> None:
            if isinstance(filename_or_array, (str, Path)):
                with Image.open(
                    get_full_raster_image_path(filename_or_array)
                ) as source:
                    pixels = np.array(source.convert(image_mode).convert("RGBA"))
            else:
                pixels = np.array(
                    Image.fromarray(
                        np.asarray(filename_or_array, dtype=np.uint8)
                    ).convert("RGBA")
                )
            if invert:
                pixels[:, :, :3] = 255 - pixels[:, :, :3]
            self.pixel_array = pixels
            kwargs.pop("pixel_array_dtype", None)
            height = (
                pixels.shape[0] / scale_to_resolution * config.frame_height
                if scale_to_resolution
                else 3
            )
            super().__init__(pixels, height=height, image_mode="RGBA", **kwargs)
            self.refresh_texture()

        def get_image_from_file(self, image_file: Any, image_mode: str) -> Any:
            # The bundled GL image class returns PIL images, but its renderer loads
            # texture paths. Materialize immutable textures for this scene run.
            pixels = np.asarray(image_file, dtype=np.uint8)
            key = hashlib.sha256(
                pixels.tobytes() + str(pixels.shape).encode()
            ).hexdigest()
            path = directory / f"{key}.png"
            if not path.exists():
                Image.fromarray(pixels).save(path)
            return path

        def get_pixel_array(self) -> Any:
            return self.pixel_array

        def set_resampling_algorithm(self, resampling_algorithm: Any) -> Self:
            self.resampling_algorithm = resampling_algorithm
            self.refresh_texture()
            return self

        def refresh_texture(self) -> None:
            size = (
                max(1, round(self.width / config.frame_width * config.pixel_width)),
                max(1, round(self.height / config.frame_height * config.pixel_height)),
            )
            image = Image.fromarray(self.pixel_array).resize(
                size, self.resampling_algorithm
            )
            path = self.get_image_from_file(np.array(image), "RGBA")
            self.texture_paths = {"LightTexture": path, "DarkTexture": path}
            self.refresh_shader_wrapper_id()

        def set_opacity(self, alpha: Any, recurse: bool = True) -> Self:
            super().set_opacity(alpha, recurse=recurse)
            return self

    return {
        "ImageMobject": EditorImage,
        "PointCloudDot": EditorPointCloudDot,
        "PGroup": OpenGLPGroup,
        "Point": EditorPoint,
    }
