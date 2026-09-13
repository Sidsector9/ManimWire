"""Facts about a scene graph shared by validation, code generation, and the timeline.

Liveness follows goal.md section 23: a live connection is a dependency that
Manim keeps up to date every frame. A node is live when it reads a live
connection, reads a value node that is live, or is one of the engine's
always-live nodes (scene time, frame delta, state).

Reusable groups are expanded here: every instance node gets a private copy of
the group's nodes and edges, so the rest of the engine only sees plain nodes.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from functools import cached_property

from engine.catalogue.builtins import (
    ALWAYS_LIVE,
    ANIMATE,
    CONFIG,
    CONTAINERS,
    EXPRESSION,
    IF,
    INPUT,
    ITEM,
    MAP,
    OUTPUT,
    RESULT,
    STATE,
    SUBMOBJECT,
    SUBMOBJECTS,
)
from engine.catalogue.model import (
    Catalogue,
    Descriptor,
    Parameter,
    PortType,
    TypeRef,
    copies_its_object,
    takes_zero_argument_function,
)
from engine.document.model import (
    GROUP_PREFIX,
    SELF_PORT,
    Edge,
    GroupDefinition,
    Node,
    SceneDocument,
)
from engine.expression import ExpressionError, parse_expression, signature

# Outputs that are objects rather than values. Liveness does not pass through them.
OBJECT_TYPES = {
    PortType.MOBJECT,
    PortType.COORDINATE_SYSTEM,
    PortType.ANIMATION,
    PortType.SCENE,
}
ANY = TypeRef(type=PortType.ANY, annotation="")
# The port through which a group instance receives its Output.
RESULT_PORT = "__result"
# Separator between an instance id and the ids of its private copies.
COPY_SEPARATOR = "/"


def chain_port(position: int, method: str, parameter: str) -> str:
    """Port name for one parameter of one call in an Animate chain."""
    return f"{position + 1}.{method}.{parameter}"


def group_index(
    catalogue: Catalogue, groups: Iterable[GroupDefinition]
) -> dict[str, Descriptor]:
    """One descriptor per group, in two passes so groups used inside groups resolve."""
    groups = list(groups)
    index: dict[str, Descriptor] = {}
    for _ in range(2):
        index = {
            GROUP_PREFIX + g.name: group_descriptor(g, catalogue, groups, index)
            for g in groups
        }
    return index


def group_descriptor(
    definition: GroupDefinition,
    catalogue: Catalogue,
    groups: Iterable[GroupDefinition],
    known: Mapping[str, Descriptor],
) -> Descriptor:
    """A descriptor for group instances: Inputs are parameters, Output is the return.

    ``known`` holds the descriptors of the other groups from the previous pass.
    """
    parameters: list[Parameter] = []
    for node in definition.nodes:
        if node.catalogue != INPUT.name:
            continue
        name = str(node.values.get("name", "input"))
        type_name = str(node.values.get("type", "number"))
        port = (
            PortType(type_name)
            if type_name in PortType.__members__.values()
            else PortType.ANY
        )
        parameters.append(
            Parameter(
                name=name,
                type=TypeRef(type=port, annotation=port.value, optional=True),
                default="None",
                display="None",
                owner=definition.name,
            )
        )
    returns = TypeRef(type=PortType.NONE, annotation="None")
    inner = Graph(
        SceneDocument(
            name=definition.name, nodes=definition.nodes, edges=definition.edges
        ),
        catalogue,
        groups,
        group_descriptors=known,
    )
    output = next((n for n in definition.nodes if n.catalogue == OUTPUT.name), None)
    sources = inner.sources(output.id, "value") if output else []
    if sources:
        returns = inner.output_type(sources[0])
    return Descriptor(
        name=definition.name,
        qualname=GROUP_PREFIX + definition.name,
        module="project",
        kind="group",
        category="group",
        parameters=parameters,
        returns=returns,
        doc=f"Reusable group {definition.name} from this project.",
    )


class Graph:
    def __init__(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        groups: Iterable[GroupDefinition] = (),
        group_descriptors: Mapping[str, Descriptor] | None = None,
    ) -> None:
        self.scene = scene
        self.groups = {g.name: g for g in groups}
        self.index = {e.qualname: e for e in catalogue.entries}
        if group_descriptors is None:
            group_descriptors = group_index(catalogue, self.groups.values())
        self.index.update(group_descriptors)
        self.nodes = {n.id: n for n in scene.nodes}
        self.edges = list(scene.edges)
        # (code, message, node) found while expanding groups; validation reports them.
        self.problems: list[tuple[str, str, str]] = []
        self._expand_groups(list(scene.nodes), ())
        self.inputs: dict[tuple[str, str], list[str]] = {}
        self.edges_in: dict[str, list[Edge]] = {}
        self.edges_out: dict[str, list[Edge]] = {}
        for edge in self.edges:
            self.inputs.setdefault((edge.target, edge.port), []).append(edge.source)
            self.edges_in.setdefault(edge.target, []).append(edge)
            self.edges_out.setdefault(edge.source, []).append(edge)
        self._live: dict[str, bool] = {}
        self._dt: dict[str, bool] = {}

    # ---- groups ------------------------------------------------------------------

    def _expand_groups(self, candidates: list[Node], stack: tuple[str, ...]) -> None:
        for instance in candidates:
            if not instance.catalogue.startswith(GROUP_PREFIX):
                continue
            name = instance.catalogue.removeprefix(GROUP_PREFIX)
            definition = self.groups.get(name)
            if definition is None:
                continue  # reported as unknown_catalogue by validation
            if name in stack:
                self.problems.append(
                    ("recursive_group", f"group {name} contains itself", instance.id)
                )
                continue
            self._expand(instance, definition, (*stack, name))

    def _expand(
        self, instance: Node, definition: GroupDefinition, stack: tuple[str, ...]
    ) -> None:
        prefix = instance.id + COPY_SEPARATOR
        copies: list[Node] = []
        for inner in definition.nodes:
            copy = inner.model_copy(
                update={
                    "id": prefix + inner.id,
                    "parent": prefix + inner.parent
                    if inner.parent
                    else instance.parent,
                    "label": _copy_label(instance, definition, inner),
                }
            )
            self.nodes[copy.id] = copy
            copies.append(copy)
            if inner.catalogue == INPUT.name:
                port = str(inner.values.get("name", "input"))
                for edge in self.scene.edges:
                    if edge.target == instance.id and edge.port == port:
                        self.edges.append(
                            Edge(
                                source=edge.source,
                                target=copy.id,
                                port="value",
                                live=edge.live,
                            )
                        )
                if port in instance.values:
                    copy.values = {**copy.values, "value": instance.values[port]}
            elif inner.catalogue == OUTPUT.name:
                self.edges.append(
                    Edge(source=copy.id, target=instance.id, port=RESULT_PORT)
                )
        for edge in definition.edges:
            self.edges.append(
                edge.model_copy(
                    update={
                        "source": prefix + edge.source,
                        "target": prefix + edge.target,
                    }
                )
            )
        self._expand_groups(copies, stack)

    def is_instance(self, node_id: str) -> bool:
        node = self.nodes.get(node_id)
        return node is not None and node.catalogue.startswith(GROUP_PREFIX)

    def is_copy(self, node_id: str) -> bool:
        return COPY_SEPARATOR in node_id

    def descriptor(self, node_id: str) -> Descriptor | None:
        node = self.nodes.get(node_id)
        return self.index.get(node.catalogue) if node else None

    def sources(self, node_id: str, port: str) -> list[str]:
        return self.inputs.get((node_id, port), [])

    def children(self, container_id: str) -> list[Node]:
        return [n for n in self.nodes.values() if n.parent == container_id]

    def container_of(self, node_id: str) -> str | None:
        node = self.nodes.get(node_id)
        return node.parent if node else None

    def nearest(self, node_id: str, catalogue_name: str) -> str | None:
        """The closest enclosing container of the given kind."""
        current = self.container_of(node_id)
        while current is not None:
            descriptor = self.descriptor(current)
            if descriptor is not None and descriptor.name == catalogue_name:
                return current
            current = self.container_of(current)
        return None

    # ---- expressions -----------------------------------------------------------

    @cached_property
    def expressions(self) -> dict[str, tuple[list[str], str | None, bool]]:
        """Per Expression node: (variables, parse error, boolean)."""
        result: dict[str, tuple[list[str], str | None, bool]] = {}
        for node in self.nodes.values():
            if node.catalogue != EXPRESSION.name:
                continue
            text = node.values.get("expr")
            try:
                parsed = parse_expression(text if isinstance(text, str) else "")
                result[node.id] = (parsed.variables, None, parsed.boolean)
            except ExpressionError as exc:
                result[node.id] = ([], str(exc), False)
        return result

    def free_variables(self, node_id: str) -> list[str]:
        node = self.nodes[node_id]
        variables = self.expressions.get(node_id, ([], None, False))[0]
        return [
            v
            for v in variables
            if v not in node.values and not self.sources(node_id, v)
        ]

    def parameters(self, node_id: str) -> list[Parameter]:
        """Catalogue parameters, plus the ports a node grows from its own values:
        one number port per Expression variable, one port per Animate chain
        argument, one port per Config key.
        """
        descriptor = self.descriptor(node_id)
        if descriptor is None:
            return []
        if descriptor.name == ANIMATE.name:
            return descriptor.parameters + self.chain_parameters(node_id)
        if descriptor.name == CONFIG.name:
            return [
                Parameter(
                    name=key.name,
                    type=TypeRef(
                        type=key.type, annotation=key.type.value, optional=True
                    ),
                    default="None",
                    display="key",
                    owner=CONFIG.name,
                )
                for key in self.nodes[node_id].config
            ]
        if descriptor.name != EXPRESSION.name:
            return descriptor.parameters
        variables = self.expressions.get(node_id, ([], None, False))[0]
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

    def chain_parameters(self, node_id: str) -> list[Parameter]:
        targets = self.sources(node_id, "mobject")
        if not targets:
            return []
        ports: list[Parameter] = []
        for position, call in enumerate(self.nodes[node_id].chain):
            method = self.method_descriptor(targets[0], call.method)
            for param in method.parameters if method else []:
                ports.append(
                    param.model_copy(
                        update={
                            "name": chain_port(position, call.method, param.name),
                            "display": "chain",
                            "owner": ANIMATE.name,
                        }
                    )
                )
        return ports

    def output_type(self, node_id: str) -> TypeRef:
        """What a node produces. An Expression is a function of its free variables."""
        descriptor = self.descriptor(node_id)
        if descriptor is None:
            return ANY
        if (
            descriptor.returns.type is PortType.LIVE_NUMBER
            and descriptor.kind != "class"
        ):
            # Time, frame delta, and state are numbers; only a tracker is an object.
            return TypeRef(type=PortType.NUMBER, annotation="float")
        if descriptor.kind == "method" and descriptor.returns.annotation == "Self":
            # Self is whatever it was called on: moving an Axes still gives an Axes,
            # which ports that want a coordinate system have to see.
            sources = self.sources(node_id, SELF_PORT)
            if sources:
                return self.output_type(sources[0])
        name = descriptor.name
        if name == EXPRESSION.name:
            free = self.free_variables(node_id)
            boolean = self.expressions.get(node_id, ([], None, False))[2]
            if free:
                return TypeRef(
                    type=PortType.FUNCTION,
                    annotation="Callable",
                    signature=signature(free, boolean),
                )
            if boolean:
                return TypeRef(type=PortType.BOOLEAN, annotation="bool")
            return TypeRef(type=PortType.NUMBER, annotation="float")
        if name == IF.name:
            for port in ("then", "else"):
                sources = self.sources(node_id, port)
                if sources:
                    return self.output_type(sources[0])
            return ANY
        if name == ITEM.name:
            container = self.nearest(node_id, MAP.name)
            sources = self.sources(container, "items") if container else []
            if sources:
                return self.output_type(sources[0]).model_copy(
                    update={"collection": False}
                )
            return ANY
        if name in CONTAINERS:
            result = next(
                (c for c in self.children(node_id) if c.catalogue == RESULT.name), None
            )
            sources = self.sources(result.id, "value") if result else []
            if sources:
                return self.output_type(sources[0]).model_copy(
                    update={"collection": True}
                )
            return descriptor.returns
        return descriptor.returns

    # ---- liveness --------------------------------------------------------------

    def is_value_node(self, node_id: str) -> bool:
        descriptor = self.descriptor(node_id)
        if descriptor is None:
            return False
        if descriptor.kind in ("class", "group") or descriptor.name in CONTAINERS:
            return False  # a ValueTracker is an object; only its live edges are live
        return descriptor.returns.type not in OBJECT_TYPES

    def is_live(self, node_id: str) -> bool:
        if node_id in self._live:
            return self._live[node_id]
        self._live[node_id] = False  # guards cycles
        descriptor = self.descriptor(node_id)
        live = descriptor is not None and descriptor.name in ALWAYS_LIVE
        for edge in self.edges_in.get(node_id, []):
            port = next(
                (p for p in self.parameters(node_id) if p.name == edge.port), None
            )
            if port is not None and takes_zero_argument_function(port.type):
                # The port is handed a lambda, so it reads the value itself every
                # time it calls it. The node it feeds is built once (TracedPath).
                continue
            if edge.live or (
                self.is_value_node(edge.source) and self.is_live(edge.source)
            ):
                live = True
            # A method on an object that is redrawn every frame must run every frame
            # too, or the redraw discards its effect.
            if edge.port == SELF_PORT and self.is_live(edge.source):
                live = True
        self._live[node_id] = live
        return live

    def is_deferred(self, node_id: str) -> bool:
        """A value read each time a zero-argument function port calls it (TracedPath).

        Such a value must not be computed once into a variable; it is inlined into
        the ``lambda`` that the port receives.
        """
        if not self.is_value_node(node_id):
            return False
        for edge in self.edges_out.get(node_id, []):
            param = next(
                (p for p in self.parameters(edge.target) if p.name == edge.port), None
            )
            if param is not None and takes_zero_argument_function(param.type):
                return True
        return False

    def reads_frame_delta(self, node_id: str) -> bool:
        """Whether the node's inline inputs include FrameDelta (needs ``dt``)."""
        if node_id in self._dt:
            return self._dt[node_id]
        self._dt[node_id] = False
        descriptor = self.descriptor(node_id)
        if descriptor is not None and descriptor.name == STATE.name:
            return False  # State consumes dt inside its own updater
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
            # A method returning a new object (axes.plot, mobject.copy) constructs
            # that object itself, so the chain stops there.
            if (
                descriptor is None
                or descriptor.kind != "method"
                or descriptor.returns.annotation != "Self"
                or copies_its_object(descriptor)
                or not sources
            ):
                return node_id
            node_id = sources[0]
        return node_id

    def class_of(self, node_id: str) -> Descriptor | None:
        """The Manim class of the object a node produces, for method lookup."""
        root = self.root(node_id)
        descriptor = self.descriptor(root)
        if descriptor is None:
            return None
        if descriptor.kind == "class":
            return descriptor
        if descriptor.kind == "method":
            if copies_its_object(descriptor):
                # A copy is the same kind of object as what it was copied from.
                sources = self.sources(root, SELF_PORT)
                return self.class_of(sources[0]) if sources else None
            if descriptor.returns.annotation == "Self" and descriptor.owner:
                return self.index.get(descriptor.owner)
            # A method building a new object (axes.plot -> ParametricFunction).
            return self.index.get(descriptor.returns.annotation)
        if descriptor.name in (SUBMOBJECT.name, SUBMOBJECTS.name):
            # All Manim promises about a part is that a VMobject's parts are
            # VMobjects (VMobject.add checks it). A MathTex's part is not a
            # MathTex, so the part is typed VMobject, not as its owner.
            sources = self.sources(root, "mobject")
            owner = self.class_of(sources[0]) if sources else None
            if owner is not None and owner.is_vmobject:
                return self.index.get("VMobject")
        # Engine nodes standing for a Manim object (CameraFrame -> ScreenRectangle).
        return self.index.get(descriptor.returns.annotation)

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


def _copy_label(instance: Node, definition: GroupDefinition, inner: Node) -> str:
    return f"{instance.label or definition.name} {inner.label or ''}".strip()


def node_label(node: Node, descriptor: Descriptor | None) -> str:
    return str(node.label or (descriptor.name if descriptor else node.catalogue))


def descriptors_of(graph: Graph) -> Mapping[str, Descriptor]:
    return {
        node_id: d
        for node_id in graph.nodes
        if (d := graph.descriptor(node_id)) is not None
    }
