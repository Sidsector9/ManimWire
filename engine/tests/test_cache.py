from pathlib import Path

from manim import tempconfig

from engine.catalogue import Catalogue
from engine.document import SceneDocument, Settings
from engine.render import RenderService
from engine.render.device import RenderDevice
from engine.render.frames import BinaryFrames


def test_clear_cache_releases_disk_and_preserves_user_files(
    tmp_path: Path, catalogue: Catalogue, simple_scene: SceneDocument
) -> None:
    media = tmp_path / "media"
    for folder in ("texts", "Tex", "videos", "images"):
        directory = media / folder
        directory.mkdir(parents=True)
        (directory / "asset").write_text(folder)
    project = tmp_path / "project.mnw"
    project.write_text("keep")
    # A linked cache entry must not delete the linked directory's contents.
    (media / "texts" / "linked").symlink_to(media / "images", target_is_directory=True)
    service = RenderService(tmp_path / "cache", RenderDevice(), binary=True)
    service.frames = BinaryFrames(service.cache_dir / "frames", memory_limit=0)
    frames = service.frames
    frames.put("old", b"1234", {})
    assert frames.disk_bytes == 4
    staging = service.cache_dir / "export-Scene"
    staging.mkdir()
    (staging / "partial.mp4").write_bytes(b"partial")
    settings = Settings(pixel_width=64, pixel_height=36, frame_rate=5)
    try:
        with tempconfig({"media_dir": str(media)}):
            assert service.clear_cache() == {"cleared": True}
            assert frames.spool.closed
            assert service.frames is None
            assert list(service.cache_dir.iterdir()) == []
            assert list((media / "texts").iterdir()) == []
            assert list((media / "Tex").iterdir()) == []
            assert (media / "videos" / "asset").read_text() == "videos"
            assert (media / "images" / "asset").read_text() == "images"
            assert project.read_text() == "keep"
            service.clear_cache()  # Clearing an empty cache is safe.
            frame = service.frame(simple_scene, catalogue, settings, 1)
            assert service.frames is not None
            assert service.frames.record(Path(frame.path).name) is not None
    finally:
        service.close()
