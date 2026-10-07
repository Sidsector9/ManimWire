<p align="center">
  <img width="600" height="200" alt="Image" src="https://github.com/user-attachments/assets/b990c7d3-4b8a-40df-b57e-095881d4cad9" />
</p>

<p align="center">
  A desktop visual programming environment for Manim Community Edition.<br>
  Build mathematical animations by connecting nodes.
</p>

<p align="center">
  <img alt="Manim CE 0.21.0" src="https://img.shields.io/badge/Manim%20CE-0.21.0-blue">
  <img alt="Python 3.12" src="https://img.shields.io/badge/Python-3.12-blue">
  <img alt="Electron and React 19" src="https://img.shields.io/badge/Electron-React%2019-blue">
  <img alt="Platforms" src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
</p>

---

## What this is

[Manim Community Edition](https://www.manim.community) is the Python library used to
animate mathematics. It is powerful and it is code only, so everyone who wants to use
it has to learn Python first.

ManimWire is a desktop application that puts a visual editor in front of it. You place
nodes on a canvas, connect their ports, edit values in an inspector, and arrange the
animation on a timeline. The application turns that graph into real Manim Python and
Manim renders it.

<a href="https://www.youtube.com/watch?v=xPkTGdgsYRM&t=18s" target="_blank">
  <img width="1672" height="941" alt="Watch the ManimWire demo on YouTube" src="https://github.com/user-attachments/assets/38085f74-2aaf-4b76-a453-45b2e85ecf58" />
</a>

## Download

- [Download for macOS](https://shiftabit.com/wp-content/uploads/2026/10/ManimWire-macos.zip)
  - SHA-256: `a014d5202209b4cfe1533e09424f4ac8c5ee910c60e8f8ae4f5523f943ca1bea`
- [Download for Windows](https://shiftabit.com/wp-content/uploads/2026/10/ManimWire-windows.zip)
  - SHA-256: `e0884d17c48698f6b2e33845c71c9235baa778ee2643b86118ee47fb4ab1bb1d`

The installers bundle Python, Manim, and the required runtime dependencies. LaTeX is installed separately if you need LaTeX-backed text or equations such as `Tex` and `MathTex`.

## Getting started

You need:

| Requirement | Why |
|---|---|
| Python 3.12 or newer | Runs the engine and Manim |
| [uv](https://docs.astral.sh/uv/) | Installs the Python workspace |
| Node.js 20.19 or newer, with pnpm | Builds and runs the desktop application |
| A LaTeX installation | Optional; needed for LaTeX-backed objects such as MathTex, Tex, and some numeric labels |

Then:

```bash
# Manim CE is a git submodule, so clone with it
git clone --recurse-submodules <repository-url> manim-node-workflow
cd manim-node-workflow

# Install the Python workspace, which includes the vendored Manim
uv sync

# Install and start the desktop application
cd app
pnpm install
pnpm dev
```

<img width="1728" height="1084" alt="Image" src="https://github.com/user-attachments/assets/91bb9ddb-4397-4dda-8b8c-8bf3b8de0091" />

The application starts the Python engine itself from the `.venv` that `uv sync` created.
The status bar at the bottom of the window shows the engine state, the Manim version, the
Python version and whether LaTeX was found.

Open any file from `examples/` to see a finished project.

For LaTeX on macOS, `brew install --cask mactex-no-gui` installs the full distribution.

### Build desktop installers

From `app/`, run `pnpm installer:mac` on macOS, `pnpm installer:win` on Windows x64, or `pnpm installer:linux` on Linux x64. You can also use **Actions → Build ManimWire → Run workflow** on GitHub to select an OS and download an installer ZIP.
The installers bundle the Python engine, Manim, and native dependencies. LaTeX is optional and installed separately: [MacTeX for macOS](https://tug.org/mactex/mactex-download.html) or [MiKTeX for Windows](https://miktex.org/howto/install-miktex). Restart ManimWire after installing LaTeX and `dvisvgm`.
See [installer build and signing instructions](packaging/README.md) for prerequisites, output files, and release validation.

### Node editor

<img width="100%" height="505" alt="Image" src="https://github.com/user-attachments/assets/40c8ca01-6b0b-4916-8e6b-2a74e5e7e5b4" />
