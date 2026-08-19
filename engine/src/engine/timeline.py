"""Where things happen in time, computed from the document with Manim's rules.

Timing follows ``AnimationGroup.build_animations_with_timings`` and
``init_run_time`` (manim/manim/animation/composition.py): a child starts after
the previous child's run time times ``lag_ratio``; a group lasts until its
last child ends unless it has an explicit ``run_time``, which rescales the
children. ``Scene.play`` lasts as long as its longest animation
(manim/manim/scene/scene.py, ``get_run_time``).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import BaseModel

from engine.catalogue.model import Catalogue, Descriptor, Parameter, PortType
from engine.codegen import ManimCodeGenerator
from engine.document.model import (
    Node,
    PlayStep,
    SceneDocument,
    SectionStep,
    SoundStep,
    SubcaptionStep,
    WaitStep,
)

_MOBJECT_TYPES = {PortType.MOBJECT, PortType.COORDINATE_SYSTEM, PortType.LIVE_NUMBER}


class Bar(BaseModel):
    """One animation on the timeline. Nested group children carry a parent and depth."""

    step: int
    node: str
    rows: list[str]
    start: float
    end: float
    label: str
    rate_func: str | None = None
    parent: str | None = None
    depth: int = 0


class Marker(BaseModel):
    step: int
    kind: str
    time: float
    label: str
    rows: list[str] = []


class StepSpan(BaseModel):
    index: int
    kind: str
    start: float
    end: float
    label: str


class Section(BaseModel):
    name: str
    start: float
    end: float
    skip_animations: bool = False


class TimelineLayout(BaseModel):
    rows: list[str]
    steps: list[StepSpan]
    bars: list[Bar]
    markers: list[Marker]
    sections: list[Section]
    total: float


@dataclass
class _Timing:
    node: str
    start: float
    end: float
    rows: list[str]
    label: str
    rate_func: str | None
    children: list[_Timing] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.end - self.start


class _Context:
    def __init__(self, scene: SceneDocument, catalogue: Catalogue) -> None:
        self.index = {e.qualname: e for e in catalogue.entries}
        self.nodes = {n.id: n for n in scene.nodes}
        self.inputs: dict[tuple[str, str], list[str]] = {}
        for edge in scene.edges:
            self.inputs.setdefault((edge.target, edge.port), []).append(edge.source)
        generated = ManimCodeGenerator().generate(scene, catalogue)
        self.variables = dict(generated.source_map.variables)
        for node in scene.nodes:
            self.variables.setdefault(node.id, node.label or node.id)

    def descriptor(self, node_id: str) -> Descriptor | None:
        node = self.nodes.get(node_id)
        return self.index.get(node.catalogue) if node else None

    def row(self, node_id: str) -> str:
        return self.variables[node_id]


def layout_timeline(scene: SceneDocument, catalogue: Catalogue) -> TimelineLayout:
    context = _Context(scene, catalogue)
    bars: list[Bar] = []
    markers: list[Marker] = []
    spans: list[StepSpan] = []
    section_starts: list[tuple[SectionStep, float]] = []
    time = 0.0
    for position, step in enumerate(scene.steps):
        end = time
        if isinstance(step, PlayStep):
            timings = [
                _animation_timing(a, context, step.run_time)
                for a in step.animations
                if context.descriptor(a) is not None
            ]
            end = time + max((t.duration for t in timings), default=0.0)
            for timing in timings:
                _collect_bars(timing, position, time, None, 0, bars)
            label = ", ".join(t.label for t in timings)
        elif isinstance(step, WaitStep):
            end = time + step.duration
            label = f"wait {step.duration:g} s"
        elif isinstance(step, SectionStep):
            section_starts.append((step, time))
            label = step.name
            markers.append(
                Marker(step=position, kind="section", time=time, label=step.name)
            )
        elif isinstance(step, SoundStep):
            label = step.file
            markers.append(
                Marker(step=position, kind="sound", time=time, label=step.file)
            )
        elif isinstance(step, SubcaptionStep):
            label = step.content
            markers.append(
                Marker(step=position, kind="subcaption", time=time, label=step.content)
            )
        else:
            mobjects = [m for m in getattr(step, "mobjects", []) if m in context.nodes]
            rows = [context.row(m) for m in mobjects]
            label = ", ".join(rows)
            markers.append(
                Marker(step=position, kind=step.kind, time=time, label=label, rows=rows)
            )
        spans.append(
            StepSpan(index=position, kind=step.kind, start=time, end=end, label=label)
        )
        time = end
    sections = [
        Section(
            name=step.name,
            start=start,
            end=section_starts[i + 1][1] if i + 1 < len(section_starts) else time,
            skip_animations=step.skip_animations,
        )
        for i, (step, start) in enumerate(section_starts)
    ]
    rows = _rows(context, bars, markers)
    return TimelineLayout(
        rows=rows,
        steps=spans,
        bars=bars,
        markers=markers,
        sections=sections,
        total=time,
    )


def _animation_timing(
    node_id: str, context: _Context, override: float | None = None
) -> _Timing:
    node = context.nodes[node_id]
    descriptor = context.descriptor(node_id)
    assert descriptor is not None
    params = {p.name: p for p in descriptor.parameters}
    explicit = _number(node, params.get("run_time"), only_explicit=True)
    rate_func = _text(node, params.get("rate_func"))
    label = node.label or descriptor.name
    group_port = next(
        (
            p
            for p in descriptor.parameters
            if p.kind == "var_positional" and p.type.type is PortType.ANIMATION
        ),
        None,
    )
    if group_port is not None:
        children = [
            _animation_timing(child, context)
            for child in context.inputs.get((node_id, group_port.name), [])
            if context.descriptor(child) is not None
        ]
        lag = _number(node, params.get("lag_ratio")) or 0.0
        start = 0.0
        for i, child in enumerate(children):
            if i > 0:
                start += children[i - 1].duration * lag
            _shift(child, start)
        max_end = max((c.end for c in children), default=0.0)
        duration = override if override is not None else explicit
        if duration is None:
            duration = max_end
        if max_end > 0 and duration != max_end:
            for child in children:
                _scale(child, duration / max_end)
        rows = _unique(r for c in children for r in c.rows)
        return _Timing(node_id, 0.0, duration, rows, label, rate_func, children)
    duration = override if override is not None else explicit
    if duration is None:
        duration = _number(node, params.get("run_time")) or 1.0
    return _Timing(
        node_id, 0.0, duration, _input_rows(node, descriptor, context), label, rate_func
    )


def _input_rows(node: Node, descriptor: Descriptor, context: _Context) -> list[str]:
    rows: list[str] = []
    for param in descriptor.parameters:
        accepted = {param.type.type, *param.type.accepts}
        if not accepted & _MOBJECT_TYPES:
            continue
        for source in context.inputs.get((node.id, param.name), []):
            if source in context.nodes:
                rows.append(context.row(source))
    return _unique(rows)


def _collect_bars(
    timing: _Timing,
    step: int,
    offset: float,
    parent: str | None,
    depth: int,
    bars: list[Bar],
) -> None:
    bars.append(
        Bar(
            step=step,
            node=timing.node,
            rows=timing.rows,
            start=offset + timing.start,
            end=offset + timing.end,
            label=timing.label,
            rate_func=timing.rate_func,
            parent=parent,
            depth=depth,
        )
    )
    for child in timing.children:
        _collect_bars(child, step, offset, timing.node, depth + 1, bars)


def _shift(timing: _Timing, by: float) -> None:
    timing.start += by
    timing.end += by
    for child in timing.children:
        _shift(child, by)


def _scale(timing: _Timing, factor: float) -> None:
    timing.start *= factor
    timing.end *= factor
    for child in timing.children:
        _scale(child, factor)


def _rows(context: _Context, bars: list[Bar], markers: list[Marker]) -> list[str]:
    """Mobject variables in construction order, then anything else the bars mention."""
    rows: list[str] = []
    for node_id, name in context.variables.items():
        descriptor = context.descriptor(node_id)
        if descriptor is not None and descriptor.returns.type in _MOBJECT_TYPES:
            rows.append(name)
    for bar in bars:
        rows.extend(bar.rows)
    for marker in markers:
        rows.extend(marker.rows)
    return _unique(rows)


def _number(
    node: Node, param: Parameter | None, only_explicit: bool = False
) -> float | None:
    if param is None:
        return None
    value = node.values.get(param.name)
    if isinstance(value, int | float) and not isinstance(value, bool):
        return float(value)
    if only_explicit or param.default is None:
        return None
    try:
        return float(param.default)
    except ValueError:
        return None


def _text(node: Node, param: Parameter | None) -> str | None:
    if param is None:
        return None
    value = node.values.get(param.name)
    return value if isinstance(value, str) else param.default


def _unique(items: object) -> list[str]:
    seen: list[str] = []
    for item in items:  # type: ignore[attr-defined]
        if item not in seen:
            seen.append(item)
    return seen
