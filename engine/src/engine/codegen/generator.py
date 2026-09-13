"""Turn a scene document into a Manim ``Scene`` subclass.

Construction statements come first in dependency order, then the steps. A live
node (see engine.document.analysis) becomes ``always_redraw`` when it builds a
mobject and ``add_updater`` when it is a method acting on one, so live
connections in the graph turn into Manim updaters without the user writing a
function (goal.md section 23). Map and Repeat containers become ``for`` loops,
collecting a list of what each run builds, or wrapping a ``self.play`` call when
a play step names the container; reusable groups are expanded in place
(engine.document.analysis).
"""

from __future__ import annotations

import keyword
import re
from collections.abc import Iterable
from typing import Protocol

from pydantic import BaseModel

from engine.catalogue.builtins import (
    ANIMATE,
    CAMERA_FRAME,
    COLOR,
    CONFIG,
    CONTAINERS,
    DERIVATIVE,
    EXPRESSION,
    FRAME_DELTA,
    IF,
    INDEX,
    INPUT,
    ITEM,
    MAP,
    NUMBER,
    OUTPUT,
    POINT,
    RANGE,
    REPEAT,
    RESULT,
    SCENE_TIME,
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
from engine.codegen.literals import LiteralFormatter
from engine.document.analysis import OBJECT_TYPES, RESULT_PORT, Graph, chain_port
from engine.document.model import (
    CAMERA_FIELDS,
    CAMERA_METHODS,
    FIXED_IN_FRAME_METHODS,
    MOBJECT_STEP_METHODS,
    SELF_PORT,
    UPDATING_METHODS,
    AddStep,
    BringToBackStep,
    BringToFrontStep,
    CameraStep,
    FixedInFrameStep,
    GroupDefinition,
    Node,
    PlayStep,
    RemoveStep,
    SceneDocument,
    SectionStep,
    SoundStep,
    SubcaptionStep,
    UpdatingStep,
    WaitStep,
)
from engine.document.validate import Issue, validate_scene
from engine.expression import parse_expression, to_source

AnyStep = (
    PlayStep
    | WaitStep
    | AddStep
    | RemoveStep
    | BringToFrontStep
    | BringToBackStep
    | SectionStep
    | SoundStep
    | SubcaptionStep
    | UpdatingStep
    | CameraStep
    | FixedInFrameStep
)

# Nodes that are read where they are used and never get a statement of their own.
_INLINE_ONLY = {
    SCENE_TIME.name,
    FRAME_DELTA.name,
    ITEM.name,
    INDEX.name,
    RESULT.name,
    INPUT.name,
    OUTPUT.name,
    CAMERA_FRAME.name,
}


class SourceMap(BaseModel):
    """1-based line numbers of the generated code, by node id and by step index."""

    nodes: dict[str, list[int]] = {}
    steps: dict[int, list[int]] = {}
    variables: dict[str, str] = {}
    # Nodes emitted as always_redraw or add_updater: they keep changing every frame.
    live: list[str] = []


class GeneratedCode(BaseModel):
    """Code is empty when the scene has issues; the UI shows the issues instead."""

    code: str
    source_map: SourceMap
    issues: list[Issue] = []


class CodeGenerator(Protocol):
    def generate(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        groups: Iterable[GroupDefinition] = (),
    ) -> GeneratedCode: ...


_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def snake_case(name: str) -> str:
    return _CAMEL.sub("_", name).lower()


class ManimCodeGenerator:
    def generate(
        self,
        scene: SceneDocument,
        catalogue: Catalogue,
        groups: Iterable[GroupDefinition] = (),
    ) -> GeneratedCode:
        groups = list(groups)
        issues = validate_scene(scene, catalogue, groups)
        if issues:
            return GeneratedCode(code="", source_map=SourceMap(), issues=issues)
        return _Build(scene, catalogue, groups).run()


class _Build:
    def __init__(
        self, scene: SceneDocument, catalogue: Catalogue, groups: list[GroupDefinition]
    ) -> None:
        self.scene = scene
        self.graph = Graph(scene, catalogue, groups)
        self.formatter = LiteralFormatter({c.name for c in catalogue.colors})
        self.variables: dict[str, str] = {}
        self.taken: set[str] = {"self", "mob", "dt"}
        self.body: list[str] = []
        self.map = SourceMap()
        self.uses_dt = False
        self.indent = 0
        # Loop variables of the containers being emitted, innermost last: (item, index).
        self.loops: dict[str, tuple[str, str]] = {}
        # Names assigned inside the loops being emitted; lambdas must bind them.
        self.scoped: list[str] = []
        # Containers a play step names: their loop wraps a play call, so they are
        # written where the step is, not with the other objects.
        self.played = {
            node_id
            for step in scene.steps
            if isinstance(step, PlayStep)
            for node_id in step.animations
            if node_id in self.graph.nodes
            and self.descriptor(self.graph.nodes[node_id]).name in CONTAINERS
        }

    # ---- driver -----------------------------------------------------------------

    def run(self) -> GeneratedCode:
        for node in self.ordered_nodes():
            if node.parent is None and node.id not in self.played:
                self.emit_node(node)
        for position, step in enumerate(self.scene.steps):
            self.emit_step(position, step)
        return self.assemble()

    def descriptor(self, node: Node) -> Descriptor:
        return self.graph.index[node.catalogue]

    def emit_node(self, node: Node) -> None:
        descriptor = self.descriptor(node)
        if descriptor.returns.type is PortType.ANIMATION:
            return  # animations are written inline where they are played
        if descriptor.name in _INLINE_ONLY:
            return
        if (
            (self.graph.is_live(node.id) or self.graph.is_deferred(node.id))
            and self.graph.is_value_node(node.id)
            and descriptor.name != STATE.name
        ):
            return  # live and deferred values are inlined where they are read
        if self.graph.is_instance(node.id):
            self.emit_instance(node)
        elif descriptor.name in CONTAINERS:
            self.emit_container(node, descriptor)
        else:
            self.emit_construction(node)

    def dependencies(self, node_id: str) -> list[str]:
        """Sources of a node; for a container, also what its children read outside."""
        sources = [e.source for e in self.graph.edges_in.get(node_id, [])]
        descriptor = self.graph.descriptor(node_id)
        if descriptor is not None and descriptor.name in CONTAINERS:
            inside = {c.id for c in self.descendants(node_id)}
            for child in inside:
                for edge in self.graph.edges_in.get(child, []):
                    if edge.source not in inside:
                        sources.append(edge.source)
        return sources

    def descendants(self, container_id: str) -> list[Node]:
        found: list[Node] = []
        for child in self.graph.children(container_id):
            found.append(child)
            found.extend(self.descendants(child.id))
        return found

    def ordered_nodes(self, among: Iterable[Node] | None = None) -> list[Node]:
        """Dependencies first, document order otherwise."""
        order: list[Node] = []
        done: set[str] = set()
        allowed = None if among is None else {n.id for n in among}

        def visit(node_id: str) -> None:
            if node_id in done or node_id not in self.graph.nodes:
                return
            done.add(node_id)
            for source in self.dependencies(node_id):
                if allowed is None or source in allowed:
                    visit(source)
            order.append(self.graph.nodes[node_id])

        for node in among if among is not None else self.scene.nodes:
            visit(node.id)
        return order

    # ---- constructions ----------------------------------------------------------

    def emit_construction(self, node: Node) -> None:
        descriptor = self.descriptor(node)
        live = self.graph.is_live(node.id)
        if descriptor.name == STATE.name:
            self.emit_state(node)
            return
        if descriptor.kind == "method":
            # The object may be a variable or an inline expression (self.camera.frame).
            receiver = self.expression(self.graph.sources(node.id, SELF_PORT)[0])
            if descriptor.returns.annotation == "Self" and not copies_its_object(
                descriptor
            ):
                self.variables[node.id] = receiver
                self.uses_dt = False
                arguments = self.arguments(node, descriptor)
                if live:
                    params = "mob, dt" if self.uses_dt else "mob"
                    call = f"mob.{descriptor.name}({arguments})"
                    self.line(
                        f"{receiver}.add_updater({self.closure(params, call)})", node.id
                    )
                    self.map.live.append(node.id)
                else:
                    self.line(f"{receiver}.{descriptor.name}({arguments})", node.id)
                return
            call = f"{receiver}.{descriptor.name}({self.arguments(node, descriptor)})"
        else:
            call = self.value_source(node, descriptor)
        name = self.new_variable(node.label or descriptor.name)
        self.variables[node.id] = name
        if live:
            self.line(f"{name} = always_redraw({self.closure('', call)})", node.id)
            self.map.live.append(node.id)
        else:
            self.line(f"{name} = {call}", node.id)

    def value_source(self, node: Node, descriptor: Descriptor) -> str:
        """The Python expression that builds a non-method node's value."""
        name = descriptor.name
        if name == EXPRESSION.name:
            return self.expression_source(node)
        if name == DERIVATIVE.name:
            return self.derivative_source(node)
        if name == CONFIG.name:
            return self.config_source(node)
        if name == RANGE.name:
            return self.range_source(node)
        if name == IF.name:
            return self.if_source(node)
        if name == SUBMOBJECT.name:
            return self.submobject_source(node)
        if name in (NUMBER.name, COLOR.name):
            return self.argument(node, descriptor.parameters[0]) or "0"
        if name == POINT.name:
            self.formatter.uses_numpy = True
            parts = [self.argument(node, p) or "0" for p in POINT.parameters]
            return f"np.array([{', '.join(parts)}])"
        if name == SUBMOBJECTS.name:
            owner = self.expression(self.graph.sources(node.id, "mobject")[0])
            return f"{owner}.submobjects"
        return f"{name}({self.arguments(node, descriptor)})"

    def emit_state(self, node: Node) -> None:
        name = self.new_variable(node.label or STATE.name)
        self.variables[node.id] = name
        params = {p.name: p for p in STATE.parameters}
        self.line(f"{name} = [{self.argument(node, params['initial'])}]", node.id)
        sources = self.graph.sources(node.id, "next")
        if sources:
            self.uses_dt = False
            value = self.expression(sources[0], params["next"].type)
            body = f"{name}.__setitem__(0, {value})"
            self.line(f"self.add_updater({self.closure('dt', body)})", node.id)
            self.map.live.append(node.id)

    def emit_container(self, node: Node, descriptor: Descriptor) -> None:
        name = self.new_variable(node.label or descriptor.name)
        self.variables[node.id] = name
        self.line(f"{name} = []", node.id)
        outer = self.open_loop(node, descriptor)
        self.emit_body(node)
        self.line(f"{name}.append({self.result_expression(node)})", node.id)
        self.close_loop(node.id, outer)

    def open_loop(
        self, node: Node, descriptor: Descriptor, step: int | None = None
    ) -> int:
        """Write a container's ``for`` statement and enter its scope.

        ``enumerate`` is only used when an Index node inside reads the position,
        so the common loop reads the way a person would write it.
        """
        inside = self.descendants(node.id)
        index = (
            self.new_variable("index")
            if any(
                child.catalogue == INDEX.name
                and self.graph.container_of(child.id) == node.id
                for child in inside
            )
            else ""
        )
        if descriptor.name == MAP.name:
            items = [
                child
                for child in inside
                if child.catalogue == ITEM.name
                and self.graph.nearest(child.id, MAP.name) == node.id
            ]
            label = next((c.label for c in items if c.label), None)
            item = self.new_variable(label or "item") if items else "_"
            source = self.expression(self.graph.sources(node.id, "items")[0])
            target = f"{index}, {item}" if index else item
            head = f"enumerate({source})" if index else source
        else:
            item = ""
            target = index or "_"
            head = f"range(int({self.argument(node, REPEAT.parameters[0])}))"
        self.line(f"for {target} in {head}:", node.id, step)
        self.loops[node.id] = (item, index)
        outer = len(self.scoped)
        # "_" stands for a loop variable nothing reads, so no lambda can capture it.
        self.scoped += [n for n in (item, index) if n and n != "_"]
        self.indent += 1
        return outer

    def emit_body(self, node: Node) -> None:
        for child in self.ordered_nodes(self.graph.children(node.id)):
            self.emit_node(child)

    def result_expression(self, node: Node) -> str:
        """What one run of a container contributes, read from its Result node."""
        result = next(
            c for c in self.graph.children(node.id) if c.catalogue == RESULT.name
        )
        sources = self.graph.sources(result.id, "value")
        return self.expression(sources[0]) if sources else "None"

    def close_loop(self, node_id: str, outer: int) -> None:
        self.indent -= 1
        del self.scoped[outer:]
        del self.loops[node_id]

    def emit_instance(self, node: Node) -> None:
        """A group instance stands for the value its Output copy receives."""
        outputs = self.graph.sources(node.id, RESULT_PORT)
        sources = self.graph.sources(outputs[0], "value") if outputs else []
        self.variables[node.id] = self.expression(sources[0]) if sources else "None"

    # ---- expressions ------------------------------------------------------------

    def expression(self, node_id: str, expected: TypeRef | None = None) -> str:
        """Python for a node's output where it is used, honouring the port it feeds."""
        value = self.value_expression(node_id, expected)
        if (
            expected is not None
            and takes_zero_argument_function(expected)
            and self.graph.output_type(node_id).type is not PortType.FUNCTION
        ):
            # A value on a function port is read each time the function is called.
            return self.closure("", value)
        return value

    def value_expression(self, node_id: str, expected: TypeRef | None = None) -> str:
        node = self.graph.nodes[node_id]
        descriptor = self.descriptor(node)
        name = descriptor.name
        if name == SCENE_TIME.name:
            return "self.time"
        if name == FRAME_DELTA.name:
            self.uses_dt = True
            return "dt"
        if name == CAMERA_FRAME.name:
            return "self.camera.frame"
        if name == ITEM.name:
            container = self.graph.nearest(node_id, MAP.name)
            return self.loops[container][0] if container else "None"
        if name == INDEX.name:
            container = self.graph.container_of(node_id)
            return self.loops[container][1] if container else "None"
        if name in (RESULT.name, OUTPUT.name):
            sources = self.graph.sources(node_id, "value")
            return self.expression(sources[0], expected) if sources else "None"
        if name == INPUT.name:
            return self.input_source(node)
        if self.graph.is_instance(node_id):
            outputs = self.graph.sources(node_id, RESULT_PORT)
            sources = self.graph.sources(outputs[0], "value") if outputs else []
            return self.expression(sources[0], expected) if sources else "None"
        if node_id in self.variables:
            variable = self.variables[node_id]
            if name == STATE.name:
                return f"{variable}[0]"
            # A ValueTracker is an object on mobject ports and a number elsewhere.
            wants_value = expected is not None and expected.type not in OBJECT_TYPES
            is_tracker = (
                descriptor.returns.type is PortType.LIVE_NUMBER
                and descriptor.kind == "class"
            )
            return f"{variable}.get_value()" if is_tracker and wants_value else variable
        if name == ANIMATE.name:
            return self.animate_source(node)
        if descriptor.kind == "method":
            receiver = self.expression(self.graph.sources(node_id, SELF_PORT)[0])
            return f"{receiver}.{name}({self.arguments(node, descriptor)})"
        return self.value_source(node, descriptor)

    def input_source(self, node: Node) -> str:
        sources = self.graph.sources(node.id, "value")
        type_name = str(node.values.get("type", "number"))
        try:
            port = PortType(type_name)
        except ValueError:
            port = PortType.ANY
        declared = TypeRef(type=port, annotation=port.value)
        if sources:
            return self.expression(sources[0], declared)
        if "value" in node.values:
            return self.formatter.format(node.values["value"], declared)
        return "None"

    def expression_source(self, node: Node) -> str:
        parsed = parse_expression(str(node.values.get("expr", "")))
        number = TypeRef(type=PortType.NUMBER, annotation="float")
        bindings: dict[str, str] = {}
        for variable in parsed.variables:
            sources = self.graph.sources(node.id, variable)
            if sources:
                bindings[variable] = self.expression(sources[0], number)
            elif variable in node.values:
                bindings[variable] = self.formatter.format(
                    node.values[variable], number
                )
        result = to_source(parsed, bindings)
        self.formatter.uses_numpy |= result.uses_numpy
        if result.free:
            head, body = result.source.split(": ", 1)
            return self.closure(head.removeprefix("lambda "), body)
        return result.source

    def derivative_source(self, node: Node) -> str:
        function = self.expression(self.graph.sources(node.id, "function")[0])
        if function.startswith("lambda"):
            function = f"({function})"
        body = f"({function}(x + 1e-4) - {function}(x - 1e-4)) / 2e-4"
        return self.closure("x", body)

    def config_source(self, node: Node) -> str:
        entries = []
        for param in self.graph.parameters(node.id):
            value = self.argument(node, param)
            if value is not None:
                entries.append(f"{param.name!r}: {value}")
        return "{" + ", ".join(entries) + "}"

    def range_source(self, node: Node) -> str:
        self.formatter.uses_numpy = True
        params = {p.name: p for p in RANGE.parameters}
        parts = [self.argument(node, params[n]) for n in ("start", "stop", "step")]
        return f"np.arange({', '.join(str(p) for p in parts)})"

    def if_source(self, node: Node) -> str:
        params = {p.name: p for p in IF.parameters}
        condition = self.argument(node, params["condition"])
        then = self.argument(node, params["then"]) or "None"
        otherwise = self.argument(node, params["else"]) or "None"
        return f"({then} if {condition} else {otherwise})"

    def submobject_source(self, node: Node) -> str:
        params = {p.name: p for p in SUBMOBJECT.parameters}
        mobject = self.expression(self.graph.sources(node.id, "mobject")[0])
        index = self.argument(node, params["index"]) or "0"
        literal = node.values.get("index")
        if self.graph.sources(node.id, "index") or not isinstance(literal, int):
            index = f"int({index})"
        return f"{mobject}.submobjects[{index}]"

    def animate_source(self, node: Node) -> str:
        params = {p.name: p for p in ANIMATE.parameters}
        target_id = self.graph.sources(node.id, "mobject")[0]
        target = self.expression(target_id)
        kwargs = []
        for name in ("run_time", "rate_func", "lag_ratio"):
            value = self.argument(node, params[name])
            if value is not None:
                kwargs.append(f"{name}={value}")
        chain = f"{target}.animate" + (f"({', '.join(kwargs)})" if kwargs else "")
        for position, call in enumerate(node.chain):
            method = self.graph.method_descriptor(target_id, call.method)
            assert method is not None  # validated
            parts = []
            for param in method.parameters:
                sources = self.graph.sources(
                    node.id, chain_port(position, call.method, param.name)
                )
                if sources:
                    value = self.expression(sources[0], param.type)
                elif param.name in call.values:
                    value = self.formatter.format(call.values[param.name], param.type)
                else:
                    continue
                positional = param.kind == "var_positional" or (
                    param.default is None and param.kind == "positional"
                )
                parts.append(value if positional else f"{param.name}={value}")
            chain += f".{call.method}({', '.join(parts)})"
        return chain

    def argument(self, node: Node, param: Parameter) -> str | None:
        """One argument: the connection, else the literal, else the Manim default."""
        sources = self.graph.sources(node.id, param.name)
        if sources:
            return self.collected(node, param, sources)
        if param.name in node.values:
            return self.formatter.format(node.values[param.name], param.type)
        if param.default not in (None, "None"):
            return param.default
        return None

    def collected(self, node: Node, param: Parameter, sources: list[str]) -> str:
        """A collection port takes several values, or one collection, as a list."""
        if not param.type.collection:
            return self.expression(sources[0], param.type)
        element = param.type.model_copy(update={"collection": False})
        if len(sources) == 1 and self.graph.output_type(sources[0]).collection:
            return self.expression(sources[0], param.type)
        return "[" + ", ".join(self.expression(s, element) for s in sources) + "]"

    def arguments(self, node: Node, descriptor: Descriptor) -> str:
        parts: list[str] = []
        for param in descriptor.parameters:
            sources = self.graph.sources(node.id, param.name)
            if param.kind == "var_positional":
                for source in sources:
                    spread = "*" if self.graph.output_type(source).collection else ""
                    parts.append(spread + self.expression(source, param.type))
                literal = node.values.get(param.name)
                if isinstance(literal, list) and all(
                    isinstance(v, str) for v in literal
                ):
                    # Several string literals for one *args port (Tex's parts).
                    parts.extend(self.formatter.format(v, param.type) for v in literal)
                elif param.name in node.values:
                    parts.append(
                        self.formatter.format(node.values[param.name], param.type)
                    )
                continue
            if sources:
                value = self.collected(node, param, sources)
            elif param.name in node.values:
                value = self.formatter.format(node.values[param.name], param.type)
            else:
                continue
            positional = param.default is None and param.kind == "positional"
            parts.append(value if positional else f"{param.name}={value}")
        return ", ".join(parts)

    def closure(self, params: str, body: str) -> str:
        """A lambda binding the loop-scoped names it reads: each run keeps its own."""
        bound = [
            f"{name}={name}" for name in self.scoped if re.search(rf"\b{name}\b", body)
        ]
        head = ", ".join(p for p in [params, *bound] if p)
        return f"lambda {head}: {body}" if head else f"lambda: {body}"

    def new_variable(self, label: str) -> str:
        base = snake_case(label)
        base = re.sub(r"\W+", "_", base).strip("_") or "value"
        if not base[0].isalpha():
            base = f"v_{base}"
        name = base
        counter = 2
        while name in self.taken or keyword.iskeyword(name):
            name = f"{base}_{counter}"
            counter += 1
        self.taken.add(name)
        if self.indent:
            self.scoped.append(name)
        return name

    # ---- steps ------------------------------------------------------------------

    def emit_step(self, position: int, step: AnyStep) -> None:
        if isinstance(step, PlayStep):
            container = next((a for a in step.animations if a in self.played), None)
            if container is not None:
                self.emit_played_container(container, position, step)
                return
            parts = [self.expression(a) for a in step.animations]
            parts += self.play_options(step)
            text = f"self.play({', '.join(parts)})"
        elif isinstance(step, WaitStep):
            text = f"self.wait({step.duration!r})"
        elif isinstance(step, SectionStep):
            skip = ", skip_animations=True" if step.skip_animations else ""
            text = f"self.next_section({step.name!r}{skip})"
        elif isinstance(step, SoundStep):
            parts = [repr(step.file)]
            if step.time_offset:
                parts.append(f"time_offset={step.time_offset!r}")
            if step.gain is not None:
                parts.append(f"gain={step.gain!r}")
            text = f"self.add_sound({', '.join(parts)})"
        elif isinstance(step, SubcaptionStep):
            parts = [repr(step.content), f"duration={step.duration!r}"]
            if step.offset:
                parts.append(f"offset={step.offset!r}")
            text = f"self.add_subcaption({', '.join(parts)})"
        elif isinstance(step, UpdatingStep):
            method = UPDATING_METHODS[step.action]
            for mobject in step.mobjects:
                if self.graph.output_type(mobject).collection:
                    self.line(f"for mob in {self.expression(mobject)}:", step=position)
                    self.line(f"    mob.{method}()", step=position)
                else:
                    self.line(f"{self.expression(mobject)}.{method}()", step=position)
            return
        elif isinstance(step, CameraStep):
            parts = [
                f"{field}={getattr(step, field)!r}"
                for field in CAMERA_FIELDS
                if getattr(step, field) is not None
            ]
            if step.action == "move" and step.run_time is not None:
                parts.append(f"run_time={step.run_time!r}")
            text = f"self.{CAMERA_METHODS[step.action]}({', '.join(parts)})"
        elif isinstance(step, FixedInFrameStep):
            method = FIXED_IN_FRAME_METHODS[step.action]
            text = f"self.{method}({self.mobject_arguments(step.mobjects)})"
        else:
            method = MOBJECT_STEP_METHODS[step.kind]
            text = f"self.{method}({self.mobject_arguments(step.mobjects)})"
        self.line(text, step=position)

    def play_options(self, step: PlayStep) -> list[str]:
        parts = []
        if step.run_time is not None:
            parts.append(f"run_time={step.run_time!r}")
        if step.rate_func is not None:
            parts.append(f"rate_func={step.rate_func}")
        if step.lag_ratio is not None:
            parts.append(f"lag_ratio={step.lag_ratio!r}")
        if step.subcaption is not None:
            parts.append(f"subcaption={step.subcaption!r}")
            if step.subcaption_duration is not None:
                parts.append(f"subcaption_duration={step.subcaption_duration!r}")
            if step.subcaption_offset:
                parts.append(f"subcaption_offset={step.subcaption_offset!r}")
        return parts

    def emit_played_container(
        self, node_id: str, position: int, step: PlayStep
    ) -> None:
        """A played Map or Repeat: one ``self.play`` inside the loop, once per run."""
        node = self.graph.nodes[node_id]
        outer = self.open_loop(node, self.descriptor(node), position)
        self.emit_body(node)
        parts = [self.result_expression(node)] + self.play_options(step)
        self.line(f"self.play({', '.join(parts)})", node_id, position)
        self.close_loop(node_id, outer)

    def mobject_arguments(self, ids: list[str]) -> str:
        """Objects for a Scene method; a collection (a Map's output) is spread."""
        parts = []
        for node_id in ids:
            spread = "*" if self.graph.output_type(node_id).collection else ""
            parts.append(spread + self.expression(node_id))
        return ", ".join(parts)

    # ---- output -----------------------------------------------------------------

    def line(self, text: str, node: str | None = None, step: int | None = None) -> None:
        self.body.append("    " * self.indent + text)
        number = len(self.body)  # relative; offset applied in assemble
        if node is not None:
            self.map.nodes.setdefault(node, []).append(number)
        if step is not None:
            self.map.steps.setdefault(step, []).append(number)

    def assemble(self) -> GeneratedCode:
        header = ["from manim import *"]
        if self.formatter.uses_numpy:
            header.append("import numpy as np")
        header += [
            "",
            "",
            f"class {self.scene.name}({self.scene.scene_type}):",
            "    def construct(self):",
        ]
        offset = len(header)
        body = [f"        {text}" for text in self.body] or ["        pass"]
        self.map.nodes = {k: [n + offset for n in v] for k, v in self.map.nodes.items()}
        self.map.steps = {k: [n + offset for n in v] for k, v in self.map.steps.items()}
        self.map.variables = dict(self.variables)
        return GeneratedCode(code="\n".join(header + body) + "\n", source_map=self.map)
