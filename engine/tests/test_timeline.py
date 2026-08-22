from __future__ import annotations

import pytest
from manim import Dot, FadeIn, LaggedStart, Succession

from engine.__main__ import build_dispatcher
from engine.catalogue import Catalogue
from engine.document import Document, Edge, Node, PlayStep, SceneDocument
from engine.timeline import layout_timeline


def test_nested_groups_match_manim_timings(
    catalogue: Catalogue, three_dots_scene: SceneDocument
) -> None:
    layout = layout_timeline(three_dots_scene, catalogue)
    bars = {b.node: b for b in layout.bars}

    # The same construction in Manim itself is the reference.
    d1, d2, d3 = Dot(), Dot(), Dot()
    succession = Succession(FadeIn(d1, run_time=2.0), FadeIn(d2))
    lagged = LaggedStart(succession, FadeIn(d3), lag_ratio=0.3)
    expected_succ = succession.anims_with_timings
    expected_lag = lagged.anims_with_timings

    assert bars["lag"].start == 0.0
    assert bars["lag"].end == pytest.approx(lagged.run_time)
    assert bars["succ"].start == pytest.approx(expected_lag["start"][0])
    assert bars["succ"].end == pytest.approx(expected_lag["end"][0])
    assert bars["f3"].start == pytest.approx(expected_lag["start"][1])
    assert bars["f3"].end == pytest.approx(expected_lag["end"][1])
    assert bars["f1"].start == pytest.approx(expected_succ["start"][0])
    assert bars["f2"].start == pytest.approx(expected_succ["start"][1])
    assert bars["f2"].end == pytest.approx(expected_succ["end"][1])
    assert bars["f2"].parent == "succ" and bars["f2"].depth == 2
    assert bars["lag"].rows == ["d1", "d2", "d3"]
    assert bars["f3"].rows == ["d3"]
    assert [(r.id, r.label) for r in layout.rows] == [
        ("d1", "Dot 1"),
        ("d2", "Dot 2"),
        ("d3", "Dot 3"),
    ]


def test_explicit_group_run_time_rescales_children(
    catalogue: Catalogue, three_dots_scene: SceneDocument
) -> None:
    scene = three_dots_scene
    scene.nodes[-1].values["run_time"] = 1.0  # LaggedStart lasts 1 s instead of 3 s
    layout = layout_timeline(scene, catalogue)
    bars = {b.node: b for b in layout.bars}
    d1, d2, d3 = Dot(), Dot(), Dot()
    lagged = LaggedStart(
        Succession(FadeIn(d1, run_time=2.0), FadeIn(d2)),
        FadeIn(d3),
        lag_ratio=0.3,
        run_time=1.0,
    )
    scale = lagged.run_time / lagged.max_end_time
    assert bars["lag"].end == pytest.approx(1.0)
    assert bars["f3"].start == pytest.approx(
        lagged.anims_with_timings["start"][1] * scale
    )
    assert bars["f3"].end == pytest.approx(lagged.anims_with_timings["end"][1] * scale)


def test_steps_markers_sections_and_rows(
    catalogue: Catalogue, three_dots_scene: SceneDocument
) -> None:
    layout = layout_timeline(three_dots_scene, catalogue)
    assert [s.kind for s in layout.steps] == ["section", "play", "wait", "add", "sound"]
    play = layout.steps[1]
    assert play.start == 0.0 and play.end == pytest.approx(3.0)
    assert layout.steps[2].end == pytest.approx(3.5)
    assert layout.total == pytest.approx(3.5)
    assert [m.kind for m in layout.markers] == ["section", "add", "sound"]
    assert layout.markers[1].rows == ["d1"] and layout.markers[1].time == pytest.approx(
        3.5
    )
    assert layout.sections[0].name == "intro" and layout.sections[
        0
    ].end == pytest.approx(3.5)
    assert [r.id for r in layout.rows] == ["d1", "d2", "d3"]


def test_play_run_time_applies_to_every_animation(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        nodes=[
            Node(id="c", catalogue="Circle"),
            Node(id="a", catalogue="Create"),
            Node(id="b", catalogue="FadeIn", values={"run_time": 3.0}),
        ],
        edges=[
            Edge(source="c", target="a", port="mobject"),
            Edge(source="c", target="b", port="mobjects"),
        ],
        steps=[PlayStep(animations=["a", "b"], run_time=0.5)],
    )
    layout = layout_timeline(scene, catalogue)
    assert [b.end for b in layout.bars] == [0.5, 0.5]
    assert layout.steps[0].end == 0.5
    assert layout.bars[0].rate_func == "smooth"


def test_layout_rpc(three_dots_scene: SceneDocument) -> None:
    dispatcher = build_dispatcher()
    document = Document(scenes=[three_dots_scene]).model_dump()
    response = dispatcher.handle(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "timeline.layout",
            "params": {"document": document, "scene": "Dots"},
        }
    )
    assert response is not None
    assert response["result"]["total"] == pytest.approx(3.5)


def test_children_manim_builds_itself_come_from_manim(catalogue: Catalogue) -> None:
    """LaggedStartMap makes one FadeIn per submobject; the document never lists them."""
    scene = SceneDocument(
        name="Lagged",
        nodes=[
            Node(id="a", catalogue="Dot"),
            Node(id="b", catalogue="Dot"),
            Node(id="g", catalogue="VGroup"),
            Node(id="m", catalogue="LaggedStartMap", values={"lag_ratio": 0.5}),
        ],
        edges=[
            Edge(source="a", target="g", port="vmobjects"),
            Edge(source="b", target="g", port="vmobjects"),
            Edge(source="g", target="m", port="mobject"),
        ],
        steps=[PlayStep(animations=["m"])],
    )
    scene.nodes[3].values["animation_class"] = "FadeIn"
    layout = layout_timeline(scene, catalogue)
    assert layout.error is None
    children = [b for b in layout.bars if b.depth == 1]
    assert len(children) == 2
    assert all(c.node == "m" and c.label == "FadeIn" for c in children)
    assert layout.total == pytest.approx(2.0)  # LaggedStartMap's own run_time default
    assert children[1].start == pytest.approx(children[0].end * 0.5)


def test_style_nodes_share_their_objects_row(
    catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    layout = layout_timeline(simple_scene, catalogue)
    assert [r.id for r in layout.rows] == ["c"]
    assert layout.bars[0].rows == [
        "c"
    ]  # Create acts on set_fill's output, which is the circle


def test_invalid_scene_gives_an_empty_layout_with_the_reason(
    catalogue: Catalogue,
) -> None:
    scene = SceneDocument(nodes=[Node(id="f", catalogue="VMobject.set_fill")])
    layout = layout_timeline(scene, catalogue)
    assert layout.total == 0.0 and layout.bars == []
    assert layout.error is not None and "set_fill" in layout.error
