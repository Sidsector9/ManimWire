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
    assert bars["lag"].rows == ["dot", "dot_2", "dot_3"]
    assert bars["f3"].rows == ["dot_3"]


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
    assert layout.markers[1].rows == ["dot"] and layout.markers[
        1
    ].time == pytest.approx(3.5)
    assert layout.sections[0].name == "intro" and layout.sections[
        0
    ].end == pytest.approx(3.5)
    assert layout.rows == ["dot", "dot_2", "dot_3"]


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
