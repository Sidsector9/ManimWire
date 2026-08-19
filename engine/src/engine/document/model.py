"""The visual project document: the file the user edits. Code is derived from it."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

# Literal port values as stored in the document. The catalogue parameter type
# decides how a value is written as Manim source.
JsonValue = str | float | int | bool | list[float] | None

# Port name for the object a method node is called on.
SELF_PORT = "self"


class Node(BaseModel):
    id: str
    catalogue: str
    values: dict[str, JsonValue] = {}
    label: str | None = None
    position: tuple[float, float] = (0.0, 0.0)
    collapsed: bool = True


class Edge(BaseModel):
    source: str
    target: str
    port: str
    live: bool = False


class PlayStep(BaseModel):
    """``self.play(...)``. Keyword values apply to every animation, as in Manim."""

    kind: Literal["play"] = "play"
    animations: list[str]
    run_time: float | None = None
    rate_func: str | None = None
    lag_ratio: float | None = None
    subcaption: str | None = None
    subcaption_duration: float | None = None
    subcaption_offset: float = 0


class WaitStep(BaseModel):
    kind: Literal["wait"] = "wait"
    duration: float = 1.0


class AddStep(BaseModel):
    kind: Literal["add"] = "add"
    mobjects: list[str]


class RemoveStep(BaseModel):
    kind: Literal["remove"] = "remove"
    mobjects: list[str]


class BringToFrontStep(BaseModel):
    kind: Literal["bring_to_front"] = "bring_to_front"
    mobjects: list[str]


class BringToBackStep(BaseModel):
    kind: Literal["bring_to_back"] = "bring_to_back"
    mobjects: list[str]


class SectionStep(BaseModel):
    kind: Literal["section"] = "section"
    name: str = "unnamed"
    skip_animations: bool = False


class SoundStep(BaseModel):
    kind: Literal["sound"] = "sound"
    file: str
    time_offset: float = 0
    gain: float | None = None


class SubcaptionStep(BaseModel):
    kind: Literal["subcaption"] = "subcaption"
    content: str
    duration: float = 1
    offset: float = 0


Step = Annotated[
    PlayStep
    | WaitStep
    | AddStep
    | RemoveStep
    | BringToFrontStep
    | BringToBackStep
    | SectionStep
    | SoundStep
    | SubcaptionStep,
    Field(discriminator="kind"),
]

# Steps that name mobjects: (kind, Scene method).
MOBJECT_STEP_METHODS = {
    "add": "add",
    "remove": "remove",
    "bring_to_front": "bring_to_front",
    "bring_to_back": "bring_to_back",
}


class SceneDocument(BaseModel):
    name: str = "Scene1"
    nodes: list[Node] = []
    edges: list[Edge] = []
    steps: list[Step] = []


class Settings(BaseModel):
    pixel_width: int = 1920
    pixel_height: int = 1080
    frame_rate: float = 60
    background_color: str = "BLACK"


class Document(BaseModel):
    version: Literal[1] = 1
    settings: Settings = Settings()
    scenes: list[SceneDocument] = [SceneDocument()]
