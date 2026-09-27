from math import pi
from pathlib import Path

import pytest
from PIL import Image

from engine.camera_angles import angle_source
from engine.catalogue import Catalogue
from engine.codegen import ManimCodeGenerator
from engine.document import AddStep, CameraStep, Node, SceneDocument, Settings, WaitStep
from engine.render import CairoRenderService


@pytest.mark.parametrize("action", ["orient", "move"])
def test_angle_expressions_render_like_numeric_angles(
    action: str, catalogue: Catalogue, tmp_path: Path
) -> None:
    scene = SceneDocument(
        name="AngleExpressions",
        scene_type="ThreeDScene",
        nodes=[Node(id="circle", catalogue="Circle")],
        steps=[
            AddStep(mobjects=["circle"]),
            CameraStep.model_validate(
                {
                    "action": action,
                    "phi": "75 * DEGREES",
                    "theta": "30 * DEGREES",
                    "gamma": "PI / 12",
                }
            ),
            WaitStep(duration=1),
        ],
    )
    restored = SceneDocument.model_validate_json(scene.model_dump_json())
    assert restored == scene
    generated = ManimCodeGenerator().generate(restored, catalogue)
    assert generated.issues == []
    assert "phi=75 * DEGREES, theta=30 * DEGREES, gamma=PI / 12" in generated.code
    service = CairoRenderService(tmp_path)
    settings = Settings(pixel_width=256, pixel_height=144, frame_rate=15)
    expression_frame = service.frame(restored, catalogue, settings, 0.5)
    scene.steps[1] = CameraStep.model_validate(
        {
            "action": action,
            "phi": 75 * pi / 180,
            "theta": 30 * pi / 180,
            "gamma": pi / 12,
        }
    )
    numeric_frame = service.frame(scene, catalogue, settings, 0.5)
    with (
        Image.open(expression_frame.path) as expression,
        Image.open(numeric_frame.path) as numeric,
    ):
        assert expression.tobytes() == numeric.tobytes()


@pytest.mark.parametrize(
    "text",
    [
        "75 *",
        "unknown * DEGREES",
        "1 / 0",
        "1e309",
        "True",
        "self.camera",
        "__import__('os')",
        "[75]",
        "PI < 2",
    ],
)
def test_invalid_angles_are_reported_before_codegen(
    text: str, catalogue: Catalogue
) -> None:
    scene = SceneDocument(scene_type="ThreeDScene", steps=[CameraStep(phi=text)])
    generated = ManimCodeGenerator().generate(scene, catalogue)
    assert [(issue.code, issue.step, issue.port) for issue in generated.issues] == [
        ("bad_step", 0, "phi")
    ]
    assert generated.code == ""


def test_angle_constants_and_parentheses() -> None:
    assert angle_source(" -(TAU / 4) + 75 * DEGREES ") == "-(TAU / 4) + 75 * DEGREES"
    assert angle_source(0.5) == "0.5"
