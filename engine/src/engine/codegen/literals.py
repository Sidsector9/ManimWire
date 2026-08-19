"""Write document literal values as Manim source, guided by the port type."""

from __future__ import annotations

from engine.catalogue.model import PortType, TypeRef
from engine.document.model import JsonValue


class LiteralFormatter:
    def __init__(self, color_names: set[str]) -> None:
        self.color_names = color_names
        self.uses_numpy = False

    def format(self, value: JsonValue, type_ref: TypeRef) -> str:
        if value is None:
            return "None"
        if type_ref.collection and isinstance(value, list):
            element = type_ref.model_copy(update={"collection": False})
            return "[" + ", ".join(self.format(item, element) for item in value) + "]"
        kind = type_ref.type
        if kind is PortType.COLOR and isinstance(value, str):
            return value if value in self.color_names else f'ManimColor("{value}")'
        if kind is PortType.VECTOR:
            if isinstance(value, list):
                self.uses_numpy = True
                return f"np.array({[float(v) for v in value]!r})"
            return str(value)
        if kind is PortType.FUNCTION and isinstance(value, str):
            return value  # a Manim function such as smooth, validated by name
        if kind is PortType.TEXT and isinstance(value, str):
            return (
                value if type_ref.choices and value in type_ref.choices else repr(value)
            )
        return repr(value)
