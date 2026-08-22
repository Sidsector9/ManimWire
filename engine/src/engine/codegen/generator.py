"""Turn a scene document into a Manim ``Scene`` subclass.

Construction statements come first in dependency order, then the steps. A live
node (see engine.document.analysis) becomes ``always_redraw`` when it builds a
mobject and ``add_updater`` when it is a method acting on one, so live
connections in the graph turn into Manim updaters without the user writing a
function (goal.md section 23).
"""

from __future__ import annotations

import re
from typing import Protocol

from pydantic import BaseModel

from engine.catalogue.builtins import (
    ANIMATE,
    DERIVATIVE,
    EXPRESSION,
    FRAME_DELTA,
    SCENE_TIME,
    STATE,
)
from engine.catalogue.model import Catalogue, Descriptor, PortType, TypeRef
from engine.codegen.literals import LiteralFormatter
from engine.document.analysis import OBJECT_TYPES, Graph
from engine.document.model import (
    MOBJECT_STEP_METHODS,
    SELF_PORT,
    UPDATING_METHODS,
    AddStep,
    BringToBackStep,
    BringToFrontStep,
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
)


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
    def generate(self, scene: SceneDocument, catalogue: Catalogue) -> GeneratedCode: ...


_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def snake_case(name: str) -> str:
    return _CAMEL.sub("_", name).lower()


class ManimCodeGenerator:
    def generate(self, scene: SceneDocument, catalogue: Catalogue) -> GeneratedCode:
        issues = validate_scene(scene, catalogue)
        if issues:
            return GeneratedCode(code="", source_map=SourceMap(), issues=issues)
        return _Build(scene, catalogue).run()


class _Build:
    def __init__(self, scene: SceneDocument, catalogue: Catalogue) -> None:
        self.scene = scene
        self.graph = Graph(scene, catalogue)
        self.formatter = LiteralFormatter({c.name for c in catalogue.colors})
        self.variables: dict[str, str] = {}
        self.taken: set[str] = {"self", "mob", "dt"}
        self.body: list[str] = []
        self.map = SourceMap()
        self.uses_dt = False

    # ---- driver -----------------------------------------------------------------

    def run(self) -> GeneratedCode:
        for node in self.ordered_nodes():
            descriptor = self.descriptor(node)
            if descriptor.returns.type is PortType.ANIMATION:
                continue  # animations are written inline where they are played
            if descriptor.name in (SCENE_TIME.name, FRAME_DELTA.name):
                continue  # read inline as self.time and dt
            if (
                self.graph.is_live(node.id)
                and self.graph.is_value_node(node.id)
                and descriptor.name != STATE.name
            ):
                continue  # live values are inlined into the updater that reads them
            self.emit_construction(node)
        for position, step in enumerate(self.scene.steps):
            self.emit_step(position, step)
        return self.assemble()

    def descriptor(self, node: Node) -> Descriptor:
        return self.graph.index[node.catalogue]

    def ordered_nodes(self) -> list[Node]:
        """Dependencies first, document order otherwise."""
        order: list[Node] = []
        done: set[str] = set()

        def visit(node_id: str) -> None:
            if node_id in done:
                return
            done.add(node_id)
            for edge in self.graph.edges_in.get(node_id, []):
                visit(edge.source)
            order.append(self.graph.nodes[node_id])

        for node in self.scene.nodes:
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
            receiver = self.variables[self.graph.sources(node.id, SELF_PORT)[0]]
            if descriptor.returns.annotation == "Self":
                self.variables[node.id] = receiver
                self.uses_dt = False
                arguments = self.arguments(node, descriptor)
                if live:
                    params = "mob, dt" if self.uses_dt else "mob"
                    call = f"mob.{descriptor.name}({arguments})"
                    self.line(
                        f"{receiver}.add_updater(lambda {params}: {call})", node.id
                    )
                    self.map.live.append(node.id)
                else:
                    self.line(f"{receiver}.{descriptor.name}({arguments})", node.id)
                return
            call = f"{receiver}.{descriptor.name}({self.arguments(node, descriptor)})"
        elif descriptor.name == EXPRESSION.name:
            call = self.expression_source(node)
        elif descriptor.name == DERIVATIVE.name:
            call = self.derivative_source(node)
        else:
            call = f"{descriptor.name}({self.arguments(node, descriptor)})"
        name = self.new_variable(node, descriptor)
        self.variables[node.id] = name
        if live:
            self.line(f"{name} = always_redraw(lambda: {call})", node.id)
            self.map.live.append(node.id)
        else:
            self.line(f"{name} = {call}", node.id)

    def emit_state(self, node: Node) -> None:
        name = self.new_variable(node, STATE)
        self.variables[node.id] = name
        params = {p.name: p for p in STATE.parameters}
        initial = self.formatter.format(
            node.values.get("initial", 0.0), params["initial"].type
        )
        self.line(f"{name} = [{initial}]", node.id)
        sources = self.graph.sources(node.id, "next")
        if sources:
            self.uses_dt = False
            value = self.expression(sources[0], params["next"].type)
            self.line(
                f"self.add_updater(lambda dt: {name}.__setitem__(0, {value}))", node.id
            )
            self.map.live.append(node.id)

    # ---- expressions ------------------------------------------------------------

    def expression(self, node_id: str, expected: TypeRef | None = None) -> str:
        """Python for a node's output where it is used, honouring the port it feeds."""
        node = self.graph.nodes[node_id]
        descriptor = self.descriptor(node)
        if descriptor.name == SCENE_TIME.name:
            return "self.time"
        if descriptor.name == FRAME_DELTA.name:
            self.uses_dt = True
            return "dt"
        if node_id in self.variables:
            name = self.variables[node_id]
            if descriptor.name == STATE.name:
                return f"{name}[0]"
            # A ValueTracker is an object on mobject ports and a number elsewhere.
            wants_value = expected is not None and expected.type not in OBJECT_TYPES
            is_tracker = (
                descriptor.returns.type is PortType.LIVE_NUMBER
                and descriptor.kind == "class"
            )
            return f"{name}.get_value()" if is_tracker and wants_value else name
        if descriptor.name == EXPRESSION.name:
            return self.expression_source(node)
        if descriptor.name == DERIVATIVE.name:
            return self.derivative_source(node)
        if descriptor.name == ANIMATE.name:
            return self.animate_source(node)
        if descriptor.kind == "method":
            receiver = self.expression(self.graph.sources(node_id, SELF_PORT)[0])
            return f"{receiver}.{descriptor.name}({self.arguments(node, descriptor)})"
        return f"{descriptor.name}({self.arguments(node, descriptor)})"

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
        return result.source

    def derivative_source(self, node: Node) -> str:
        function = self.expression(self.graph.sources(node.id, "function")[0])
        if function.startswith("lambda"):
            function = f"({function})"
        return f"lambda x: ({function}(x + 1e-4) - {function}(x - 1e-4)) / 2e-4"

    def animate_source(self, node: Node) -> str:
        params = {p.name: p for p in ANIMATE.parameters}
        target_id = self.graph.sources(node.id, "mobject")[0]
        target = self.expression(target_id)
        kwargs = [
            f"{name}={self.formatter.format(node.values[name], params[name].type)}"
            for name in ("run_time", "rate_func", "lag_ratio")
            if name in node.values
        ]
        chain = f"{target}.animate" + (f"({', '.join(kwargs)})" if kwargs else "")
        for call in node.chain:
            method = self.graph.method_descriptor(target_id, call.method)
            assert method is not None  # validated
            parts = []
            for param in method.parameters:
                if param.name not in call.values:
                    continue
                value = self.formatter.format(call.values[param.name], param.type)
                positional = param.kind == "var_positional" or (
                    param.default is None and param.kind == "positional"
                )
                parts.append(value if positional else f"{param.name}={value}")
            chain += f".{call.method}({', '.join(parts)})"
        return chain

    def arguments(self, node: Node, descriptor: Descriptor) -> str:
        parts: list[str] = []
        for param in descriptor.parameters:
            sources = self.graph.sources(node.id, param.name)
            if param.kind == "var_positional":
                parts.extend(self.expression(s, param.type) for s in sources)
                if param.name in node.values:
                    parts.append(
                        self.formatter.format(node.values[param.name], param.type)
                    )
                continue
            if sources:
                value = self.expression(sources[0], param.type)
            elif param.name in node.values:
                value = self.formatter.format(node.values[param.name], param.type)
            else:
                continue
            positional = param.default is None and param.kind == "positional"
            parts.append(value if positional else f"{param.name}={value}")
        return ", ".join(parts)

    def new_variable(self, node: Node, descriptor: Descriptor) -> str:
        base = snake_case(node.label or descriptor.name)
        base = re.sub(r"\W+", "_", base).strip("_") or "value"
        if not base[0].isalpha():
            base = f"v_{base}"
        name = base
        counter = 2
        while name in self.taken:
            name = f"{base}_{counter}"
            counter += 1
        self.taken.add(name)
        return name

    # ---- steps ------------------------------------------------------------------

    def emit_step(self, position: int, step: AnyStep) -> None:
        if isinstance(step, PlayStep):
            parts = [self.expression(a) for a in step.animations]
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
                self.line(f"{self.expression(mobject)}.{method}()", step=position)
            return
        else:
            method = MOBJECT_STEP_METHODS[step.kind]
            mobjects = ", ".join(self.expression(m) for m in step.mobjects)
            text = f"self.{method}({mobjects})"
        self.line(text, step=position)

    # ---- output -----------------------------------------------------------------

    def line(self, text: str, node: str | None = None, step: int | None = None) -> None:
        self.body.append(text)
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
            f"class {self.scene.name}(Scene):",
            "    def construct(self):",
        ]
        offset = len(header)
        body = [f"        {text}" for text in self.body] or ["        pass"]
        self.map.nodes = {k: [n + offset for n in v] for k, v in self.map.nodes.items()}
        self.map.steps = {k: [n + offset for n in v] for k, v in self.map.steps.items()}
        self.map.variables = dict(self.variables)
        return GeneratedCode(code="\n".join(header + body) + "\n", source_map=self.map)
