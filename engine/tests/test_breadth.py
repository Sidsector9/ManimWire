"""Phase 7: containers, groups, collections, config, scene types, and coverage."""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from engine.catalogue import Catalogue
from engine.catalogue.coverage import coverage_report
from engine.catalogue.model import PortType
from engine.codegen import ManimCodeGenerator
from engine.document import (
    AddStep,
    CameraStep,
    ConfigKey,
    Edge,
    FixedInFrameStep,
    GroupDefinition,
    MethodCall,
    Node,
    PlayStep,
    SceneDocument,
    Settings,
    WaitStep,
    validate_group,
)
from engine.document.analysis import Graph
from engine.document.validate import validate_scene
from engine.render import CairoRenderService
from engine.timeline import layout_timeline

SMALL = Settings(pixel_width=256, pixel_height=144, frame_rate=15)


def edge(source: str, target: str, port: str, live: bool = False) -> Edge:
    return Edge(source=source, target=target, port=port, live=live)


def node(id: str, catalogue: str, **kwargs: object) -> Node:
    return Node(id=id, catalogue=catalogue, **kwargs)  # type: ignore[arg-type]


def render_ok(
    scene: SceneDocument, catalogue: Catalogue, tmp_path: Path, **kw: object
) -> None:
    result = CairoRenderService(tmp_path).frame(scene, catalogue, SMALL, 0.5, **kw)  # type: ignore[arg-type]
    assert Path(result.path).exists()


def map_scene() -> SceneDocument:
    """Range -> Map(Dot per item, radius from the item) -> VGroup.arrange -> Create."""
    return SceneDocument(
        name="Dots",
        nodes=[
            node("r", "Range", values={"start": 0, "stop": 3, "step": 1}),
            node("m", "Map", label="dots"),
            node("it", "Item", parent="m"),
            node("size", "Expression", values={"expr": "0.2 + 0.1 * i"}, parent="m"),
            node("d", "Dot", values={"color": "YELLOW"}, parent="m"),
            node("res", "Result", parent="m"),
            node("g", "VGroup"),
            node("arr", "Mobject.arrange"),
            node("c", "Create"),
        ],
        edges=[
            edge("r", "m", "items"),
            edge("it", "size", "i"),
            edge("size", "d", "radius"),
            edge("d", "res", "value"),
            edge("m", "g", "vmobjects"),
            edge("g", "arr", "self"),
            edge("arr", "c", "mobject"),
        ],
        steps=[PlayStep(animations=["c"])],
    )


def test_map_over_range_is_a_loop(catalogue: Catalogue, tmp_path: Path) -> None:
    generated = ManimCodeGenerator().generate(map_scene(), catalogue)
    assert generated.issues == []
    assert (
        "        range = np.arange(0, 3, 1)\n"
        "        dots = []\n"
        "        for item in range:\n"
        "            expression = 0.2 + 0.1 * item\n"
        "            dot = Dot(radius=expression, color=YELLOW)\n"
        "            dots.append(dot)\n"
        "        vgroup = VGroup(*dots)\n"
        "        vgroup.arrange()\n"
    ) in generated.code
    assert generated.source_map.nodes["d"] == [11]
    render_ok(map_scene(), catalogue, tmp_path)


def test_repeat_with_index_and_live_closure(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        nodes=[
            node("rep", "Repeat", values={"count": 3}),
            node("i", "Index", parent="rep"),
            node("x", "Expression", values={"expr": "1.5 * i"}, parent="rep"),
            node("t", "ValueTracker", values={"value": 1.0}),
            node("scale", "Expression", values={"expr": "s * (i + 1)"}, parent="rep"),
            node("d", "Dot", parent="rep"),
            node("setx", "Mobject.set_x", parent="rep"),
            node("res", "Result", parent="rep"),
        ],
        edges=[
            edge("i", "x", "i"),
            edge("i", "scale", "i"),
            edge("t", "scale", "s", live=True),
            edge("scale", "d", "radius"),
            edge("d", "setx", "self"),
            edge("x", "setx", "x"),
            edge("setx", "res", "value"),
        ],
        steps=[AddStep(mobjects=["rep"])],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert (
        "        repeat = []\n"
        "        for index in range(int(3)):\n"
        "            expression = 1.5 * index\n"
        "            dot = always_redraw(lambda index=index: "
        "Dot(radius=value_tracker.get_value() * (index + 1)))\n"
        "            dot.add_updater(lambda mob, expression=expression: "
        "mob.set_x(expression))\n"
        "            repeat.append(dot)\n"
        "        self.add(*repeat)\n"
    ) in generated.code


def test_container_rules(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        nodes=[
            node("m", "Map"),
            node("it", "Item"),
            node("d", "Dot", parent="m"),
            node("c", "Create"),
        ],
        edges=[edge("d", "c", "mobject")],
        steps=[PlayStep(animations=["c"])],
    )
    codes = sorted(
        i.code for i in ManimCodeGenerator().generate(scene, catalogue).issues
    )
    assert codes == ["bad_scope", "misplaced", "missing_required", "missing_required"]


def test_if_chooses_a_color_and_expressions_compare(
    catalogue: Catalogue, tmp_path: Path
) -> None:
    scene = SceneDocument(
        name="Choice",
        nodes=[
            node("x", "Number", values={"value": 2}),
            node("big", "Expression", values={"expr": "x > 1 and x < 5"}),
            node("red", "Color", values={"color": "RED"}),
            node("blue", "Color", values={"color": "BLUE"}),
            node("pick", "If", label="pick"),
            node("c", "Circle"),
        ],
        edges=[
            edge("x", "big", "x"),
            edge("big", "pick", "condition"),
            edge("red", "pick", "then"),
            edge("blue", "pick", "else"),
            edge("pick", "c", "color"),
        ],
        steps=[AddStep(mobjects=["c"])],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert (
        "        expression = number > 1 and number < 5\n"
        "        color = RED\n"
        "        color_2 = BLUE\n"
        "        pick = (color if expression else color_2)\n"
        "        circle = Circle(color=pick)\n"
    ) in generated.code
    render_ok(scene, catalogue, tmp_path)
    scene.edges[1] = edge("x", "pick", "condition")
    assert [i.code for i in ManimCodeGenerator().generate(scene, catalogue).issues] == [
        "type_mismatch"
    ]


def labeled_group() -> GroupDefinition:
    """Circle(radius=size).set_fill(color) as a reusable group with two inputs."""
    return GroupDefinition(
        name="Blob",
        nodes=[
            node("size", "Input", values={"name": "size", "type": "number"}),
            node("color", "Input", values={"name": "color", "type": "color"}),
            node("c", "Circle"),
            node("fill", "VMobject.set_fill", values={"opacity": 1}),
            node("out", "Output"),
        ],
        edges=[
            edge("size", "c", "radius"),
            edge("c", "fill", "self"),
            edge("color", "fill", "color"),
            edge("fill", "out", "value"),
        ],
    )


def test_group_used_twice(catalogue: Catalogue, tmp_path: Path) -> None:
    groups = [labeled_group()]
    assert validate_group(groups[0], catalogue, groups) == []
    scene = SceneDocument(
        name="Blobs",
        nodes=[
            node("a", "group:Blob", values={"size": 1, "color": "RED"}, label="left"),
            node("n", "Number", values={"value": 0.5}),
            node("b", "group:Blob", values={"color": "BLUE"}, label="right"),
            node("shift", "Mobject.shift", values={"vectors": "RIGHT"}),
            node("fa", "FadeIn"),
            node("fb", "FadeIn"),
        ],
        edges=[
            edge("n", "b", "size"),
            edge("b", "shift", "self"),
            edge("a", "fa", "mobjects"),
            edge("shift", "fb", "mobjects"),
        ],
        steps=[PlayStep(animations=["fa", "fb"])],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue, groups)
    assert generated.issues == []
    assert (
        "        left = Circle(radius=1)\n"
        "        left.set_fill(color=RED, opacity=1)\n"
        "        number = 0.5\n"
        "        right = Circle(radius=number)\n"
        "        right.set_fill(color=BLUE, opacity=1)\n"
        "        right.shift(RIGHT)\n"
        "        self.play(FadeIn(left), FadeIn(right))\n"
    ) in generated.code
    result = CairoRenderService(tmp_path).frame(
        scene, catalogue, SMALL, 0.5, groups=groups
    )
    assert {b.node for b in result.bounds} >= {"a", "b"}
    layout = layout_timeline(scene, catalogue, groups)
    assert layout.error is None and [r.id for r in layout.rows] == ["a", "b"]


def test_group_output_tracker_and_many_groups(catalogue: Catalogue) -> None:
    tracker = GroupDefinition(
        name="T",
        nodes=[node("v", "ValueTracker", values={"value": 2}), node("o", "Output")],
        edges=[edge("v", "o", "value")],
    )
    scene = SceneDocument(
        nodes=[node("g", "group:T"), node("c", "Circle")],
        edges=[edge("g", "c", "radius")],
        steps=[AddStep(mobjects=["c"])],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue, [tracker])
    assert "        circle = Circle(radius=t.get_value())\n" in generated.code
    many = [
        GroupDefinition(
            name=f"G{i}",
            nodes=[node("c", "Circle"), node("o", "Output")],
            edges=[edge("c", "o", "value")],
        )
        for i in range(12)
    ]
    started = time.perf_counter()
    Graph(SceneDocument(), catalogue, many)
    assert time.perf_counter() - started < 1.0


def test_container_boundaries(catalogue: Catalogue) -> None:
    """Live values cannot feed a container, and steps cannot reach inside one."""
    scene = SceneDocument(
        nodes=[
            node("t", "ValueTracker"),
            node("r", "Range", values={"stop": 3}),
            node("m", "Map"),
            node("d", "Dot", parent="m"),
            node("res", "Result", parent="m"),
            node("cr", "Create", parent="m"),
        ],
        edges=[
            edge("t", "r", "stop", live=True),
            edge("r", "m", "items"),
            edge("d", "res", "value"),
            edge("d", "cr", "mobject"),
        ],
        steps=[PlayStep(animations=["cr"])],
    )
    issues = ManimCodeGenerator().generate(scene, catalogue).issues
    assert sorted((i.code, i.node) for i in issues) == [
        ("bad_live", "m"),
        ("bad_scope", "cr"),
    ]
    scene.edges[0] = edge("t", "r", "stop")
    scene.nodes = [n for n in scene.nodes if n.id != "cr"] + [
        node("g", "VGroup"),
        node("sm", "Submobject", values={"index": 1.0}),
    ]
    scene.edges = [e for e in scene.edges if e.target != "cr"] + [
        edge("m", "g", "vmobjects"),
        edge("g", "sm", "mobject"),
    ]
    scene.steps = [AddStep(mobjects=["sm"])]
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert "        submobject = vgroup.submobjects[int(1.0)]\n" in generated.code


def test_group_problems(catalogue: Catalogue) -> None:
    loop = GroupDefinition(
        name="Loop",
        nodes=[node("me", "group:Loop"), node("out", "Output")],
        edges=[edge("me", "out", "value")],
    )
    issues = validate_group(loop, catalogue, [loop])
    assert [(i.code, i.group) for i in issues] == [("recursive_group", "Loop")]
    scene = SceneDocument(nodes=[node("x", "group:Missing"), node("i", "Input")])
    codes = sorted(
        i.code for i in ManimCodeGenerator().generate(scene, catalogue).issues
    )
    assert codes == ["misplaced", "unknown_catalogue"]


def test_config_and_collections(catalogue: Catalogue, tmp_path: Path) -> None:
    scene = SceneDocument(
        name="Configured",
        nodes=[
            node(
                "cfg",
                "Config",
                config=[
                    ConfigKey(name="include_ticks", type=PortType.BOOLEAN),
                    ConfigKey(name="color", type=PortType.COLOR),
                ],
                values={"include_ticks": False, "color": "GREY"},
            ),
            node("ax", "Axes", values={"x_range": [0, 3, 1], "y_range": [0, 3, 1]}),
            node("parts", "Submobjects"),
            node("first", "Submobject", values={"index": 1}),
            node("g", "VGroup"),
            node("txt", "Text", values={"text": "hi"}),
            node("img", "Group"),
            node("bad", "VGroup"),
        ],
        edges=[
            edge("cfg", "ax", "axis_config"),
            edge("ax", "parts", "mobject"),
            edge("ax", "first", "mobject"),
            edge("parts", "g", "vmobjects"),
            edge("txt", "g", "vmobjects"),
            edge("img", "bad", "vmobjects"),
        ],
        steps=[AddStep(mobjects=["g", "first"])],
    )
    issues = ManimCodeGenerator().generate(scene, catalogue).issues
    assert [(i.code, i.node) for i in issues] == [("type_mismatch", "bad")]
    assert "Group is not one" in issues[0].message
    scene.nodes = scene.nodes[:-2]
    scene.edges = scene.edges[:-1]
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert (
        "        config = {'include_ticks': False, 'color': GREY}\n"
        "        axes = Axes(x_range=[0, 3, 1], y_range=[0, 3, 1], "
        "axis_config=config)\n"
        "        submobjects = axes.submobjects\n"
        "        submobject = axes.submobjects[1]\n"
        "        text = Text('hi')\n"
        "        vgroup = VGroup(*submobjects, text)\n"
    ) in generated.code
    render_ok(scene, catalogue, tmp_path)


def test_moving_camera_scene(catalogue: Catalogue, tmp_path: Path) -> None:
    scene = SceneDocument(
        name="Pan",
        scene_type="MovingCameraScene",
        nodes=[
            node("sq", "Square"),
            node("frame", "CameraFrame"),
            node(
                "zoom",
                "Animate",
                values={"run_time": 1},
                chain=[MethodCall(method="scale", values={"scale_factor": 0.5})],
            ),
        ],
        edges=[edge("frame", "zoom", "mobject")],
        steps=[AddStep(mobjects=["sq"]), PlayStep(animations=["zoom"])],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert "class Pan(MovingCameraScene):" in generated.code
    assert (
        "        self.play(self.camera.frame.animate(run_time=1).scale(0.5))\n"
        in generated.code
    )
    render_ok(scene, catalogue, tmp_path)
    scene.scene_type = "Scene"
    assert [i.code for i in ManimCodeGenerator().generate(scene, catalogue).issues] == [
        "bad_scene_type"
    ]
    scene.scene_type = "MovingCameraScene"
    scene.nodes.append(node("save", "Mobject.save_state"))
    scene.edges.append(edge("frame", "save", "self"))
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert "        self.camera.frame.save_state()\n" in generated.code


def test_three_d_scene_with_camera_steps(catalogue: Catalogue, tmp_path: Path) -> None:
    scene = SceneDocument(
        name="Ball",
        scene_type="ThreeDScene",
        nodes=[
            node("ax", "ThreeDAxes"),
            node("s", "Sphere", values={"radius": 1, "resolution": [8, 8]}),
            node("lbl", "Text", values={"text": "sphere"}),
        ],
        steps=[
            CameraStep(action="orient", phi=1.0, theta=-0.8),
            AddStep(mobjects=["ax", "s", "lbl"]),
            FixedInFrameStep(mobjects=["lbl"]),
            CameraStep(action="move", theta=0.5, zoom=1.2, run_time=1.0),
        ],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert "class Ball(ThreeDScene):" in generated.code
    assert (
        "        self.set_camera_orientation(phi=1.0, theta=-0.8)\n" in generated.code
    )
    assert "        self.add_fixed_in_frame_mobjects(text)\n" in generated.code
    assert (
        "        self.move_camera(theta=0.5, zoom=1.2, run_time=1.0)\n"
        in generated.code
    )
    layout = layout_timeline(scene, catalogue)
    assert layout.error is None
    assert [(m.kind, m.time) for m in layout.markers][0] == ("camera", 0.0)
    assert [(b.label, b.start, b.end) for b in layout.bars] == [
        ("move camera", 0.0, 1.0)
    ]
    render_ok(scene, catalogue, tmp_path)
    scene.steps.append(CameraStep(action="move"))
    issues = ManimCodeGenerator().generate(scene, catalogue).issues
    assert [i.code for i in issues] == ["bad_step"]


def test_catalogue_breadth_and_coverage(catalogue: Catalogue) -> None:
    index = {e.qualname: e for e in catalogue.entries}
    assert index["MathTex"].requires_latex and index["DecimalNumber"].requires_latex
    assert not index["Text"].requires_latex
    assert len(catalogue.fonts) > 10
    report = coverage_report(catalogue)
    assert report.unpresentable == sum(len(e.unpresentable) for e in report.incomplete)
    assert report.unpresentable <= 203  # the parity metric: only ever lower this number


def test_star_args_take_several_strings_but_one_point(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        nodes=[
            node("t", "Text", values={"text": "a"}),
            node("shift", "Mobject.shift", values={"vectors": [1, 2, 0]}),
            node("tex", "Tex", values={"tex_strings": ["a ", "b"]}),
        ],
        edges=[edge("t", "shift", "self")],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert "        text.shift(np.array([1.0, 2.0, 0.0]))\n" in generated.code
    assert "        tex = Tex('a ', 'b')\n" in generated.code


def test_value_on_a_function_port_is_read_on_each_call(catalogue: Catalogue) -> None:
    """TracedPath(circle.get_start): the point becomes lambda: circle.get_start()."""
    scene = SceneDocument(
        nodes=[
            node("c", "Circle"),
            node("start", "Mobject.get_start"),
            node("trace", "TracedPath"),
            node("bad", "TracedPath"),
            node("f", "FadeIn"),
        ],
        edges=[
            edge("c", "start", "self"),
            edge("start", "trace", "traced_point_func"),
            edge("c", "f", "mobjects"),
            edge("f", "bad", "traced_point_func"),
        ],
        steps=[AddStep(mobjects=["trace"])],
    )
    issues = ManimCodeGenerator().generate(scene, catalogue).issues
    assert [(i.code, i.node) for i in issues] == [("type_mismatch", "bad")]
    scene.nodes = scene.nodes[:3]
    scene.edges = scene.edges[:2]
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert (
        "        traced_path = TracedPath(lambda: circle.get_start())\n"
        in generated.code
    )


def test_a_part_of_a_vmobject_is_a_vmobject(catalogue: Catalogue) -> None:
    """Indexing into a formula gives a part that VMobject-only ports accept.

    Manim promises that a VMobject's parts are VMobjects and nothing more, so a
    part is typed VMobject when its owner is one and Mobject otherwise. A
    Group's part is still refused.
    """
    scene = SceneDocument(
        name="Parts",
        nodes=[
            node("m", "MathTex", values={"tex_strings": ["a", "+", "b"]}),
            node("part", "Submobject", values={"index": 2}),
            node("g", "VGroup"),
            node("plain", "Group"),
            node("its_part", "Submobject", values={"index": 0}),
            node("bad", "VGroup"),
        ],
        edges=[
            edge("m", "part", "mobject"),
            edge("part", "g", "vmobjects"),
            edge("plain", "its_part", "mobject"),
            edge("its_part", "bad", "vmobjects"),
        ],
        steps=[AddStep(mobjects=["g"])],
    )
    issues = ManimCodeGenerator().generate(scene, catalogue).issues
    assert [(i.code, i.node) for i in issues] == [("type_mismatch", "bad")]
    assert "Mobject is not one" in issues[0].message


def test_copy_makes_a_second_object(catalogue: Catalogue) -> None:
    """``copy`` is annotated Self but builds a new object, so it gets its own name.

    Without this the copy is emitted as a bare statement and the animation moves
    the original, which then leaves its place in the formula.
    """
    scene = SceneDocument(
        name="Copies",
        nodes=[
            node("m", "MathTex", values={"tex_strings": ["a", "b"]}),
            node("part", "Submobject", values={"index": 0}),
            node("twin", "Mobject.copy", label="a copy"),
            node("shift", "Mobject.shift", values={"vectors": [1, 0, 0]}),
            node("move", "Transform", values={"remover": True}),
        ],
        edges=[
            edge("m", "part", "mobject"),
            edge("part", "twin", "self"),
            edge("twin", "shift", "self"),
            edge("shift", "move", "mobject"),
            edge("m", "move", "target_mobject"),
        ],
        steps=[AddStep(mobjects=["m"]), PlayStep(animations=["move"])],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert "        submobject = math_tex.submobjects[0]\n" in generated.code
    assert "        a_copy = submobject.copy()\n" in generated.code
    assert "        a_copy.shift(np.array([1.0, 0.0, 0.0]))\n" in generated.code
    assert "Transform(a_copy, target_mobject=math_tex, remover=True)" in generated.code


def transform_cycle_scene() -> SceneDocument:
    """Circle, then Map over a VGroup of shapes playing Transform once per shape."""
    return SceneDocument(
        name="TransformCycle",
        nodes=[
            node("a", "Circle", label="a"),
            node("t1", "Square", label="t1"),
            node("t2", "Triangle", label="t2"),
            node("shapes", "VGroup", label="shapes"),
            node("loop", "Map", label="each shape"),
            node("t", "Item", label="t", parent="loop"),
            node("tr", "Transform", parent="loop"),
            node("res", "Result", parent="loop"),
        ],
        edges=[
            edge("t1", "shapes", "vmobjects"),
            edge("t2", "shapes", "vmobjects"),
            edge("shapes", "loop", "items"),
            edge("a", "tr", "mobject"),
            edge("t", "tr", "target_mobject"),
            edge("tr", "res", "value"),
        ],
        steps=[
            AddStep(mobjects=["a"]),
            WaitStep(duration=1.0),
            PlayStep(animations=["loop"]),
        ],
    )


def test_played_map_becomes_a_for_loop_around_play(catalogue: Catalogue) -> None:
    generated = ManimCodeGenerator().generate(transform_cycle_scene(), catalogue)
    assert generated.issues == []
    assert (
        "        self.add(a)\n"
        "        self.wait(1.0)\n"
        "        for t in shapes:\n"
        "            self.play(Transform(a, target_mobject=t))\n"
    ) in generated.code
    # The loop replaces the container's list; nothing collects the runs.
    assert "append" not in generated.code


def test_played_map_keeps_the_step_options(catalogue: Catalogue) -> None:
    scene = transform_cycle_scene()
    scene.steps[2] = PlayStep(animations=["loop"], run_time=0.5, rate_func="linear")
    code = ManimCodeGenerator().generate(scene, catalogue).code
    assert (
        "            self.play(Transform(a, target_mobject=t), "
        "run_time=0.5, rate_func=linear)\n"
    ) in code


def test_played_map_puts_one_bar_on_the_timeline_per_run(
    catalogue: Catalogue,
) -> None:
    layout = layout_timeline(transform_cycle_scene(), catalogue)
    assert layout.error is None
    assert layout.total == 3.0
    play = layout.steps[2]
    assert (play.start, play.end, play.label) == (1.0, 3.0, "Transform x 2")
    runs = [bar for bar in layout.bars if bar.step == 2]
    assert [(bar.run, bar.start, bar.end) for bar in runs] == [
        (0, 1.0, 2.0),
        (1, 2.0, 3.0),
    ]
    # The container owns the row: its runs are not rows of their own.
    assert runs[0].rows == ["a", "loop"]


def test_played_map_renders_the_second_run(
    catalogue: Catalogue, tmp_path: Path
) -> None:
    service = CairoRenderService(tmp_path)
    scene = transform_cycle_scene()
    sizes = {}
    for moment in (1.99, 2.99):
        result = service.frame(scene, catalogue, SMALL, moment)
        assert Path(result.path).exists()
        circle = next(b for b in result.bounds if b.node == "a")
        assert circle.on_screen
        sizes[moment] = (circle.width, circle.height)
    # Each run transforms the same object again, so it ends as the second shape.
    # Without the second run it would still be the square at the end.
    assert sizes[1.99] == pytest.approx((2.0, 2.0), abs=0.02)
    assert sizes[2.99] == pytest.approx((1.732, 1.5), abs=0.02)


def test_a_played_container_cannot_also_be_a_value(catalogue: Catalogue) -> None:
    scene = transform_cycle_scene()
    scene.nodes.append(node("g", "VGroup"))
    scene.edges.append(edge("loop", "g", "vmobjects"))
    codes = {i.code for i in validate_scene(scene, catalogue, [])}
    assert "bad_scope" in codes


def test_a_played_container_is_alone_in_its_step(catalogue: Catalogue) -> None:
    scene = transform_cycle_scene()
    scene.nodes.append(node("fade", "FadeIn"))
    scene.edges.append(edge("a", "fade", "mobjects"))
    scene.steps[2] = PlayStep(animations=["loop", "fade"])
    codes = {i.code for i in validate_scene(scene, catalogue, [])}
    assert "bad_step" in codes


def test_a_container_of_objects_is_still_not_an_animation(
    catalogue: Catalogue,
) -> None:
    scene = map_scene()
    scene.steps = [PlayStep(animations=["m"])]
    messages = [i.message for i in validate_scene(scene, catalogue, [])]
    assert "Map is not an animation" in messages


def test_an_empty_loop_leaves_the_next_step_its_own_timings(
    catalogue: Catalogue,
) -> None:
    """A Map over nothing plays nothing; the step after it keeps its animation."""
    scene = transform_cycle_scene()
    # An empty VGroup: the loop body never runs.
    scene.edges = [e for e in scene.edges if e.target != "shapes"]
    scene.nodes.append(node("fade", "FadeIn"))
    scene.edges.append(edge("a", "fade", "mobjects"))
    scene.steps.append(PlayStep(animations=["fade"]))

    layout = layout_timeline(scene, catalogue)
    assert layout.error is None
    assert [bar.step for bar in layout.bars] == [3]
    loop_step, fade_step = layout.steps[2], layout.steps[3]
    assert (loop_step.start, loop_step.end) == (1.0, 1.0)
    assert (fade_step.start, fade_step.end) == (1.0, 2.0)
    assert layout.total == 2.0
