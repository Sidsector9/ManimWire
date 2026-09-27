from math import pi
from pathlib import Path

import av
import numpy as np
import pytest

from engine.catalogue import Catalogue
from engine.codegen import ManimCodeGenerator
from engine.document import AddStep, CameraStep, Node, SceneDocument, Settings, WaitStep
from engine.render import CairoRenderService
from engine.timeline import layout_timeline


def test_illusion_camera_rotates_then_stops(
    catalogue: Catalogue, tmp_path: Path
) -> None:
    # Keep the regression scene independent of examples, which users edit in the app.
    scene = SceneDocument(
        name="ThreeDCameraIllusionRotation",
        scene_type="ThreeDScene",
        nodes=[
            Node(id="axes", catalogue="ThreeDAxes"),
            Node(id="circle", catalogue="Circle"),
        ],
        steps=[
            CameraStep(action="orient", phi=75 * pi / 180, theta=30 * pi / 180),
            AddStep(mobjects=["circle", "axes"]),
            CameraStep(action="begin_illusion", rate=2),
            WaitStep(duration=pi / 2),
            CameraStep(action="stop_illusion"),
        ],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    assert "self.begin_3dillusion_camera_rotation(rate=2.0)" in generated.code
    assert "self.stop_3dillusion_camera_rotation()" in generated.code
    layout = layout_timeline(scene, catalogue)
    assert layout.error is None
    assert layout.total == pytest.approx(pi / 2)
    assert [marker.label for marker in layout.markers if marker.kind == "camera"] == [
        "camera orientation",
        "begin illusion rotation",
        "stop illusion rotation",
    ]
    # Extend only the test scene to verify the stop action holds the final view.
    scene.steps.append(WaitStep(duration=0.5))
    result = CairoRenderService(tmp_path / "cache").export(
        scene,
        catalogue,
        Settings(pixel_width=256, pixel_height=144, frame_rate=15),
        tmp_path / "video",
    )
    with av.open(result.path) as movie:
        frames = [frame.to_ndarray(format="rgb24") for frame in movie.decode(video=0)]
    assert len(frames) >= 30
    assert np.mean(np.abs(frames[0].astype(float) - frames[12])) > 1
    assert np.mean(np.abs(frames[-1].astype(float) - frames[-4])) < 0.1


def test_camera_action_parameters_and_scene_type(catalogue: Catalogue) -> None:
    scene = SceneDocument(
        scene_type="ThreeDScene",
        steps=[
            CameraStep(action="begin_illusion", phi=1, run_time=2),
            CameraStep(action="stop_illusion", rate=3, theta=1),
        ],
    )
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert generated.issues == []
    # Switching actions in the Inspector must not forward stale orientation fields.
    assert "self.begin_3dillusion_camera_rotation()" in generated.code
    assert "self.stop_3dillusion_camera_rotation()" in generated.code
    scene.scene_type = "Scene"
    assert [
        issue.code for issue in ManimCodeGenerator().generate(scene, catalogue).issues
    ] == ["bad_scene_type", "bad_scene_type"]
