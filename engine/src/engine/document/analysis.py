"""Facts about a scene graph shared by validation, code generation, and the timeline.

Liveness follows goal.md section 23: a live connection is a dependency that
Manim keeps up to date every frame. A node is live when it reads a live
connection, reads a value node that is live, or is one of the engine's
always-live nodes (scene time, frame delta, state).
"""

from __future__ import annotations

from functools import cached_property

from engine.catalogue.builtins import ALWAYS_LIVE, EXPRESSION
from engine.catalogue.model import Catalogue, Descriptor, Parameter, PortType, TypeRef
from engine.document.model import SELF_PORT, Edge, Node, SceneDocument
from engine.expression import ExpressionError, parse_expression, signature

# Outputs that are objects rather than values. Liveness does not pass through them.
OBJECT_TYPES = {
    PortType.MOBJECT,
    PortType.COORDINATE_SYSTEM,
    PortType.ANIMATION,
    PortType.SCENE,
}


class Graph:
    def __init__(self, scene: SceneDocument, catalogue: Catalogue) -> None:
        self.scene = scene
        self.index = {e.qualname: e for e in catalogue.entries}
        self.nodes = {n.id: n for n in scene.nodes}
        self.inputs: dict[tuple[str, str], list[str]] = {}
        self.edges_in: dict[str, list[Edge]] = {}
        for edge in scene.edges:
            self.inputs.setdefault((edge.target, edge.port), []).append(edge.source)
            self.edges_in.setdefault(edge.target, []).append(edge)
        self._live: dict[str, bool] = {}
        self._dt: dict[str, bool] = {}

    def descriptor(self, node_id: str) -> Descriptor | None:
        node = self.nodes.get(node_id)
        return self.index.get(node.catalogue) if node else None

    def sources(self, node_id: str, port: str) -> list[str]:
        return self.inputs.get((node_id, port), [])

    # ---- expressions -----------------------------------------------------------

    @cached_property
    def expressions(self) -> dict[str, tuple[list[str], str | None]]:
        """Per Expression node: (variables, parse error)."""
        result: dict[str, tuple[list[str], str | None]] = {}
        for node in self.scene.nodes:
            if node.catalogue != EXPRESSION.name:
                continue
            text = node.values.get("expr")
            try:
                parsed = parse_expression(text if isinstance(text, str) else "")
                result[node.id] = (parsed.variables, None)
            except ExpressionError as exc:
                result[node.id] = ([], str(exc))
        return result

    def free_variables(self, node_id: str) -> list[str]:
        node = self.nodes[node_id]
        variables = self.expressions.get(node_id, ([], None))[0]
        return [
            v
            for v in variables
            if v not in node.values and not self.sources(node_id, v)
        ]

    def parameters(self, node_id: str) -> list[Parameter]:
        """Catalogue parameters, plus one number port per Expression variable."""
        descriptor = self.descriptor(node_id)
        if descriptor is None:
            return []
        if descriptor.name != EXPRESSION.name:
            return descriptor.parameters
        variables = self.expressions.get(node_id, ([], None))[0]
        return descriptor.parameters + [
            Parameter(
                name=name,
                type=TypeRef(
                    type=PortType.NUMBER,
                    annotation="float",
                    optional=True,
                    accepts=[PortType.NUMBER, PortType.LIVE_NUMBER],
                ),
                default="None",
                display="free",
                owner="Expression",
            )
            for name in variables
        ]

    def output_type(self, node_id: str) -> TypeRef:
        """What a node produces. An Expression is a function of its free variables."""
        descriptor = self.descriptor(node_id)
        if descriptor is None:
            return TypeRef(type=PortType.ANY, annotation="")
        if descriptor.name == EXPRESSION.name:
            free = self.free_variables(node_id)
            if free:
                return TypeRef(
                    type=PortType.FUNCTION,
                    annotation="Callable",
                    signature=signature(free),
                )
            return TypeRef(type=PortType.NUMBER, annotation="float")
        return descriptor.returns

    # ---- liveness --------------------------------------------------------------

    def is_value_node(self, node_id: str) -> bool:
        descriptor = self.descriptor(node_id)
        if descriptor is None:
            return False
        if descriptor.kind == "class":
            return False  # a ValueTracker is an object; only its live edges are live
        return descriptor.returns.type not in OBJECT_TYPES

    def is_live(self, node_id: str) -> bool:
        if node_id in self._live:
            return self._live[node_id]
        self._live[node_id] = False  # guards cycles
        descriptor = self.descriptor(node_id)
        live = descriptor is not None and descriptor.name in ALWAYS_LIVE
        for edge in self.edges_in.get(node_id, []):
            if edge.live or (
                self.is_value_node(edge.source) and self.is_live(edge.source)
            ):
                live = True
        self._live[node_id] = live
        return live

    def reads_frame_delta(self, node_id: str) -> bool:
        """Whether the node's inline inputs include FrameDelta (needs ``dt``)."""
        if node_id in self._dt:
            return self._dt[node_id]
        self._dt[node_id] = False
        descriptor = self.descriptor(node_id)
        found = descriptor is not None and descriptor.name == "FrameDelta"
        for edge in self.edges_in.get(node_id, []):
            source = self.descriptor(edge.source)
            if source is not None and (
                source.name == "FrameDelta" or self.is_value_node(edge.source)
            ):
                found = found or self.reads_frame_delta(edge.source)
        self._dt[node_id] = found
        return found

    def root(self, node_id: str) -> str:
        """The node that constructs an object: follow method nodes back through self."""
        seen: set[str] = set()
        while node_id not in seen:
            seen.add(node_id)
            descriptor = self.descriptor(node_id)
            sources = self.sources(node_id, SELF_PORT)
            # A method returning a new object (axes.plot) constructs that object itself.
            if (
                descriptor is None
                or descriptor.kind != "method"
                or descriptor.returns.annotation != "Self"
                or not sources
            ):
                return node_id
            node_id = sources[0]
        return node_id

    def class_of(self, node_id: str) -> Descriptor | None:
        """The Manim class of the object a node produces, for method lookup."""
        descriptor = self.descriptor(self.root(node_id))
        if descriptor is None:
            return None
        if descriptor.kind == "class":
            return descriptor
        if descriptor.kind == "method" and descriptor.owner:
            return self.index.get(descriptor.owner)
        return None

    def method_descriptor(self, node_id: str, method: str) -> Descriptor | None:
        """``Class.method`` for the object at ``node_id``, searching its bases."""
        cls = self.class_of(node_id)
        if cls is None:
            return None
        for name in [cls.name, *cls.bases]:
            found = self.index.get(f"{name}.{method}")
            if found is not None:
                return found
        return None


def node_label(node: Node, descriptor: Descriptor | None) -> str:
    return str(node.label or (descriptor.name if descriptor else node.catalogue))
