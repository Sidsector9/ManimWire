"""The visual project document: the file the user edits. Code is derived from it."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

from engine.catalogue.model import PortType

# Literal port values as stored in the document. The catalogue parameter type
# decides how a value is written as Manim source.
JsonValue = str | int | float | bool | list[int | float] | None

# Port name for the object a method node is called on.
SELF_PORT = "self"


class MethodCall(BaseModel):
    """One step of an Animate chain: ``.method(**values)``."""

    method: str
    values: dict[str, JsonValue] = {}


class ConfigKey(BaseModel):
    """One entry of a Config node: the key and the type its value is written as."""

    name: str
    type: PortType = PortType.NUMBER


class Node(BaseModel):
    id: str
    catalogue: str
    values: dict[str, JsonValue] = {}
    label: str | None = None
    position: tuple[float, float] = (0.0, 0.0)
    collapsed: bool = True
    # Animate nodes only: the methods applied through mobject.animate, in order.
    chain: list[MethodCall] = []
    # Config nodes only: the keys of the dict, each a port.
    config: list[ConfigKey] = []
    # Map and Repeat children: the container this node runs inside.
    parent: str | None = None
    # Map and Repeat only: the frame size on the graph.
    size: tuple[float, float] | None = None


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


class UpdatingStep(BaseModel):
    """suspend_updating, resume_updating, or clear_updaters on live objects."""

    kind: Literal["updating"] = "updating"
    mobjects: list[str]
    action: Literal["suspend", "resume", "clear"] = "suspend"


class CameraStep(BaseModel):
    """ThreeDScene camera: ``set_camera_orientation``, or ``move_camera`` over time."""

    kind: Literal["camera"] = "camera"
    action: Literal["orient", "move"] = "orient"
    phi: float | None = None
    theta: float | None = None
    gamma: float | None = None
    zoom: float | None = None
    focal_distance: float | None = None
    run_time: float | None = None


class FixedInFrameStep(BaseModel):
    """``add_fixed_in_frame_mobjects`` or ``remove_fixed_in_frame_mobjects``."""

    kind: Literal["fixed_in_frame"] = "fixed_in_frame"
    mobjects: list[str]
    action: Literal["add", "remove"] = "add"


Step = Annotated[
    PlayStep
    | WaitStep
    | AddStep
    | RemoveStep
    | BringToFrontStep
    | BringToBackStep
    | SectionStep
    | SoundStep
    | SubcaptionStep
    | UpdatingStep
    | CameraStep
    | FixedInFrameStep,
    Field(discriminator="kind"),
]

CAMERA_METHODS = {"orient": "set_camera_orientation", "move": "move_camera"}
FIXED_IN_FRAME_METHODS = {
    "add": "add_fixed_in_frame_mobjects",
    "remove": "remove_fixed_in_frame_mobjects",
}
CAMERA_FIELDS = ("phi", "theta", "gamma", "zoom", "focal_distance")

UPDATING_METHODS = {
    "suspend": "suspend_updating",
    "resume": "resume_updating",
    "clear": "clear_updaters",
}

# Steps that name mobjects: (kind, Scene method).
MOBJECT_STEP_METHODS = {
    "add": "add",
    "remove": "remove",
    "bring_to_front": "bring_to_front",
    "bring_to_back": "bring_to_back",
}


SceneType = Literal["Scene", "MovingCameraScene", "ThreeDScene", "ZoomedScene"]
SCENE_TYPES: tuple[SceneType, ...] = (
    "Scene",
    "MovingCameraScene",
    "ThreeDScene",
    "ZoomedScene",
)
# Scene types whose camera has a movable frame mobject (self.camera.frame).
FRAME_SCENE_TYPES = {"MovingCameraScene", "ZoomedScene"}


class SceneDocument(BaseModel):
    name: str = "Scene1"
    scene_type: SceneType = "Scene"
    nodes: list[Node] = []
    edges: list[Edge] = []
    steps: list[Step] = []


class GroupDefinition(BaseModel):
    """A reusable subgraph. Input and Output nodes inside it are its ports."""

    name: str
    nodes: list[Node] = []
    edges: list[Edge] = []


# Catalogue name of a node that instantiates a group: "group:" + the group name.
GROUP_PREFIX = "group:"

ExportFormat = Literal["mp4", "mov", "webm", "gif", "png"]


class Settings(BaseModel):
    pixel_width: int = 1920
    pixel_height: int = 1080
    frame_rate: float = 60
    background_color: str = "BLACK"
    output_format: ExportFormat = "mp4"


class Document(BaseModel):
    version: Literal[1] = 1
    settings: Settings = Settings()
    scenes: list[SceneDocument] = [SceneDocument()]
    groups: list[GroupDefinition] = []
