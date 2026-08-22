"""Where things happen in time, read from Manim's own animation objects.

The scene runs with animations skipped. Every ``play`` call still compiles its
animations (``Scene.compile_animation_data``), so each animation's ``run_time``
and each group's ``anims_with_timings`` are Manim's values; nothing is
re-derived here. Objects are matched back to document nodes structurally: the
n-th top-level animation of a play step is the n-th id in ``step.animations``,
and the n-th child of a group is the n-th connection into its animations port.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from manim.animation.animation import Animation
from manim.animation.composition import AnimationGroup
from manim.renderer.cairo_renderer import CairoRenderer
from pydantic import BaseModel

from engine.catalogue.model import Catalogue, Descriptor, PortType
from engine.codegen import ManimCodeGenerator
from engine.document.model import (
    SELF_PORT,
    AddStep,
    PlayStep,
    RemoveStep,
    SceneDocument,
    SectionStep,
    SoundStep,
    SubcaptionStep,
    UpdatingStep,
    WaitStep,
)
from engine.render.runner import QUIET, PreviewFileWriter, RenderError, run_scene

_MOBJECT_TYPES = {PortType.MOBJECT, PortType.COORDINATE_SYSTEM, PortType.LIVE_NUMBER}


class Row(BaseModel):
    """One object on the timeline: the node that constructs it, with a display label."""

    id: str
    label: str


class Bar(BaseModel):
    """One animation. Children Manim builds itself keep their parent's node id."""

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


class Band(BaseModel):
    """A stretch of time during which an object's updaters run."""

    row: str
    start: float
    end: float


class TimelineLayout(BaseModel):
    rows: list[Row]
    steps: list[StepSpan]
    bars: list[Bar]
    markers: list[Marker]
    sections: list[Section]
    bands: list[Band] = []
    total: float
    error: str | None = None


@dataclass
class _Play:
    start: float
    duration: float
    animations: list[Animation]


class _TimingRenderer(CairoRenderer):
    """Records each play call's compiled animations instead of rendering them."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(
            file_writer_class=PreviewFileWriter, skip_animations=True, **kwargs
        )
        self.plays: list[_Play] = []

    def play(self, scene: Any, *args: Any, **kwargs: Any) -> None:
        scene.compile_animation_data(*args, **kwargs)
        self.plays.append(_Play(self.time, scene.duration, list(scene.animations)))
        self.time += scene.duration
        self.num_plays += 1


@dataclass
class _Context:
    scene: SceneDocument
    index: dict[str, Descriptor]
    nodes: dict[str, Any]
    inputs: dict[tuple[str, str], list[str]] = field(default_factory=dict)

    def descriptor(self, node_id: str) -> Descriptor | None:
        node = self.nodes.get(node_id)
        return self.index.get(node.catalogue) if node else None

    def root(self, node_id: str) -> str:
        """The node that constructs an object: follow method nodes back through self."""
        seen: set[str] = set()
        while node_id not in seen:
            seen.add(node_id)
            descriptor = self.descriptor(node_id)
            sources = self.inputs.get((node_id, SELF_PORT), [])
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


def layout_timeline(scene: SceneDocument, catalogue: Catalogue) -> TimelineLayout:
    generated = ManimCodeGenerator().generate(scene, catalogue)
    if generated.issues:
        return _empty(generated.issues[0].message)
    try:
        _, _, renderer = run_scene(
            generated, scene.name, {**QUIET, "dry_run": True}, _TimingRenderer
        )
    except RenderError as exc:
        return _empty(str(exc))
    context = _Context(
        scene,
        {e.qualname: e for e in catalogue.entries},
        {n.id: n for n in scene.nodes},
    )
    for edge in scene.edges:
        context.inputs.setdefault((edge.target, edge.port), []).append(edge.source)

    bars: list[Bar] = []
    markers: list[Marker] = []
    spans: list[StepSpan] = []
    section_starts: list[tuple[SectionStep, float]] = []
    events: list[tuple[float, str, str]] = []  # (time, row, enter|leave|action)
    plays = iter(renderer.plays)
    time = 0.0
    for position, step in enumerate(scene.steps):
        end = time
        if isinstance(step, PlayStep | WaitStep):
            play = next(plays)
            time, end = play.start, play.start + play.duration
        if isinstance(step, PlayStep):
            pairs = list(zip(step.animations, play.animations, strict=False))
            for node_id, animation in pairs:
                _collect(animation, node_id, position, time, None, 0, context, bars)
                # Scene.play adds the animated mobjects; a remover takes its own out.
                for row in _animation_rows(node_id, context):
                    if animation.is_remover():
                        events.append((end, row, "leave"))
                    else:
                        events.append((time, row, "enter"))
            label = ", ".join(_label(a, n, context) for n, a in pairs)
        elif isinstance(step, WaitStep):
            label = f"wait {play.duration:g} s"
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
        elif isinstance(step, UpdatingStep):
            rows = [context.root(m) for m in step.mobjects if m in context.nodes]
            label = f"{step.action} updaters"
            markers.append(
                Marker(
                    step=position, kind=step.action, time=time, label=label, rows=rows
                )
            )
            events.extend((time, row, step.action) for row in rows)
        else:
            mobjects = getattr(step, "mobjects", [])
            rows = [context.root(m) for m in mobjects if m in context.nodes]
            if isinstance(step, AddStep | RemoveStep):
                kind = "enter" if isinstance(step, AddStep) else "leave"
                events.extend((time, row, kind) for row in rows)
            label = ", ".join(_row_label(r, context) for r in rows)
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
    live_rows = {
        root
        for root in (context.root(n) for n in generated.source_map.live)
        if (d := context.descriptor(root)) is not None and d.kind != "builtin"
    }
    bands = _bands(live_rows, events, renderer.time)
    return TimelineLayout(
        rows=_rows(context, bars, markers, bands),
        steps=spans,
        bars=bars,
        markers=markers,
        sections=sections,
        bands=bands,
        total=renderer.time,
    )


def _bands(
    rows: set[str], events: list[tuple[float, str, str]], total: float
) -> list[Band]:
    """Updaters run while the object is in the scene, not suspended, and not cleared."""
    bands: list[Band] = []
    state = {
        row: {"in_scene": False, "updating": True, "cleared": False} for row in rows
    }
    opened: dict[str, float] = {}
    for time, row, kind in sorted(events, key=lambda e: e[0]):
        if row not in state:
            continue
        flags = state[row]
        if kind == "enter":
            flags["in_scene"] = True
        elif kind == "leave":
            flags["in_scene"] = False
        elif kind == "suspend":
            flags["updating"] = False
        elif kind == "resume":
            flags["updating"] = True
        elif kind == "clear":
            flags["cleared"] = True
        active = flags["in_scene"] and flags["updating"] and not flags["cleared"]
        if active and row not in opened:
            opened[row] = time
        elif not active and row in opened:
            bands.append(Band(row=row, start=opened.pop(row), end=time))
    bands.extend(Band(row=row, start=start, end=total) for row, start in opened.items())
    return bands


def _empty(error: str) -> TimelineLayout:
    return TimelineLayout(
        rows=[], steps=[], bars=[], markers=[], sections=[], total=0.0, error=error
    )


def _collect(
    animation: Animation,
    node_id: str,
    step: int,
    start: float,
    parent: str | None,
    depth: int,
    context: _Context,
    bars: list[Bar],
    scale: float = 1.0,
) -> None:
    """Append the bar for ``animation`` and, for groups, its children.

    ``scale`` maps the animation's own clock to scene time: a group with an
    explicit ``run_time`` plays its children at ``run_time / max_end_time`` speed
    (``AnimationGroup.interpolate``), and nested groups multiply.
    """
    bar = Bar(
        step=step,
        node=node_id,
        rows=_animation_rows(node_id, context),
        start=start,
        end=start + animation.run_time * scale,
        label=_label(animation, node_id, context),
        rate_func=getattr(animation.rate_func, "__name__", None),
        parent=parent,
        depth=depth,
    )
    bars.append(bar)
    if not isinstance(animation, AnimationGroup) or not len(animation.animations):
        return
    inner = (
        animation.run_time / animation.max_end_time if animation.max_end_time else 1.0
    )
    child_scale = scale * inner
    child_ids = _child_ids(node_id, context, len(animation.animations))
    timings = animation.anims_with_timings
    for child_id, child, timing in zip(
        child_ids, animation.animations, timings, strict=True
    ):
        child_start = start + float(timing["start"]) * child_scale
        _collect(
            child,
            child_id,
            step,
            child_start,
            node_id,
            depth + 1,
            context,
            bars,
            child_scale,
        )
    children = [b for b in bars if b.parent == node_id and b.depth == depth + 1]
    bar.rows = list(dict.fromkeys(bar.rows + [r for c in children for r in c.rows]))


def _child_ids(node_id: str, context: _Context, count: int) -> list[str]:
    """Child node ids in port order, or the parent's id for children Manim created."""
    descriptor = context.descriptor(node_id)
    if descriptor is not None:
        port = next(
            (
                p.name
                for p in descriptor.parameters
                if p.kind == "var_positional" and p.type.type is PortType.ANIMATION
            ),
            None,
        )
        connected = context.inputs.get((node_id, port), []) if port else []
        if len(connected) == count:
            return connected
    return [node_id] * count


def _animation_rows(node_id: str, context: _Context) -> list[str]:
    descriptor = context.descriptor(node_id)
    if descriptor is None:
        return []
    rows: list[str] = []
    for param in descriptor.parameters:
        if not ({param.type.type, *param.type.accepts} & _MOBJECT_TYPES):
            continue
        for source in context.inputs.get((node_id, param.name), []):
            if source in context.nodes:
                rows.append(context.root(source))
    return list(dict.fromkeys(rows))


def _label(animation: Animation, node_id: str, context: _Context) -> str:
    node = context.nodes.get(node_id)
    if node is not None and node.label:
        return str(node.label)
    return type(animation).__name__


def _row_label(node_id: str, context: _Context) -> str:
    node = context.nodes.get(node_id)
    if node is None:
        return node_id
    descriptor = context.descriptor(node_id)
    return str(node.label or (descriptor.name if descriptor else node.catalogue))


def _rows(
    context: _Context, bars: list[Bar], markers: list[Marker], bands: list[Band]
) -> list[Row]:
    """Constructed mobjects in document order, then anything else bars mention."""
    ids: list[str] = []
    for node in context.scene.nodes:
        descriptor = context.descriptor(node.id)
        if (
            descriptor is not None
            and descriptor.kind != "builtin"
            and descriptor.returns.type in _MOBJECT_TYPES
            and (descriptor.kind != "method" or descriptor.returns.annotation != "Self")
        ):
            ids.append(node.id)
    for bar in bars:
        ids.extend(bar.rows)
    for marker in markers:
        ids.extend(marker.rows)
    ids.extend(band.row for band in bands)
    ids = list(dict.fromkeys(ids))
    labels = [_row_label(i, context) for i in ids]
    rows: list[Row] = []
    for position, (node_id, label) in enumerate(zip(ids, labels, strict=True)):
        if labels.count(label) > 1:
            label = f"{label} {labels[: position + 1].count(label)}"
        rows.append(Row(id=node_id, label=label))
    return rows
