from __future__ import annotations

from typing import Any

from manim import config, tempconfig

from engine.__main__ import build_dispatcher
from engine.catalogue import Catalogue
from engine.codegen import ManimCodeGenerator
from engine.codegen.generator import snake_case
from engine.document import (
    AddStep,
    Document,
    Edge,
    Node,
    PlayStep,
    SceneDocument,
    WaitStep,
)

EXPECTED = """\
from manim import *


class BlueCircle(Scene):
    def construct(self):
        circle = Circle(radius=2.0)
        circle.set_fill(color=BLUE, opacity=1.0)
        self.play(Create(circle, run_time=2.0))
"""


def test_simple_scene_source(catalogue: Catalogue, simple_scene: SceneDocument) -> None:
    generated = ManimCodeGenerator().generate(simple_scene, catalogue)
    assert generated.code == EXPECTED
    assert generated.source_map.nodes == {"c": [6], "f": [7]}
    assert generated.source_map.steps == {0: [8]}


def test_simple_scene_renders_a_blue_circle(
    catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    code = ManimCodeGenerator().generate(simple_scene, catalogue).code
    namespace: dict[str, Any] = {}
    exec(code, namespace)
    with tempconfig(
        {
            "dry_run": True,
            "pixel_width": 256,
            "pixel_height": 144,
            "frame_rate": 15,
            "disable_caching": True,
            "verbosity": "ERROR",
            "progress_bar": "none",
        }
    ):
        scene = namespace["BlueCircle"]()
        scene.render()
        frame = scene.renderer.get_frame()
    assert config.pixel_width == 1920  # tempconfig restored the global config
    assert frame.shape[:2] == (144, 256)
    assert tuple(frame[72, 128][:3]) == (88, 196, 221)  # BLUE at the centre
    assert tuple(frame[0, 0][:3]) == (0, 0, 0)


def test_all_step_kinds_positional_args_and_vectors(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        name="Steps",
        nodes=[
            Node(id="s", catalogue="Square", label="box"),
            Node(id="sh", catalogue="Mobject.shift"),
            Node(id="d", catalogue="Dot", values={"point": [1.0, 2.0, 0.0]}),
            Node(id="g", catalogue="VGroup"),
            Node(id="fade", catalogue="FadeOut"),
        ],
        edges=[
            Edge(source="s", target="sh", port="self"),
            Edge(source="s", target="g", port="vmobjects"),
            Edge(source="d", target="g", port="vmobjects"),
            Edge(source="g", target="fade", port="mobjects"),
        ],
        steps=[
            AddStep(mobjects=["g"]),
            WaitStep(duration=0.5),
            PlayStep(animations=["fade"]),
        ],
    )
    scene.nodes[1].values["vectors"] = "RIGHT"
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.code == (
        "from manim import *\n"
        "import numpy as np\n"
        "\n"
        "\n"
        "class Steps(Scene):\n"
        "    def construct(self):\n"
        "        box = Square()\n"
        "        box.shift(RIGHT)\n"
        "        dot = Dot(point=np.array([1.0, 2.0, 0.0]))\n"
        "        vgroup = VGroup(box, dot)\n"
        "        self.add(vgroup)\n"
        "        self.wait(0.5)\n"
        "        self.play(FadeOut(vgroup))\n"
    )


def test_method_with_a_real_return_value_gets_its_own_variable(
    catalogue: Catalogue,
) -> None:
    scene = SceneDocument(
        name="Plot",
        nodes=[
            Node(id="ax", catalogue="Axes"),
            Node(id="labels", catalogue="Axes.get_axis_labels"),
        ],
        edges=[Edge(source="ax", target="labels", port="self")],
    )
    code = ManimCodeGenerator().generate(scene, catalogue).code
    assert (
        "        axes = Axes()\n        get_axis_labels = axes.get_axis_labels()\n"
        in code
    )


def test_variable_names_are_unique_identifiers(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        nodes=[
            Node(id="a", catalogue="Circle"),
            Node(id="b", catalogue="Circle"),
            Node(id="c", catalogue="Circle", label="2 big circles!"),
        ]
    )
    code = ManimCodeGenerator().generate(scene, catalogue).code
    assert "circle = Circle()" in code
    assert "circle_2 = Circle()" in code
    assert "v_2_big_circles = Circle()" in code
    assert snake_case("MathTex") == "math_tex"
    assert snake_case("VGroup") == "vgroup"
    assert snake_case("MoveAlongPath") == "move_along_path"


def test_generate_refuses_an_invalid_scene(catalogue: Catalogue) -> None:
    scene = SceneDocument(nodes=[Node(id="f", catalogue="VMobject.set_fill")])
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.code == ""
    assert [i.code for i in generated.issues] == ["missing_required"]


def test_empty_scene_has_a_pass(catalogue: Catalogue) -> None:
    assert (
        ManimCodeGenerator()
        .generate(SceneDocument(), catalogue)
        .code.endswith("        pass\n")
    )


def test_rpc_generate_and_validate(simple_scene: SceneDocument) -> None:
    dispatcher = build_dispatcher()
    document = Document(scenes=[simple_scene]).model_dump()
    generated = dispatcher.handle(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "document.generate",
            "params": {"document": document, "scene": "BlueCircle"},
        }
    )
    assert generated is not None and generated["result"]["code"] == EXPECTED
    checked = dispatcher.handle(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "document.validate",
            "params": {"document": document},
        }
    )
    assert checked is not None and checked["result"] == []
