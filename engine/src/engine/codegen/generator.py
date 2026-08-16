"""Turn a scene document into a Manim ``Scene`` subclass."""

from __future__ import annotations

import re
from typing import Protocol

from pydantic import BaseModel

from engine.catalogue.model import Catalogue, Descriptor, PortType
from engine.codegen.literals import LiteralFormatter
from engine.document.model import (
    SELF_PORT,
    AddStep,
    Node,
    PlayStep,
    RemoveStep,
    SceneDocument,
    WaitStep,
)
from engine.document.validate import Issue, validate_scene


class SourceMap(BaseModel):
    """1-based line numbers of the generated code, by node id and by step index."""

    nodes: dict[str, list[int]] = {}
    steps: dict[int, list[int]] = {}
    variables: dict[str, str] = {}


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
    """Emits construction statements in dependency order, then the steps."""

    def generate(self, scene: SceneDocument, catalogue: Catalogue) -> GeneratedCode:
        issues = validate_scene(scene, catalogue)
        if issues:
            return GeneratedCode(code="", source_map=SourceMap(), issues=issues)
        return _Build(scene, catalogue).run()


class _Build:
    def __init__(self, scene: SceneDocument, catalogue: Catalogue) -> None:
        self.scene = scene
        self.index = {e.qualname: e for e in catalogue.entries}
        self.formatter = LiteralFormatter({c.name for c in catalogue.colors})
        self.nodes = {n.id: n for n in scene.nodes}
        self.inputs: dict[tuple[str, str], list[str]] = {}
        for edge in scene.edges:
            self.inputs.setdefault((edge.target, edge.port), []).append(edge.source)
        self.variables: dict[str, str] = {}
        self.taken: set[str] = set()
        self.body: list[str] = []
        self.map = SourceMap()

    def run(self) -> GeneratedCode:
        for node in self.ordered_nodes():
            if self.descriptor(node).returns.type is PortType.ANIMATION:
                continue  # animations are written inline where they are played
            self.emit_construction(node)
        for position, step in enumerate(self.scene.steps):
            self.emit_step(position, step)
        return self.assemble()

    def descriptor(self, node: Node) -> Descriptor:
        return self.index[node.catalogue]

    def ordered_nodes(self) -> list[Node]:
        """Dependencies first, document order otherwise."""
        order: list[Node] = []
        done: set[str] = set()

        def visit(node_id: str) -> None:
            if node_id in done:
                return
            done.add(node_id)
            for (target, _), sources in self.inputs.items():
                if target == node_id:
                    for source in sources:
                        visit(source)
            order.append(self.nodes[node_id])

        for node in self.scene.nodes:
            visit(node.id)
        return order

    def emit_construction(self, node: Node) -> None:
        descriptor = self.descriptor(node)
        if descriptor.kind == "method":
            receiver = self.variables[self.inputs[(node.id, SELF_PORT)][0]]
            call = f"{receiver}.{descriptor.name}({self.arguments(node, descriptor)})"
            if descriptor.returns.annotation == "Self":
                self.variables[node.id] = receiver
                self.line(call, node.id)
                return
        else:
            call = f"{descriptor.name}({self.arguments(node, descriptor)})"
        name = self.new_variable(node, descriptor)
        self.variables[node.id] = name
        self.line(f"{name} = {call}", node.id)

    def expression(self, node_id: str) -> str:
        if node_id in self.variables:
            return self.variables[node_id]
        node = self.nodes[node_id]
        descriptor = self.descriptor(node)
        return f"{descriptor.name}({self.arguments(node, descriptor)})"

    def arguments(self, node: Node, descriptor: Descriptor) -> str:
        parts: list[str] = []
        for param in descriptor.parameters:
            sources = self.inputs.get((node.id, param.name), [])
            if param.kind == "var_positional":
                parts.extend(self.expression(s) for s in sources)
                if param.name in node.values:
                    parts.append(
                        self.formatter.format(node.values[param.name], param.type)
                    )
                continue
            if sources:
                value = self.expression(sources[0])
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

    def emit_step(
        self, position: int, step: PlayStep | WaitStep | AddStep | RemoveStep
    ) -> None:
        if isinstance(step, PlayStep):
            text = (
                f"self.play({', '.join(self.expression(a) for a in step.animations)})"
            )
        elif isinstance(step, WaitStep):
            text = f"self.wait({step.duration!r})"
        elif isinstance(step, AddStep):
            text = f"self.add({', '.join(self.expression(m) for m in step.mobjects)})"
        else:
            text = (
                f"self.remove({', '.join(self.expression(m) for m in step.mobjects)})"
            )
        self.line(text, step=position)

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
