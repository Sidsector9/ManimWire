"""Check a document against the catalogue before generating code."""

from __future__ import annotations

import re

from pydantic import BaseModel

from engine.catalogue.defaults import DIRECTION_NAMES
from engine.catalogue.model import Catalogue, Descriptor, Parameter, PortType, TypeRef
from engine.document.model import (
    SELF_PORT,
    Document,
    PlayStep,
    SceneDocument,
    Settings,
)

# A value of the key type may be connected to a port of any listed type.
_SUBTYPES: dict[PortType, set[PortType]] = {
    PortType.COORDINATE_SYSTEM: {PortType.MOBJECT},
    PortType.LIVE_NUMBER: {PortType.MOBJECT},
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
    issues: list[Issue] = []
    reserved = {e.name for e in catalogue.entries if e.kind != "method"}
    reserved |= {c.name for c in catalogue.colors} | set(DIRECTION_NAMES) | {"Scene"}
    issues.extend(
        _settings_issues(document.settings, {c.name for c in catalogue.colors})
    )
    for scene in document.scenes:
        if not scene.name.isidentifier() or scene.name in reserved:
            issues.append(
                Issue(
                    code="bad_scene_name",
                    message=f"{scene.name!r} is not a usable scene name",
                )
            )
        issues.extend(validate_scene(scene, catalogue))
    return issues


def validate_scene(scene: SceneDocument, catalogue: Catalogue) -> list[Issue]:
    index = {e.qualname: e for e in catalogue.entries}
    colors = {c.name for c in catalogue.colors}
    nodes = {n.id: n for n in scene.nodes}
    issues: list[Issue] = []

    descriptors: dict[str, Descriptor] = {}
    for node in scene.nodes:
        descriptor = index.get(node.catalogue)
        if descriptor is None:
            issues.append(
                _issue(
                    "unknown_catalogue", f"unknown Manim name {node.catalogue}", node.id
                )
            )
            continue
        descriptors[node.id] = descriptor
        params = {p.name: p for p in descriptor.parameters}
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
            elif (problem := _literal_problem(value, param.type, colors)) is not None:
                issues.append(_issue("bad_literal", problem, node.id, port))

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
            elif not compatible(source.returns, receiver_type(target, index)):
                issues.append(
                    _mismatch(
                        source,
                        target,
                        edge.port,
                        receiver_type(target, index),
                        edge.target,
                    )
                )
            continue
        param = next((p for p in target.parameters if p.name == edge.port), None)
        if param is None:
            issues.append(
                _issue(
                    "unknown_port",
                    f"{target.qualname} has no parameter {edge.port}",
                    edge.target,
                    edge.port,
                )
            )
        elif not compatible(source.returns, param.type):
            issues.append(_mismatch(source, target, edge.port, param.type, edge.target))

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
        for param in descriptor.parameters:
            if (
                _required(param)
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
        ids = (
            step.animations
            if isinstance(step, PlayStep)
            else getattr(step, "mobjects", [])
        )
        for node_id in ids:
            descriptor = descriptors.get(node_id)
            if node_id not in nodes:
                issues.append(
                    Issue(
                        code="unknown_node",
                        message=f"step {position} names a missing node",
                        step=position,
                    )
                )
            elif descriptor is None:
                continue
            elif (
                isinstance(step, PlayStep)
                and descriptor.returns.type is not PortType.ANIMATION
            ):
                issues.append(
                    Issue(
                        code="not_animation",
                        message=f"{descriptor.qualname} is not an animation",
                        node=node_id,
                        step=position,
                    )
                )
            elif not isinstance(step, PlayStep) and not compatible(
                descriptor.returns, TypeRef(type=PortType.MOBJECT, annotation="Mobject")
            ):
                issues.append(
                    Issue(
                        code="not_mobject",
                        message=f"{descriptor.qualname} is not a mobject",
                        node=node_id,
                        step=position,
                    )
                )
    return issues


_HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


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
    source: Descriptor, target: Descriptor, port: str, expected: TypeRef, node: str
) -> Issue:
    return Issue(
        code="type_mismatch",
        message=(
            f"{source.qualname} produces {source.returns.type.value}, "
            f"{target.qualname}.{port} expects {expected.type.value}"
        ),
        node=node,
        port=port,
    )


def _literal_problem(value: object, type_ref: TypeRef, colors: set[str]) -> str | None:
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
    if kind in (
        PortType.MOBJECT,
        PortType.COORDINATE_SYSTEM,
        PortType.ANIMATION,
        PortType.LIVE_NUMBER,
        PortType.FUNCTION,
    ):
        return f"{kind.value} values must be connected, not typed"
    return None


def _cycles(scene: SceneDocument) -> list[Issue]:
    outgoing: dict[str, list[str]] = {n.id: [] for n in scene.nodes}
    for edge in scene.edges:
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
