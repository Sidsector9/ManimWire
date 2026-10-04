"""Build the bundled runtime on the target OS. LaTeX is an optional system dependency."""

import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from importlib.metadata import distribution
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build" / "installer"
RUNTIME = BUILD / "runtime"


def run(args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def write_font_config():
    font_dirs = (
        ["WINDOWSFONTDIR", "~/AppData/Local/Microsoft/Windows/Fonts"]
        if sys.platform == "win32"
        else ["/System/Library/Fonts", "/Library/Fonts", "~/Library/Fonts"]
        if sys.platform == "darwin"
        else [
            "/usr/share/fonts",
            "/usr/local/share/fonts",
            "~/.local/share/fonts",
            "~/.fonts",
        ]
    )
    (RUNTIME / "fonts.conf").write_text(
        '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>'
        + "".join(f"<dir>{folder}</dir>" for folder in font_dirs)
        + '<cachedir prefix="xdg">fontconfig</cachedir></fontconfig>',
        encoding="utf-8",
    )


def main():
    if sys.platform not in ("darwin", "win32", "linux"):
        raise SystemExit("Build on macOS, Windows, or Linux.")
    arch = {"arm64": "arm64", "aarch64": "arm64", "amd64": "x64", "x86_64": "x64"}.get(
        platform.machine().lower()
    )
    if len(sys.argv) > 1 and sys.argv[1] != arch:
        raise SystemExit(
            "Python and Node architectures must match. Use native tools for the target architecture."
        )
    if sys.platform in ("win32", "linux") and platform.machine().lower() not in (
        "amd64",
        "x86_64",
    ):
        raise SystemExit("Windows and Linux builds currently require x64.")
    BUILD.mkdir(parents=True, exist_ok=True)
    if RUNTIME.exists():
        shutil.rmtree(RUNTIME)
    RUNTIME.mkdir()
    write_font_config()
    args = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--name",
        "manimwire-engine",
        "--distpath",
        BUILD / "frozen",
        "--workpath",
        BUILD / "pyinstaller",
        "--specpath",
        BUILD,
        "--recursive-copy-metadata",
        "engine",
        "--collect-all",
        "engine",
        "--collect-all",
        "manim",
        "--collect-all",
        "typst",
        "--collect-all",
        "manimpango",
        "--collect-all",
        "glcontext",
        ROOT / "packaging" / "engine_entry.py",
    ]
    run(args, cwd=ROOT)
    shutil.copytree(
        BUILD / "frozen" / "manimwire-engine", RUNTIME / "engine", symlinks=True
    )
    # FFmpeg is bundled for audio helpers; video encoding itself uses bundled PyAV.
    import imageio_ffmpeg

    tools = RUNTIME / "tools"
    tools.mkdir()
    shutil.copy2(
        imageio_ffmpeg.get_ffmpeg_exe(),
        tools / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"),
    )
    notices = RUNTIME / "licenses"
    notices.mkdir()
    for name in ("imageio-ffmpeg", "typst"):
        package = distribution(name)
        for file in package.files or []:
            if "license" in str(file).lower() or str(file).endswith(
                "binaries/README.md"
            ):
                shutil.copy2(
                    package.locate_file(file), notices / f"{name}-{Path(file).name}"
                )
    env = {
        key: value
        for key, value in os.environ.items()
        if key.upper() not in ("PATH", "PYTHONHOME", "PYTHONPATH")
    }
    # Do not let developer-installed TeX/Python hide missing bundled dependencies.
    system_path = (
        str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32")
        if sys.platform == "win32"
        else "/usr/bin:/bin"
    )
    env["PATH"] = os.pathsep.join([str(tools), system_path])
    env["FONTCONFIG_FILE"] = str(RUNTIME / "fonts.conf")
    with tempfile.TemporaryDirectory(prefix="manimwire smoke ") as directory:
        executable = (
            RUNTIME
            / "engine"
            / (
                "manimwire-engine.exe"
                if sys.platform == "win32"
                else "manimwire-engine"
            )
        )
        run([executable, "--self-test"], env=env, cwd=directory, timeout=600)
        # Exercise the same entry point and pipe lifetime as Electron, not only
        # imports/rendering. communicate closes stdin after sending the request.
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}).encode()
        result = subprocess.run(
            [str(executable), "--stdio"],
            input=f"Content-Length: {len(body)}\r\n\r\n".encode() + body,
            capture_output=True,
            env=env,
            cwd=directory,
            timeout=180,
            check=True,
        )
        import io

        from engine.rpc import read_message

        assert read_message(io.BytesIO(result.stdout)) == {
            "jsonrpc": "2.0",
            "id": 1,
            "result": "pong",
        }, result.stderr.decode(errors="replace")
        print("Bundled engine RPC handshake and EOF shutdown passed.", flush=True)


if __name__ == "__main__":
    main()
