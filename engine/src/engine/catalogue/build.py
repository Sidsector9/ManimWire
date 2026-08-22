"""Walk the installed Manim package and build the catalogue."""

from __future__ import annotations

import importlib
import inspect
import pkgutil
from functools import lru_cache
from importlib.metadata import version
from types import ModuleType
from typing import Any

import manim
from manim.animation.animation import Animation
from manim.mobject.graphing.coordinate_systems import CoordinateSystem
from manim.mobject.mobject import Mobject
from manim.mobject.opengl.opengl_mobject import OpenGLMobject
from manim.mobject.types.vectorized_mobject import VMobject
from manim.mobject.value_tracker import ValueTracker
from manim.scene.scene import Scene
from manim.utils.color import ManimColor, manim_colors

from engine.catalogue.annotations import TypeContext
from engine.catalogue.defaults import DIRECTION_NAMES
from engine.catalogue.extract import (
    class_descriptor,
    function_descriptor,
    method_descriptor,
)
from engine.catalogue.model import Catalogue, ColorEntry, Descriptor, PortType

_SKIP_MODULES = (
    "manim.cli",
    "manim._config",
    "manim.renderer",
    "manim.plugins",
    "manim.opengl",
    "manim.mobject.opengl",
    "manim.typing",
    "manim.constants",
    "manim.gui",
    "manim.__main__",
    "manim.utils.docbuild",
    "manim.utils.testing",
    "manim.utils.ipython_magic",
    "manim.utils.commands",
    "manim.utils.file_ops",
    "manim.utils.module_ops",
    "manim.utils.debug",
    "manim.utils.hashing",
    "manim.utils.caching",
    "manim.utils.exceptions",
    "manim.utils.deprecation",
    "manim.utils.parameter_parser",
    "manim.utils.simple_functions",
    "manim.utils.sounds",
    "manim.utils.opengl",
)

# Bases and helpers that exist for Manim's own structure, not for scene authors.
_HIDDEN = {
    "TipableVMobject",
    "ArrowTip",
    "CoordinateSystem",
    "AbstractImageMobject",
    "PMobject",
    "Mobject1D",
    "Mobject2D",
    "ThreeDVMobject",
    "ShowPartial",
    "ConvertToOpenGL",
    "LinearBase",
    "LogBase",
    "SingleStringMathTex",
    "VMobjectFromSVGPath",
}
_SKIP_NAMES = {
    "override_animation",
    "override_animate",
    "get_mobject_class",
    "get_point_mobject_class",
    "get_vectorized_mobject_class",
    "triggers_refreshed_triangulation",
    "assert_is_mobject_method",
}


def category_for(module: str) -> str:
    parts = module.split(".")
    if parts[1] == "mobject":
        if len(parts) > 3:
            return parts[2]
        return "value" if parts[2] == "value_tracker" else "mobject"
    if parts[1] == "animation":
        return f"animation.{parts[2]}"
    if parts[1] in ("scene", "camera"):
        return parts[1]
    if parts[1] == "utils":
        return "rate_functions" if parts[2] == "rate_functions" else f"utils.{parts[2]}"
    return parts[1]


def _modules() -> list[ModuleType]:
    modules: list[ModuleType] = []
    for info in pkgutil.walk_packages(manim.__path__, "manim."):
        if info.name.startswith(_SKIP_MODULES):
            continue
        try:
            module = importlib.import_module(info.name)
        except Exception:
            continue
        if getattr(module, "__all__", None):
            modules.append(module)
    return modules


def _output_type(cls: type) -> PortType | None:
    if issubclass(cls, CoordinateSystem):
        return PortType.COORDINATE_SYSTEM
    if issubclass(cls, ValueTracker):
        return PortType.LIVE_NUMBER
    if issubclass(cls, Mobject | OpenGLMobject):
        return PortType.MOBJECT
    if issubclass(cls, Animation):
        return PortType.ANIMATION
    if issubclass(cls, Scene):
        return PortType.SCENE
    return None


def build_catalogue() -> Catalogue:
    modules = _modules()
    classes: dict[str, tuple[type, ModuleType]] = {}
    functions: dict[str, tuple[Any, ModuleType]] = {}
    namespace: dict[str, Any] = {}
    for module in modules:
        for name in module.__all__:
            if name.startswith("_") or name in _SKIP_NAMES or name.startswith("OpenGL"):
                continue
            obj = getattr(module, name, None)
            namespace.setdefault(name, obj)
            if getattr(obj, "__name__", name) != name:
                continue  # an alias of something exported under its own name
            if inspect.isclass(obj):
                classes.setdefault(name, (obj, module))
            elif inspect.isfunction(obj):
                functions.setdefault(name, (obj, module))
    import manim.constants as manim_constants
    import manim.typing as manim_typing

    for extra in (manim_typing, manim_constants):
        for name in dir(extra):
            if not name.startswith("_"):
                namespace.setdefault(name, getattr(extra, name))

    class_types = {
        name: output
        for name, (cls, _) in classes.items()
        if (output := _output_type(cls)) is not None
    }
    context = TypeContext(classes=class_types, namespace=namespace)
    exported = set(classes)
    entries: list[Descriptor] = []
    for name, (cls, module) in classes.items():
        output = class_types.get(name, PortType.ANY)
        category = category_for(module.__name__)
        entries.append(
            class_descriptor(
                cls,
                module.__name__,
                category,
                context,
                output,
                issubclass(cls, VMobject),
                exported,
                name in _HIDDEN or output is PortType.ANY,
            )
        )
        for method_name, function in vars(cls).items():
            if method_name.startswith("_") or not inspect.isfunction(function):
                continue
            entries.append(
                method_descriptor(
                    cls,
                    method_name,
                    function,
                    module.__name__,
                    category,
                    context,
                    output,
                )
            )
    for name, (function, module) in functions.items():
        entries.append(
            function_descriptor(
                name, function, module.__name__, category_for(module.__name__), context
            )
        )
    colors = [
        ColorEntry(name=name, hex=value.to_hex().upper())
        for name in dir(manim_colors)
        if not name.startswith("_")
        and isinstance(value := getattr(manim_colors, name), ManimColor)
    ]
    return Catalogue(
        manim_version=version("manim"),
        entries=entries,
        colors=colors,
        directions=list(DIRECTION_NAMES),
        unknown_annotations=sorted(context.unknown),
    )


@lru_cache(maxsize=1)
def get_catalogue() -> Catalogue:
    return build_catalogue()
