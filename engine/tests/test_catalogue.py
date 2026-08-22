from __future__ import annotations

from engine.__main__ import build_dispatcher
from engine.catalogue import Catalogue, Descriptor, Parameter, PortType
from engine.catalogue.build import category_for


def entry(catalogue: Catalogue, qualname: str) -> Descriptor:
    matches = [e for e in catalogue.entries if e.qualname == qualname]
    assert len(matches) == 1, qualname
    return matches[0]


def param(descriptor: Descriptor, name: str) -> Parameter:
    matches = [p for p in descriptor.parameters if p.name == name]
    assert len(matches) == 1, name
    return matches[0]


def test_circle_constructor_follows_kwargs_up_the_hierarchy(
    catalogue: Catalogue,
) -> None:
    circle = entry(catalogue, "Circle")
    assert circle.kind == "class"
    assert circle.category == "geometry"
    assert circle.returns.type is PortType.MOBJECT
    assert circle.is_vmobject is True
    assert circle.hidden is False
    assert (
        "Arc" in circle.bases
        and "VMobject" in circle.bases
        and "Mobject" in circle.bases
    )
    radius = param(circle, "radius")
    assert radius.type.type is PortType.NUMBER
    assert radius.owner == "Circle"
    assert param(circle, "color").default == "RED"
    fill_opacity = param(circle, "fill_opacity")
    assert fill_opacity.owner == "VMobject"
    assert fill_opacity.default == "0.0"
    assert param(circle, "stroke_width").default == "4"
    assert param(circle, "arc_center").default == "ORIGIN"
    assert param(circle, "z_index").owner == "Mobject"
    assert circle.doc == "A circle."


def test_parameters_a_subclass_passes_explicitly_are_not_offered(
    catalogue: Catalogue,
) -> None:
    circle = {p.name for p in entry(catalogue, "Circle").parameters}
    assert "angle" not in circle and "start_angle" not in circle
    assert {"radius", "color", "fill_opacity", "arc_center"} <= circle
    square = {p.name for p in entry(catalogue, "Square").parameters}
    assert "width" not in square and "height" not in square
    assert {"side_length", "fill_opacity"} <= square
    rectangle = {p.name for p in entry(catalogue, "Rectangle").parameters}
    assert {"width", "height"} <= rectangle


def test_class_names_are_not_mistaken_for_vector_aliases(catalogue: Catalogue) -> None:
    label = entry(catalogue, "VectorScene.label_vector")
    assert param(label, "vector").type.type is PortType.MOBJECT
    assert entry(catalogue, "Vector").returns.type is PortType.MOBJECT


def test_set_fill_method(catalogue: Catalogue) -> None:
    set_fill = entry(catalogue, "VMobject.set_fill")
    assert set_fill.kind == "method"
    assert set_fill.owner == "VMobject"
    assert [p.name for p in set_fill.parameters] == ["color", "opacity", "family"]
    assert param(set_fill, "color").type.type is PortType.COLOR
    assert param(set_fill, "family").type.type is PortType.BOOLEAN
    assert set_fill.returns.type is PortType.MOBJECT


def test_create_animation_inherits_timing_parameters(catalogue: Catalogue) -> None:
    create = entry(catalogue, "Create")
    assert create.category == "animation.creation"
    assert create.returns.type is PortType.ANIMATION
    assert param(create, "mobject").type.type is PortType.MOBJECT
    assert param(create, "lag_ratio").default == "1.0"
    assert param(create, "run_time").default == "1.0"
    assert param(create, "run_time").owner == "Animation"
    rate = param(create, "rate_func")
    assert rate.default == "smooth"
    assert rate.type.type is PortType.FUNCTION
    assert rate.type.signature == "(float) -> float"


def test_axes_plot_is_a_coordinate_system_method(catalogue: Catalogue) -> None:
    axes = entry(catalogue, "Axes")
    assert axes.returns.type is PortType.COORDINATE_SYSTEM
    assert "CoordinateSystem" in axes.bases
    assert param(axes, "x_range").type.collection is True
    plot = entry(catalogue, "CoordinateSystem.plot")
    assert plot.owner == "CoordinateSystem"
    function = param(plot, "function")
    assert function.type.type is PortType.FUNCTION
    assert function.type.signature == "(float) -> float"
    assert plot.returns.type is PortType.MOBJECT
    assert entry(catalogue, "CoordinateSystem").hidden is True


def test_value_tracker_and_scene(catalogue: Catalogue) -> None:
    assert entry(catalogue, "ValueTracker").returns.type is PortType.LIVE_NUMBER
    play = entry(catalogue, "Scene.play")
    assert play.category == "scene"
    assert param(play, "args").kind == "var_positional"
    assert entry(catalogue, "always_redraw").kind == "function"
    assert entry(catalogue, "smooth").category == "rate_functions"
    assert entry(catalogue, "smooth").signature == "(float) -> float"
    assert entry(catalogue, "always_redraw").signature == "(Callable[[], M]) -> M"
    assert entry(catalogue, "Circle").signature is None


def test_counts_stay_in_expected_ranges(catalogue: Catalogue) -> None:
    visible_classes = [
        e for e in catalogue.entries if e.kind == "class" and not e.hidden
    ]
    mobjects = [
        e
        for e in visible_classes
        if e.returns.type in (PortType.MOBJECT, PortType.COORDINATE_SYSTEM)
    ]
    animations = [e for e in visible_classes if e.returns.type is PortType.ANIMATION]
    assert 120 <= len(mobjects) <= 180, len(mobjects)
    assert 60 <= len(animations) <= 90, len(animations)
    assert not any(e.name.startswith("OpenGL") for e in catalogue.entries)
    assert len({e.qualname for e in catalogue.entries}) == len(catalogue.entries)


def test_colors_and_version(catalogue: Catalogue) -> None:
    colors = {c.name: c.hex for c in catalogue.colors}
    assert colors["BLUE"] == "#58C4DD"
    assert colors["BLACK"] == "#000000"
    assert catalogue.manim_version == "0.21.0"
    assert catalogue.directions[:5] == ["ORIGIN", "UP", "DOWN", "LEFT", "RIGHT"]


def test_unknown_annotations_are_reported(catalogue: Catalogue) -> None:
    # Printed so the coverage gap is visible in the test output.
    print("\nunknown annotations:", len(catalogue.unknown_annotations))
    for text in catalogue.unknown_annotations:
        print("  ", text)
    assert "Point3DLike" not in catalogue.unknown_annotations


def test_category_mapping() -> None:
    assert category_for("manim.mobject.geometry.arc") == "geometry"
    assert category_for("manim.mobject.value_tracker") == "value"
    assert category_for("manim.mobject.matrix") == "mobject"
    assert category_for("manim.animation.creation") == "animation.creation"
    assert category_for("manim.utils.rate_functions") == "rate_functions"
    assert category_for("manim.utils.bezier") == "utils.bezier"


def test_rpc_methods() -> None:
    dispatcher = build_dispatcher()
    listing = dispatcher.handle({"jsonrpc": "2.0", "id": 1, "method": "catalogue.list"})
    assert listing is not None and listing["result"]["manim_version"] == "0.21.0"
    one = dispatcher.handle(
        {"jsonrpc": "2.0", "id": 2, "method": "catalogue.get", "params": ["Circle"]}
    )
    assert one is not None and one["result"]["name"] == "Circle"
    missing = dispatcher.handle(
        {"jsonrpc": "2.0", "id": 3, "method": "catalogue.get", "params": ["Nope"]}
    )
    assert missing is not None and "error" in missing
