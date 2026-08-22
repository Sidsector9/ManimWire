from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from engine.catalogue import Catalogue
from engine.codegen import ManimCodeGenerator
from engine.document import (
    AddStep,
    Document,
    Edge,
    MethodCall,
    Node,
    PlayStep,
    SceneDocument,
    Settings,
    UpdatingStep,
    WaitStep,
)
from engine.expression import ExpressionError, parse_expression, to_source
from engine.render import CairoRenderService
from engine.timeline import layout_timeline

SMALL = {"pixel_width": 256, "pixel_height": 144, "frame_rate": 15}


def edge(source: str, target: str, port: str, live: bool = False) -> Edge:
    return Edge(source=source, target=target, port=port, live=live)


def tracked_dot_scene() -> SceneDocument:
    """A ValueTracker drives a Dot along y = x^2 through Axes.coords_to_point."""
    return SceneDocument(
        name="Tracked",
        nodes=[
            Node(
                id="ax",
                catalogue="Axes",
                values={"x_range": [-3, 3, 1], "y_range": [0, 9, 1]},
            ),
            Node(id="f", catalogue="Expression", values={"expr": "x^2"}),
            Node(id="x", catalogue="ValueTracker", values={"value": -2.0}),
            Node(id="fx", catalogue="Expression", values={"expr": "x^2"}),
            Node(id="p", catalogue="Axes.coords_to_point"),
            Node(id="dot", catalogue="Dot", values={"color": "YELLOW"}),
            Node(
                id="sweep",
                catalogue="Animate",
                values={"run_time": 2.0, "rate_func": "linear"},
                chain=[MethodCall(method="set_value", values={"value": 2.0})],
            ),
        ],
        edges=[
            edge("x", "fx", "x", live=True),
            edge("ax", "p", "self"),
            edge("x", "p", "coords", live=True),
            edge("fx", "p", "coords"),
            edge("p", "dot", "point"),
            edge("x", "sweep", "mobject"),
        ],
        steps=[
            AddStep(mobjects=["ax", "dot"]),
            PlayStep(animations=["sweep"]),
            WaitStep(duration=0.5),
        ],
    )


def test_expression_parser_accepts_math_and_rejects_python() -> None:
    parsed = parse_expression("k / t + sin(pi * x)^2")
    assert parsed.variables == ["k", "t", "x"]
    assert to_source(parsed, {}).source == "lambda k, t, x: k / t + np.sin(PI * x) ** 2"
    bound = to_source(parsed, {"k": "25", "t": "x.get_value()"})
    assert bound.source == "lambda x: 25 / x.get_value() + np.sin(PI * x) ** 2"
    assert bound.uses_numpy is True
    for bad in (
        "import os",
        "x.y",
        "f(x=1)",
        "x if y else z",
        "'a'",
        "lambda: 1",
        "[1, 2]",
    ):
        with pytest.raises(ExpressionError):
            parse_expression(bad)


def test_live_dot_becomes_always_redraw(catalogue: Catalogue) -> None:
    generated = ManimCodeGenerator().generate(tracked_dot_scene(), catalogue)
    assert generated.issues == []
    lines = generated.code.splitlines()
    assert "        value_tracker = ValueTracker(value=-2.0)" in lines
    assert (
        "        dot = always_redraw(lambda: Dot(point=axes.coords_to_point("
        "value_tracker.get_value(), value_tracker.get_value() ** 2), color=YELLOW))"
    ) in lines
    assert (
        "        self.play(value_tracker.animate(run_time=2.0, rate_func=linear)"
        ".set_value(2.0))"
    ) in lines
    assert generated.source_map.live == ["dot"]
    assert (
        "value_tracker.get_value() ** 2 =" not in generated.code
    )  # live expressions are inline


def test_live_dot_moves_between_frames(catalogue: Catalogue, tmp_path: Path) -> None:
    service = CairoRenderService(tmp_path)
    document = Document(
        scenes=[tracked_dot_scene()], settings=Settings.model_validate(SMALL)
    )
    start = service.frame(document.scenes[0], catalogue, document.settings, 0.0)
    end = service.frame(document.scenes[0], catalogue, document.settings, 2.0)
    first = {b.node: b for b in start.bounds}["dot"]
    last = {b.node: b for b in end.bounds}["dot"]
    assert first.center[0] < 0 < last.center[0]
    with Image.open(end.path) as image:
        assert image.size == (256, 144)


def test_updater_from_frame_delta_and_time(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        name="Spin",
        nodes=[
            Node(id="sq", catalogue="Square"),
            Node(id="dt", catalogue="FrameDelta"),
            Node(id="rate", catalogue="Expression", values={"expr": "0.5 * dt"}),
            Node(id="rot", catalogue="Mobject.rotate"),
            Node(id="t", catalogue="SceneTime"),
            Node(id="lbl", catalogue="Circle"),
            Node(id="setv", catalogue="Mobject.set_x"),
        ],
        edges=[
            edge("sq", "rot", "self"),
            edge("dt", "rate", "dt"),
            edge("rate", "rot", "angle"),
            edge("lbl", "setv", "self"),
            edge("t", "setv", "x"),
        ],
        steps=[
            WaitStep(duration=1.0),
            UpdatingStep(mobjects=["sq"], action="suspend"),
            WaitStep(duration=1.0),
        ],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert (
        "        square.add_updater(lambda mob, dt: mob.rotate(0.5 * dt))"
        in generated.code
    )
    assert (
        "        circle.add_updater(lambda mob: mob.set_x(self.time))" in generated.code
    )
    assert "        square.suspend_updating()" in generated.code
    assert sorted(generated.source_map.live) == ["rot", "setv"]
    layout = layout_timeline(scene, catalogue)
    assert layout.error is None
    bands = {(b.row, b.start, b.end) for b in layout.bands}
    assert bands == {("sq", 0.0, 1.0), ("lbl", 0.0, 2.0)}
    assert [m.kind for m in layout.markers] == ["suspend"]


def test_frame_delta_outside_an_updater_is_refused(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        nodes=[
            Node(id="dt", catalogue="FrameDelta"),
            Node(id="c", catalogue="Circle"),
        ],
        edges=[edge("dt", "c", "radius")],
    )
    issues = ManimCodeGenerator().generate(scene, catalogue).issues
    assert [i.code for i in issues] == ["bad_live"]


def test_state_accumulates_and_derivative_is_a_function(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        name="Acc",
        nodes=[
            Node(id="f", catalogue="Expression", values={"expr": "x^3"}),
            Node(id="d", catalogue="Derivative"),
            Node(id="dt", catalogue="FrameDelta"),
            Node(id="st", catalogue="State", values={"initial": 1.0}),
            Node(id="grow", catalogue="Expression", values={"expr": "s + dt"}),
            Node(id="ax", catalogue="Axes"),
            Node(id="plot", catalogue="CoordinateSystem.plot"),
        ],
        edges=[
            edge("f", "d", "function"),
            edge("st", "grow", "s"),
            edge("dt", "grow", "dt"),
            edge("grow", "st", "next"),
            edge("ax", "plot", "self"),
            edge("d", "plot", "function"),
        ],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    code = generated.code
    assert "        expression = lambda x: x ** 3\n" in code
    assert (
        "        derivative = lambda x: "
        "(expression(x + 1e-4) - expression(x - 1e-4)) / 2e-4\n"
    ) in code
    assert "        state = [1.0]\n" in code
    assert (
        "        self.add_updater(lambda dt: state.__setitem__(0, state[0] + dt))\n"
        in code
    )
    assert "        plot = axes.plot(derivative)\n" in code


def test_animate_chain_validation(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        nodes=[
            Node(id="c", catalogue="Circle"),
            Node(
                id="a",
                catalogue="Animate",
                chain=[
                    MethodCall(method="shift", values={"vectors": "RIGHT"}),
                    MethodCall(method="scale", values={"scale_factor": 2.0}),
                ],
            ),
            Node(
                id="b", catalogue="Animate", chain=[MethodCall(method="fly", values={})]
            ),
            Node(id="e", catalogue="Animate"),
        ],
        edges=[
            edge("c", "a", "mobject"),
            edge("c", "b", "mobject"),
            edge("c", "e", "mobject"),
        ],
        steps=[PlayStep(animations=["a", "b", "e"])],
    )
    issues = ManimCodeGenerator().generate(scene, catalogue).issues
    assert [(i.code, i.node) for i in issues] == [
        ("bad_chain", "b"),
        ("missing_required", "e"),
    ]
    scene.nodes = scene.nodes[:2]
    scene.edges = scene.edges[:1]
    scene.steps = [PlayStep(animations=["a"])]
    code = ManimCodeGenerator().generate(scene, catalogue).code
    assert "self.play(circle.animate.shift(RIGHT).scale(2.0))" in code


def test_expression_output_type_follows_free_variables(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        nodes=[
            Node(
                id="k",
                catalogue="Expression",
                values={"expr": "a * b", "a": 2.0, "b": 3.0},
            ),
            Node(id="c", catalogue="Circle"),
            Node(id="f", catalogue="Expression", values={"expr": "x^2"}),
            Node(id="c2", catalogue="Circle"),
        ],
        edges=[edge("k", "c", "radius"), edge("f", "c2", "radius")],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert [(i.code, i.node) for i in generated.issues] == [("type_mismatch", "c2")]
    scene.nodes.pop()
    scene.edges.pop()
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert (
        "        expression = 2.0 * 3.0\n        circle = Circle(radius=expression)\n"
        in generated.code
    )


def test_derivative_example_exports(catalogue: Catalogue, tmp_path: Path) -> None:
    path = Path(__file__).resolve().parents[2] / "examples" / "derivative.mnw"
    document = Document.model_validate_json(path.read_text())
    scene = document.scenes[0]
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    layout = layout_timeline(scene, catalogue)
    assert layout.error is None
    assert {b.row for b in layout.bands} == {"dot", "tangent"}
    settings = Settings.model_validate({**SMALL, "frame_rate": 5})
    result = CairoRenderService(tmp_path).export(scene, catalogue, settings, tmp_path)
    assert Path(result.path).name == "Tangent.mp4"
    assert Path(result.path).stat().st_size > 1000
