"""Turn annotation strings such as ``Point3DLike | None`` into port types.

Manim annotates with ``from __future__ import annotations``, so every annotation
is text, and most name a Manim alias (``ParsableManimColor``, ``Vector3DLike``).
Mapping by name keeps that meaning; resolving the alias would expand it into a
long union and lose it.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, get_args, get_origin

from engine.catalogue.model import PortType, TypeRef


@dataclass
class Node:
    name: str
    args: list[Node] = field(default_factory=list)


_TOKEN = re.compile(r"\s*(\"[^\"]*\"|'[^']*'|[\w.]+|\[|\]|,|\|)")


def parse(text: str) -> list[Node]:
    """Parse an annotation into its top-level union members."""
    tokens: list[str] = _TOKEN.findall(text)
    position = 0

    def peek() -> str | None:
        return tokens[position] if position < len(tokens) else None

    def take() -> str:
        nonlocal position
        token = tokens[position]
        position += 1
        return token

    def union() -> list[Node]:
        members = [term()]
        while peek() == "|":
            take()
            members.append(term())
        return members

    def term() -> Node:
        token = take()
        if token == "[":
            return Node("[]", arguments())
        node = Node(token)
        if peek() == "[":
            take()
            node.args = arguments()
        return node

    def arguments() -> list[Node]:
        args: list[Node] = []
        while peek() not in ("]", None):
            members = union()
            args.append(members[0] if len(members) == 1 else Node("|", members))
            if peek() == ",":
                take()
        if peek() == "]":
            take()
        return args

    return union()


_NUMBER = {"float", "int", "complex", "ManimFloat", "ManimInt"}
_TEXT = {"str", "StrPath", "PathLike", "Path", "StrOrBytesPath"}
_COLOR = {"ParsableManimColor", "ManimColor"}
_VECTOR = {
    "Point3DLike",
    "Point3D",
    "Point2DLike",
    "Point2D",
    "PointNDLike",
    "PointND",
    "InternalPoint3D",
    "Vector3DLike",
    "Vector3D",
    "Vector2D",
    "VectorND",
    "ColVector",
    "RowVector",
    "np.ndarray",
    "ndarray",
    "NDArray",
    "npt.NDArray",
    "Point3D_Array",
    "Point3DLike_Array",
    "Point2D_Array",
    "Point2DLike_Array",
    "MatrixMN",
}
_CONFIG = {"dict", "Mapping", "MutableMapping"}
_COLLECTION = {
    "Sequence",
    "MutableSequence",
    "Iterable",
    "Iterator",
    "list",
    "tuple",
    "Collection",
    "List",
    "Tuple",
}
_ANY = {"Any", "object", "Hashable"}
# Alias families from manim.typing: points, bezier curves, and colour tuples.
_VECTOR_PATTERN = re.compile(r"^(Cubic)?Bezier|^Point|^Vector|Spline|^InternalPoint")
_COLOR_PATTERN = re.compile(r"^(Float|Int)(RGB|HSV|HSL)|^ManimColorT$")
_TYPEVAR_PATTERN = re.compile(r"^[A-Z]$")

_PRIORITY = [
    PortType.MOBJECT,
    PortType.COORDINATE_SYSTEM,
    PortType.ANIMATION,
    PortType.LIVE_NUMBER,
    PortType.FUNCTION,
    PortType.COLOR,
    PortType.VECTOR,
    PortType.NUMBER,
    PortType.TEXT,
    PortType.BOOLEAN,
    PortType.CONFIG,
    PortType.SCENE,
    PortType.ANY,
]


@dataclass
class TypeContext:
    """What the mapper needs to know about the Manim namespace."""

    classes: Mapping[str, PortType]
    namespace: Mapping[str, Any]
    unknown: set[str] = field(default_factory=set)


@dataclass
class _Mapped:
    type: PortType
    collection: bool = False
    signature: str | None = None
    choices: list[str] | None = None


def map_annotation(
    text: str, context: TypeContext, self_type: PortType | None = None
) -> TypeRef:
    if not text or text == "inspect._empty":
        return TypeRef(type=PortType.ANY, annotation="")
    members = parse(text)
    mapped = [_map_node(node, context, self_type, text) for node in members]
    optional = any(m.type == PortType.NONE for m in mapped)
    real = [m for m in mapped if m.type != PortType.NONE]
    if not real:
        return TypeRef(type=PortType.NONE, annotation=text)
    primary = min(
        real, key=lambda m: _PRIORITY.index(m.type) if m.type in _PRIORITY else 99
    )
    known: set[PortType] = {m.type for m in real if m.type is not PortType.ANY}
    if not known:
        known = {PortType.ANY}
    accepts = sorted(known, key=lambda t: _PRIORITY.index(t) if t in _PRIORITY else 99)
    return TypeRef(
        type=primary.type,
        annotation=text,
        optional=optional,
        collection=primary.collection,
        accepts=accepts if len(accepts) > 1 else [],
        signature=primary.signature,
        choices=primary.choices,
    )


def _map_node(
    node: Node, context: TypeContext, self_type: PortType | None, source: str
) -> _Mapped:
    name = node.name
    if name == "|":
        members = [_map_node(a, context, self_type, source) for a in node.args]
        real = [m for m in members if m.type != PortType.NONE] or members
        return min(
            real, key=lambda m: _PRIORITY.index(m.type) if m.type in _PRIORITY else 99
        )
    if name == "None":
        return _Mapped(PortType.NONE)
    if name == "Self":
        return _Mapped(self_type or PortType.ANY)
    plain = name.removeprefix("OpenGL")
    if plain in context.classes:
        return _Mapped(context.classes[plain])
    if name in _NUMBER:
        return _Mapped(PortType.NUMBER)
    if name == "bool":
        return _Mapped(PortType.BOOLEAN)
    if name in _TEXT:
        return _Mapped(PortType.TEXT)
    if name in _COLOR:
        return _Mapped(PortType.COLOR)
    if name in _VECTOR or _VECTOR_PATTERN.match(name):
        return _Mapped(PortType.VECTOR, collection=name.endswith("_Array"))
    if _COLOR_PATTERN.match(name):
        return _Mapped(PortType.COLOR, collection=name.endswith("_Array"))
    if name in _CONFIG:
        return _Mapped(PortType.CONFIG)
    if name in _ANY or _TYPEVAR_PATTERN.match(name):
        return _Mapped(PortType.ANY)
    if name == "_AnimationBuilder":
        return _Mapped(PortType.ANIMATION)
    if name == "Literal":
        return _Mapped(PortType.TEXT, choices=[a.name for a in node.args])
    if name in ("type", "Type"):
        # A class used as a value, for example ``label_constructor=MathTex``.
        return _Mapped(PortType.TEXT)
    if name == "Callable":
        return _Mapped(PortType.FUNCTION, signature=_callable_signature(node))
    if name in _COLLECTION:
        if node.args:
            inner = _map_node(node.args[0], context, self_type, source)
            return _Mapped(inner.type, collection=True, signature=inner.signature)
        return _Mapped(PortType.ANY, collection=True)
    target = context.namespace.get(name)
    if isinstance(target, type) and issubclass(target, Enum):
        return _Mapped(PortType.TEXT, choices=[f"{name}.{m.name}" for m in target])
    alias_signature = _alias_signature(target)
    if alias_signature is not None:
        return _Mapped(PortType.FUNCTION, signature=alias_signature)
    context.unknown.add(source)
    return _Mapped(PortType.ANY)


def _callable_signature(node: Node) -> str:
    if len(node.args) != 2:
        return "(...) -> any"
    params, result = node.args
    inputs = ", ".join(_short(a) for a in params.args) if params.name == "[]" else "..."
    return f"({inputs}) -> {_short(result)}"


def _short(node: Node) -> str:
    if node.name == "|":
        return " | ".join(_short(a) for a in node.args)
    if node.name in _VECTOR:
        return "point"
    if node.name in _NUMBER:
        return node.name if node.name in ("float", "int", "complex") else "float"
    if node.args:
        return f"{node.name}[{', '.join(_short(a) for a in node.args)}]"
    return node.name


def _alias_signature(target: Any) -> str | None:
    """Signature text for a ``Callable[...]`` alias object from ``manim.typing``."""
    if get_origin(target) is not Callable:
        return None
    args = get_args(target)
    if len(args) != 2:
        return None
    params, result = args
    inputs = (
        ", ".join(_type_short(a) for a in params) if isinstance(params, list) else "..."
    )
    return f"({inputs}) -> {_type_short(result)}"


def _type_short(value: Any) -> str:
    text = getattr(value, "__name__", None) or str(value)
    text = text.replace("numpy.", "np.")
    if "ndarray" in text or "NDArray" in text:
        return "point"
    return text
