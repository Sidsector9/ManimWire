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


class Descriptor(BaseModel):
    name: str
    qualname: str
    module: str
    kind: Literal["class", "method", "function", "builtin"]
    category: str
    owner: str | None = None
    bases: list[str] = []
    parameters: list[Parameter]
    accepts_kwargs: bool = False
    returns: TypeRef
    doc: str = ""
    is_vmobject: bool = False
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
    unknown_annotations: list[str]
