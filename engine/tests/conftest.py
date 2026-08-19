from __future__ import annotations

import pytest

from engine.catalogue import Catalogue, get_catalogue
from engine.document import (
    AddStep,
    Edge,
    Node,
    PlayStep,
    SceneDocument,
    SectionStep,
    SoundStep,
    WaitStep,
)


@pytest.fixture(scope="session")
def catalogue() -> Catalogue:
    return get_catalogue()


def make_simple_scene() -> SceneDocument:
    """Circle -> set_fill(BLUE) -> Create, the first milestone scene."""
    return SceneDocument(
        name="BlueCircle",
        nodes=[
            Node(id="c", catalogue="Circle", values={"radius": 2.0}),
            Node(
                id="f",
                catalogue="VMobject.set_fill",
                values={"color": "BLUE", "opacity": 1.0},
            ),
            Node(id="a", catalogue="Create", values={"run_time": 2.0}),
        ],
        edges=[
            Edge(source="c", target="f", port="self"),
            Edge(source="f", target="a", port="mobject"),
        ],
        steps=[PlayStep(animations=["a"])],
    )


@pytest.fixture
def simple_scene() -> SceneDocument:
    return make_simple_scene()


def make_three_dots_scene() -> SceneDocument:
    """LaggedStart(Succession(FadeIn(d1, 2 s), FadeIn(d2)), FadeIn(d3)), lag 0.3."""
    nodes = [Node(id=f"d{i}", catalogue="Dot") for i in (1, 2, 3)]
    nodes += [
        Node(id="f1", catalogue="FadeIn", values={"run_time": 2.0}),
        Node(id="f2", catalogue="FadeIn"),
        Node(id="f3", catalogue="FadeIn"),
        Node(id="succ", catalogue="Succession"),
        Node(id="lag", catalogue="LaggedStart", values={"lag_ratio": 0.3}),
    ]
    edges = [
        Edge(source="d1", target="f1", port="mobjects"),
        Edge(source="d2", target="f2", port="mobjects"),
        Edge(source="d3", target="f3", port="mobjects"),
        Edge(source="f1", target="succ", port="animations"),
        Edge(source="f2", target="succ", port="animations"),
        Edge(source="succ", target="lag", port="animations"),
        Edge(source="f3", target="lag", port="animations"),
    ]
    return SceneDocument(
        name="Dots",
        nodes=nodes,
        edges=edges,
        steps=[
            SectionStep(name="intro"),
            PlayStep(animations=["lag"]),
            WaitStep(duration=0.5),
            AddStep(mobjects=["d1"]),
            SoundStep(file="ping.wav"),
        ],
    )


@pytest.fixture
def three_dots_scene() -> SceneDocument:
    return make_three_dots_scene()
