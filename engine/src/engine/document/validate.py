"""Check a document against the catalogue before generating code."""

from __future__ import annotations

import re
from collections.abc import Mapping

from pydantic import BaseModel

from engine.catalogue.builtins import ANIMATE, EXPRESSION, STATE
from engine.catalogue.defaults import DIRECTION_NAMES
from engine.catalogue.model import (
    Catalogue,
    Descriptor,
    Parameter,
    PortType,
    TypeRef,
    is_class_reference,
)
from engine.document.analysis import Graph, chain_port
from engine.document.model import (
    SELF_PORT,
    Document,
    Node,
    PlayStep,
    SceneDocument,
    SectionStep,
    Settings,
    SoundStep,
    Step,
    SubcaptionStep,
    UpdatingStep,
    WaitStep,
)

# A value of the key type may be connected to a port of any listed type.
_SUBTYPES: dict[PortType, set[PortType]] = {
    PortType.COORDINATE_SYSTEM: {PortType.MOBJECT},
    # A ValueTracker is a mobject, and read through get_value() it is a number.
    PortType.LIVE_NUMBER: {PortType.MOBJECT, PortType.NUMBER},
}


class Issue(BaseModel):
    code: str
    message: str
    node: str | None = None
    port: str | None = None
    step: int | None = None


def compatible(source: TypeRef, target: TypeRef) -> bool:
    if PortType.ANY in (source.type, target.type):
        return True
    targets = set(target.accepts) | {target.type}
    sources = _SUBTYPES.get(source.type, set()) | {source.type}
    return bool(targets & sources)


def receiver_type(descriptor: Descriptor, index: dict[str, Descriptor]) -> TypeRef:
    """The type a method node's ``self`` port accepts."""
    owner = index.get(descriptor.owner or "")
    return owner.returns if owner else TypeRef(type=PortType.ANY, annotation="")


def validate_document(document: Document, catalogue: Catalogue) -> list[Issue]:
    issues = document_issues(document, catalogue)
    for scene in document.scenes:
        issues.extend(validate_scene(scene, catalogue))
    return issues


def document_issues(document: Document, catalogue: Catalogue) -> list[Issue]:
    """Settings and scene name problems, independent of any scene's graph."""
    reserved = {e.name for e in catalogue.entries if e.kind != "method"}
    reserved |= {c.name for c in catalogue.colors} | set(DIRECTION_NAMES) | {"Scene"}
    issues = _settings_issues(document.settings, {c.name for c in catalogue.colors})
    for scene in document.scenes:
        if not scene.name.isidentifier() or scene.name in reserved:
            issues.append(
                Issue(
                    code="bad_scene_name",
                    message=f"{scene.name!r} is not a usable scene name",
                )
            )
    return issues


def validate_scene(scene: SceneDocument, catalogue: Catalogue) -> list[Issue]:
    graph = Graph(scene, catalogue)
    colors = {c.name for c in catalogue.colors}
    functions = function_signatures(catalogue)
    classes = {e.name for e in catalogue.entries if e.kind == "class"}
    nodes = graph.nodes
    issues: list[Issue] = []

    descriptors: dict[str, Descriptor] = {}
    for node in scene.nodes:
        descriptor = graph.descriptor(node.id)
        if descriptor is None:
            issues.append(
                _issue(
                    "unknown_catalogue", f"unknown Manim name {node.catalogue}", node.id
                )
            )
            continue
        descriptors[node.id] = descriptor
        if descriptor.name == EXPRESSION.name:
            error = graph.expressions.get(node.id, ([], None))[1]
            if error:
                issues.append(_issue("bad_expression", error, node.id, "expr"))
        params = {p.name: p for p in graph.parameters(node.id)}
        for port, value in node.values.items():
            param = params.get(port)
            if param is None:
                issues.append(
                    _issue(
                        "unknown_port",
                        f"{node.catalogue} has no parameter {port}",
                        node.id,
                        port,
                    )
                )
            elif (
                problem := _literal_problem(
                    value, param.type, colors, functions, classes
                )
            ) is not None:
                issues.append(_issue("bad_literal", problem, node.id, port))
        if descriptor.name == ANIMATE.name:
            issues.extend(_animate_issues(node, graph, colors, functions, classes))

    connected: dict[tuple[str, str], list[str]] = {}
    for edge in scene.edges:
        if edge.source not in nodes or edge.target not in nodes:
            issues.append(
                Issue(
                    code="unknown_node",
                    message=f"edge {edge.source} -> {edge.target} names a missing node",
                )
            )
            continue
        connected.setdefault((edge.target, edge.port), []).append(edge.source)
        source = descriptors.get(edge.source)
        target = descriptors.get(edge.target)
        if source is None or target is None:
            continue
        produced = graph.output_type(edge.source)
        if edge.port == SELF_PORT:
            if target.kind != "method":
                issues.append(
                    _issue(
                        "unknown_port",
                        f"{target.qualname} is not a method",
                        edge.target,
                        edge.port,
                    )
                )
            elif not compatible(produced, receiver_type(target, graph.index)):
                issues.append(
                    _mismatch(
                        source,
                        produced,
                        target,
                        edge.port,
                        receiver_type(target, graph.index),
                        edge.target,
                    )
                )
            continue
        param = next(
            (p for p in graph.parameters(edge.target) if p.name == edge.port), None
        )
        if param is None:
            issues.append(
                _issue(
                    "unknown_port",
                    f"{target.qualname} has no parameter {edge.port}",
                    edge.target,
                    edge.port,
                )
            )
        elif not compatible(produced, param.type):
            issues.append(
                _mismatch(source, produced, target, edge.port, param.type, edge.target)
            )

    for node in scene.nodes:
        descriptor = descriptors.get(node.id)
        if descriptor is None:
            continue
        if descriptor.kind == "method" and (node.id, SELF_PORT) not in connected:
            issues.append(
                _issue(
                    "missing_required",
                    f"{descriptor.qualname} needs an object to act on",
                    node.id,
                    SELF_PORT,
                )
            )
        for param in graph.parameters(node.id):
            if (
                _required(param)
                and param.display != "chain"  # checked with its call below
                and param.name not in node.values
                and (node.id, param.name) not in connected
            ):
                issues.append(
                    _issue(
                        "missing_required",
                        f"{descriptor.qualname} needs {param.name}",
                        node.id,
                        param.name,
                    )
                )
        if (
            not graph.is_value_node(node.id)
            and graph.reads_frame_delta(node.id)
            and not _is_updater(node.id, graph)
        ):
            issues.append(
                _issue(
                    "bad_live",
                    "FrameDelta can only feed a method acting on a live object",
                    node.id,
                )
            )

    for (node_id, port), sources in connected.items():
        descriptor = descriptors.get(node_id)
        if descriptor is None or len(sources) < 2:
            continue
        param = next((p for p in descriptor.parameters if p.name == port), None)
        if param is None or param.kind != "var_positional":
            issues.append(
                _issue(
                    "duplicate_connection",
                    f"{descriptor.qualname}.{port} accepts one connection",
                    node_id,
                    port,
                )
            )

    issues.extend(_cycles(scene))

    for position, step in enumerate(scene.steps):
        issues.extend(_step_issues(position, step, graph, descriptors, functions))
    return issues


def _is_updater(node_id: str, graph: Graph) -> bool:
    """A live method node returning its object becomes an add_updater call."""
    descriptor = graph.descriptor(node_id)
    return (
        descriptor is not None
        and descriptor.kind == "method"
        and descriptor.returns.annotation == "Self"
        and graph.is_live(node_id)
    )


def _animate_issues(
    node: Node,
    graph: Graph,
    colors: set[str],
    functions: Mapping[str, str],
    classes: set[str],
) -> list[Issue]:
    issues: list[Issue] = []
    if not node.chain:
        issues.append(
            _issue("missing_required", "Animate needs at least one method", node.id)
        )
    targets = graph.sources(node.id, "mobject")
    for position, call in enumerate(node.chain):
        method = graph.method_descriptor(targets[0], call.method) if targets else None
        if method is None:
            if targets:
                issues.append(
                    _issue(
                        "bad_chain", f"the object has no method {call.method}", node.id
                    )
                )
            continue
        params = {p.name: p for p in method.parameters}
        for name, value in call.values.items():
            param = params.get(name)
            if param is None:
                issues.append(
                    _issue(
                        "bad_chain", f"{call.method} has no parameter {name}", node.id
                    )
                )
            elif (
                problem := _literal_problem(
                    value, param.type, colors, functions, classes
                )
            ) is not None:
                issues.append(
                    _issue("bad_chain", f"{call.method}.{name}: {problem}", node.id)
                )
        for param in method.parameters:
            port = chain_port(position, call.method, param.name)
            if (
                _required(param)
                and param.name not in call.values
                and not graph.sources(node.id, port)
            ):
                issues.append(
                    _issue(
                        "bad_chain",
                        f"chain step {position + 1}: {call.method} needs {param.name}",
                        node.id,
                    )
                )
    return issues


def _step_issues(
    position: int,
    step: Step,
    graph: Graph,
    descriptors: Mapping[str, Descriptor],
    functions: Mapping[str, str],
) -> list[Issue]:
    issues: list[Issue] = []
    nodes = graph.nodes

    def bad(code: str, message: str, node: str | None = None) -> None:
        issues.append(Issue(code=code, message=message, node=node, step=position))

    if isinstance(step, PlayStep):
        ids = step.animations
        if step.run_time is not None and step.run_time <= 0:
            bad("bad_step", "run_time must be positive")
        if step.lag_ratio is not None and step.lag_ratio < 0:
            bad("bad_step", "lag_ratio must not be negative")
        if (
            step.rate_func is not None
            and functions.get(step.rate_func) != RATE_FUNCTION
        ):
            bad("bad_step", f"{step.rate_func} is not a rate function")
    elif isinstance(step, WaitStep):
        ids = []
        if step.duration <= 0:
            bad("bad_step", "wait duration must be positive")
    elif isinstance(step, SectionStep):
        ids = []
        if not step.name:
            bad("bad_step", "section needs a name")
    elif isinstance(step, SoundStep):
        ids = []
        if not step.file:
            bad("bad_step", "sound needs a file")
    elif isinstance(step, SubcaptionStep):
        ids = []
        if step.duration <= 0:
            bad("bad_step", "subcaption duration must be positive")
    elif isinstance(step, UpdatingStep):
        ids = list(step.mobjects)
    else:
        ids = list(getattr(step, "mobjects", []))
    for node_id in ids:
        descriptor = descriptors.get(node_id)
        if node_id not in nodes:
            bad("unknown_node", f"step {position} names a missing node")
        elif descriptor is None:
            continue
        elif isinstance(step, PlayStep):
            if descriptor.returns.type is not PortType.ANIMATION:
                bad(
                    "not_animation",
                    f"{descriptor.qualname} is not an animation",
                    node_id,
                )
        elif not compatible(
            graph.output_type(node_id),
            TypeRef(type=PortType.MOBJECT, annotation="Mobject"),
        ):
            bad("not_mobject", f"{descriptor.qualname} is not a mobject", node_id)
    return issues


_HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
RATE_FUNCTION = "(float) -> float"


def function_signatures(catalogue: Catalogue) -> dict[str, str]:
    """Signature text per catalogue function, as computed by the catalogue."""
    return {
        e.name: e.signature
        for e in catalogue.entries
        if e.kind == "function" and e.signature is not None
    }


def _settings_issues(settings: Settings, colors: set[str]) -> list[Issue]:
    issues: list[Issue] = []
    color = settings.background_color
    if color not in colors and not _HEX_COLOR.match(color):
        issues.append(
            Issue(code="bad_setting", message=f"unknown background colour {color}")
        )
    if settings.pixel_width <= 0 or settings.pixel_height <= 0:
        issues.append(Issue(code="bad_setting", message="resolution must be positive"))
    if settings.frame_rate <= 0:
        issues.append(Issue(code="bad_setting", message="frame rate must be positive"))
    return issues


def _required(param: Parameter) -> bool:
    return param.default is None and param.kind != "var_positional"


def _issue(code: str, message: str, node: str, port: str | None = None) -> Issue:
    return Issue(code=code, message=message, node=node, port=port)


def _mismatch(
    source: Descriptor,
    produced: TypeRef,
    target: Descriptor,
    port: str,
    expected: TypeRef,
    node: str,
) -> Issue:
    return Issue(
        code="type_mismatch",
        message=(
            f"{source.qualname} produces {produced.type.value}, "
            f"{target.qualname}.{port} expects {expected.type.value}"
        ),
        node=node,
        port=port,
    )


def _literal_problem(
    value: object,
    type_ref: TypeRef,
    colors: set[str],
    functions: Mapping[str, str],
    classes: set[str],
) -> str | None:
    if value is None:
        return None if type_ref.optional else "value must not be empty"
    kind = type_ref.type
    if type_ref.collection:
        if not isinstance(value, list):
            return "expected a list"
        return None
    if kind is PortType.NUMBER:
        return (
            None
            if isinstance(value, int | float) and not isinstance(value, bool)
            else "expected a number"
        )
    if kind is PortType.BOOLEAN:
        return None if isinstance(value, bool) else "expected true or false"
    if kind is PortType.TEXT:
        if not isinstance(value, str):
            return "expected text"
        if is_class_reference(type_ref):
            return None if value in classes else f"unknown Manim class {value}"
        if type_ref.choices and value not in type_ref.choices:
            return f"expected one of {', '.join(type_ref.choices)}"
        return None
    if kind is PortType.COLOR:
        if not isinstance(value, str):
            return "expected a colour name or hex value"
        return (
            None
            if value in colors or value.startswith("#")
            else f"unknown colour {value}"
        )
    if kind is PortType.VECTOR:
        if isinstance(value, str):
            return None if value in DIRECTION_NAMES else f"unknown direction {value}"
        if isinstance(value, list) and len(value) == 3:
            return None
        return "expected a direction name or three numbers"
    if kind is PortType.FUNCTION:
        if not isinstance(value, str) or value not in functions:
            return "expected the name of a Manim function, or a connection"
        if type_ref.signature and functions[value] != type_ref.signature:
            return (
                f"{value} has signature {functions[value]}, "
                f"port needs {type_ref.signature}"
            )
        return None
    if kind in (
        PortType.MOBJECT,
        PortType.COORDINATE_SYSTEM,
        PortType.ANIMATION,
        PortType.LIVE_NUMBER,
    ):
        return f"{kind.value} values must be connected, not typed"
    return None


def _cycles(scene: SceneDocument) -> list[Issue]:
    # State.next is a feedback port: its value is read on the next frame.
    feedback = {n.id for n in scene.nodes if n.catalogue == STATE.name}
    outgoing: dict[str, list[str]] = {n.id: [] for n in scene.nodes}
    for edge in scene.edges:
        if edge.target in feedback and edge.port == "next":
            continue
        if edge.source in outgoing and edge.target in outgoing:
            outgoing[edge.source].append(edge.target)
    state: dict[str, int] = {}
    issues: list[Issue] = []

    def visit(node_id: str) -> None:
        if state.get(node_id) == 1:
            issues.append(
                Issue(code="cycle", message="connections form a cycle", node=node_id)
            )
            return
        if state.get(node_id) == 2:
            return
        state[node_id] = 1
        for child in outgoing[node_id]:
            visit(child)
        state[node_id] = 2

    for node in scene.nodes:
        visit(node.id)
    return issues
