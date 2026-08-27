"""Phase 7: containers, groups, collections, config, scene types, and coverage."""

from __future__ import annotations

import time
from pathlib import Path

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
    validate_group,
)
from engine.document.analysis import Graph
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
        "        for index, item in enumerate(range):\n"
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
