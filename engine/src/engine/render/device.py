"""Probe the actual Python OpenGL driver, isolated from the RPC process."""

from __future__ import annotations

import json
import subprocess
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel


class RenderDevice(BaseModel):
    renderer: Literal["opengl", "cairo"] = "cairo"
    acceleration: Literal["hardware", "software", "unknown"] = "software"
    device: str = "CPU"
    vendor: str = ""
    version: str = ""
    backend: str | None = None
    reason: str | None = None


def acceleration_for(
    vendor: str, device: str
) -> Literal["hardware", "software", "unknown"]:
    name = f"{vendor} {device}".lower()
    if any(
        word in name
        for word in (
            "llvmpipe",
            "softpipe",
            "swrast",
            "swiftshader",
            "software",
            "gdi generic",
            "lavapipe",
        )
    ):
        return "software"
    if any(
        word in name
        for word in (
            "apple",
            "nvidia",
            "intel",
            "amd",
            "ati ",
            "radeon",
            "adreno",
            "mali",
            "broadcom",
        )
    ):
        return "hardware"
    # Virtual/remote and unfamiliar drivers cannot be classified by name alone.
    return "unknown"


@lru_cache(maxsize=1)
def detect_device() -> RenderDevice:
    candidates: list[RenderDevice] = []
    errors: list[str] = []
    for backend in ("default", "egl"):
        try:
            result = subprocess.run(
                [sys.executable, str(Path(__file__).resolve()), backend],
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            info = json.loads(result.stdout)
            candidate = RenderDevice(
                renderer="opengl",
                vendor=info["GL_VENDOR"],
                device=info["GL_RENDERER"],
                version=info["GL_VERSION"],
                acceleration=acceleration_for(info["GL_VENDOR"], info["GL_RENDERER"]),
                backend=None if backend == "default" else backend,
            )
            if candidate.acceleration == "hardware":
                return candidate
            candidates.append(candidate)
        except (subprocess.SubprocessError, ValueError, KeyError, OSError) as exc:
            detail = (
                (exc.stderr or "").strip()
                if isinstance(exc, subprocess.CalledProcessError)
                else str(exc)
            )
            errors.append(f"{backend}: {detail[-500:] or 'OpenGL probe failed'}")
    if candidates:
        return candidates[0]
    return RenderDevice(reason="OpenGL unavailable. " + "; ".join(errors))


def probe(backend: str) -> None:
    import moderngl

    kwargs: dict[str, Any] = {} if backend == "default" else {"backend": backend}
    ctx = moderngl.create_context(standalone=True, require=330, **kwargs)
    try:
        # Exercise shaders, rasterization and readback, not just context creation.
        program = ctx.program(
            vertex_shader="""#version 330
            void main() {
                vec2 p[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
                gl_Position = vec4(p[gl_VertexID], 0, 1);
            }""",
            fragment_shader="""#version 330
            out vec4 color;
            void main() { color = vec4(1,0,0,1); }""",
        )
        fbo = ctx.simple_framebuffer((4, 4))
        fbo.use()
        ctx.vertex_array(program, []).render(vertices=3)
        if fbo.read(components=3) != bytes([255, 0, 0]) * 16:
            raise RuntimeError("OpenGL rendering/readback check failed")
        print(
            json.dumps(
                {k: ctx.info[k] for k in ("GL_VENDOR", "GL_RENDERER", "GL_VERSION")}
            )
        )
    finally:
        ctx.release()


if __name__ == "__main__":
    probe(sys.argv[1])
