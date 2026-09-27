from __future__ import annotations

from typing import Any

import pytest
from manim import Circle, Write, tempconfig

from engine.catalogue import Catalogue
from engine.catalogue.audit import audit_inputs
from engine.catalogue.model import PortType
from engine.codegen import ManimCodeGenerator
from engine.document import ConfigKey, Edge, Node, PlayStep, SceneDocument
from engine.document.validate import validate_scene


def params(catalogue: Catalogue, name: str) -> dict[str, Any]:
    return {
        p.name: p
        for p in next(e for e in catalogue.entries if e.qualname == name).parameters
    }


def test_every_exposed_node_has_its_public_signature_and_keyword_inputs(
    catalogue: Catalogue,
) -> None:
    report = audit_inputs(catalogue)
    assert report["entries"] > 1300
    assert report["missing_signature_inputs"] == 0, [
        r for r in report["nodes"] if r["missing_signature_inputs"]
    ]
    assert report["missing_keyword_inputs"] == 0, [
        r for r in report["nodes"] if r["missing_keyword_inputs"]
    ]


@pytest.mark.parametrize(
    "node,names",
    [
        ("Write", {"run_time", "lag_ratio"}),
        ("Unwrite", {"run_time", "lag_ratio"}),
        ("NumberPlane", {"axis_config", "y_axis_config"}),
        ("ComplexPlane", {"axis_config", "y_axis_config"}),
        ("BarChart", {"tips", "x_axis_config"}),
        *[
            (name, {"tex_template"})
            for name in ["MathTex", "Tex", "BulletedList", "Title"]
        ],
        ("Arrow", {"tip_shape"}),
        (
            "LabeledArrow",
            {
                "tip_shape",
                "max_tip_length_to_length_ratio",
                "max_stroke_width_to_length_ratio",
            },
        ),
        ("CurvedDoubleArrow", {"tip_shape_start", "tip_shape_end"}),
        (
            "Text",
            {"text2color", "text2font", "text2weight", "text2slant", "text2gradient"},
        ),
        ("Paragraph", {"font", "font_size", "disable_ligatures"}),
        ("CoordinateSystem.plot", {"color", "stroke_width", "discontinuities"}),
        ("CoordinateSystem.add_coordinates", {"font_size", "buff", "excluding"}),
        ("Mobject.arrange", {"aligned_edge", "coor_mask"}),
        ("Mobject.scale_to_fit_width", {"about_point", "about_edge"}),
    ],
)
def test_recovered_options(catalogue: Catalogue, node: str, names: set[str]) -> None:
    assert names <= params(catalogue, node).keys()


def test_dynamic_defaults_and_fixed_arguments(catalogue: Catalogue) -> None:
    write = params(catalogue, "Write")
    for name in ["run_time", "lag_ratio"]:
        assert write[name].type.type is PortType.NUMBER
        assert write[name].default == "None"  # Write computes these from its object.
    assert params(catalogue, "BarChart")["tips"].default == "False"
    assert params(catalogue, "Arrow")["tip_shape"].type.annotation.startswith("type[")
    assert "remover" in write
    assert {"path_arc", "path_arc_axis"} <= params(catalogue, "Rotate").keys()
    assert not {"angle", "start_angle"} & params(catalogue, "Circle").keys()
    assert not {"width", "height"} & params(catalogue, "Square").keys()
    assert not {"start", "end"} & params(catalogue, "Vector").keys()
    assert "background" not in params(catalogue, "VMobject.set_background_stroke")
    assert "depth_test" not in params(catalogue, "CoordinateSystem.plot_surface")


def test_write_options_generate_and_render(catalogue: Catalogue) -> None:
    document = SceneDocument(
        name="Writing",
        nodes=[
            Node(
                id="axes",
                catalogue="Axes",
                values={"x_range": [-3, 10, 1], "y_range": [-1, 8, 1]},
            ),
            Node(
                id="labels",
                catalogue="CoordinateSystem.add_coordinates",
                values={"font_size": 18},
            ),
            Node(
                id="write", catalogue="Write", values={"run_time": 1, "lag_ratio": 0.01}
            ),
        ],
        edges=[
            Edge(source="axes", target="labels", port="self"),
            Edge(source="labels", target="write", port="vmobject"),
        ],
        steps=[PlayStep(animations=["write"])],
    )
    generated = ManimCodeGenerator().generate(document, catalogue)
    assert not generated.issues
    assert "run_time=1" in generated.code and "lag_ratio=0.01" in generated.code
    namespace: dict[str, Any] = {}
    exec(generated.code, namespace)
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
        scene = namespace["Writing"]()
        scene.render()
        assert scene.time == pytest.approx(1)


def test_dynamic_kwargs_config_is_expanded_and_duplicates_are_rejected(
    catalogue: Catalogue,
) -> None:
    scene = SceneDocument(
        nodes=[
            Node(id="c", catalogue="Circle"),
            Node(
                id="options",
                catalogue="Config",
                config=[ConfigKey(name="run_time", type=PortType.NUMBER)],
                values={"run_time": 3},
            ),
            Node(id="w", catalogue="Write"),
        ],
        edges=[
            Edge(source="c", target="w", port="vmobject"),
            Edge(source="options", target="w", port="kwargs"),
        ],
        steps=[PlayStep(animations=["w"])],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert not generated.issues
    assert "config = {'run_time': 3}" in generated.code
    assert "Write(circle, **config)" in generated.code
    scene.nodes[-1].values["run_time"] = 2
    assert any(
        "repeat an input" in issue.message for issue in validate_scene(scene, catalogue)
    )


def test_omitted_write_options_keep_manims_object_dependent_defaults(
    catalogue: Catalogue,
) -> None:
    scene = SceneDocument(
        nodes=[Node(id="c", catalogue="Circle"), Node(id="w", catalogue="Write")],
        edges=[Edge(source="c", target="w", port="vmobject")],
        steps=[PlayStep(animations=["w"])],
    )
    code = ManimCodeGenerator().generate(scene, catalogue).code
    assert "run_time=" not in code and "lag_ratio=" not in code
    assert Write(Circle()).run_time == 1
