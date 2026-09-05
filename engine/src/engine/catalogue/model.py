"""Descriptors of what Manim exposes, produced by introspection and sent to the UI."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel


class PortType(StrEnum):
    MOBJECT = "mobject"
    COORDINATE_SYSTEM = "coordinate_system"
    NUMBER = "number"
    LIVE_NUMBER = "live_number"
    VECTOR = "vector"
    COLOR = "color"
    FUNCTION = "function"
    ANIMATION = "animation"
    TEXT = "text"
    BOOLEAN = "boolean"
    CONFIG = "config"
    SCENE = "scene"
    NONE = "none"
    ANY = "any"


class TypeRef(BaseModel):
    """A port type derived from an annotation."""

    type: PortType
    annotation: str
    optional: bool = False
    collection: bool = False
    accepts: list[PortType] = []
    signature: str | None = None
    choices: list[str] | None = None


def is_class_reference(type_ref: TypeRef) -> bool:
    """A ``type[X]`` parameter takes a class, for example ``animation_class=FadeIn``."""
    return type_ref.annotation.startswith(("type[", "Type["))


class Parameter(BaseModel):
    name: str
    type: TypeRef
    kind: Literal["positional", "keyword_only", "var_positional"] = "positional"
    default: str | None = None
    display: str | None = None
    owner: str


RATE_SAMPLES = 25

# Methods annotated ``Self`` that build a new object instead of changing the one
# they are called on. Manim's annotation is right about the class and says nothing
# about identity, so the name is the only thing that separates them. This is a
# list by name, and it holds the one such method Mobject has.
COPYING_METHODS = frozenset({"copy"})


def copies_its_object(descriptor: Descriptor) -> bool:
    """Whether a method returns a new object rather than the one it was called on."""
    return (
        descriptor.kind == "method"
        and descriptor.returns.annotation == "Self"
        and descriptor.name in COPYING_METHODS
    )


def takes_zero_argument_function(target: TypeRef) -> bool:
    """A function port that is called without arguments (TracedPath's point function).

    A value connected to it becomes ``lambda: value``, read each time it is called.
    Unknown signatures (plain ``Callable``) count, since nothing says otherwise.
    """
    return target.type is PortType.FUNCTION and (
        target.signature is None
        or target.signature.startswith("() ->")
        or target.signature == "(...) -> any"
    )


class Descriptor(BaseModel):
    name: str
    qualname: str
    module: str
    kind: Literal["class", "method", "function", "builtin", "group"]
    category: str
    owner: str | None = None
    bases: list[str] = []
    parameters: list[Parameter]
    accepts_kwargs: bool = False
    returns: TypeRef
    doc: str = ""
    is_vmobject: bool = False
    # Text classes rendered through LaTeX (Tex, MathTex, DecimalNumber, ...).
    requires_latex: bool = False
    hidden: bool = False
    # Functions only: the shape a Function port compares against, "(float) -> float".
    signature: str | None = None


class ColorEntry(BaseModel):
    name: str
    hex: str


class Catalogue(BaseModel):
    manim_version: str
    entries: list[Descriptor]
    colors: list[ColorEntry]
    # Direction and point constants a Vector port accepts by name (ORIGIN, UP, ...).
    directions: list[str]
    # Names the Expression node treats as functions or constants, not variables.
    expression_names: list[str]
    # Font families Pango can render, for Text and MarkupText.
    fonts: list[str] = []
    # Each rate function sampled at RATE_SAMPLES points on [0, 1], for curve previews.
    rate_curves: dict[str, list[float]] = {}
    unknown_annotations: list[str]
