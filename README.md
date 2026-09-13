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

## Getting started

You need:

| Requirement | Why |
|---|---|
| Python 3.12 or newer | Runs the engine and Manim |
| [uv](https://docs.astral.sh/uv/) | Installs the Python workspace |
| Node.js 20.19 or newer, with pnpm | Builds and runs the desktop application |
| A LaTeX installation | Only for MathTex and Tex. Everything else works without it |

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

### Node editor

<img width="100%" height="505" alt="Image" src="https://github.com/user-attachments/assets/40c8ca01-6b0b-4916-8e6b-2a74e5e7e5b4" />

## Licensing

The code in this repository is the Apache License 2.0 with the Commons Clause
condition, in `LICENSE`. You may use it, fork it, change it and pass it on. You may not
sell it, and you may not charge for hosting it or for support whose value comes from the
application itself. Everything you make with it is yours, including work you sell.

A fork or a redistribution has to carry the credit in `NOTICE`, in its own notice file,
its documentation, or somewhere a person can see it in the application. It also has to
say which files it changed, and it cannot use the name ManimWire for itself.

Manim Community Edition is included as a git submodule and keeps its own MIT licence, in
`manim/LICENSE`. A packaged build carries other libraries under their own licences, and
the Commons Clause condition takes none of those rights away.
