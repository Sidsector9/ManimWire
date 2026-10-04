# Desktop installers

Run from `app/` after `pnpm install`:

```sh
# On macOS (Apple Silicon or Intel)
pnpm installer:mac

# On Windows x64
pnpm installer:win

# On Linux x64
pnpm installer:linux
```

Artifacts are written to `app/release/`:

- `ManimWire-<version>-mac-<arch>.pkg`: the standard macOS Installer installs the application in `/Applications`. macOS can request administrator authorization; this is not a literal single-click installation.
- `ManimWire-<version>-windows-x64-setup.exe`: a one-click, per-user NSIS installer, with shortcuts and launch after installation.
- `ManimWire-<version>-linux-x64.AppImage`: a portable Linux application. Mark the downloaded file executable before launching it; the host needs desktop libraries and AppImage/FUSE support.

## Manual GitHub Actions builds

After `.github/workflows/build-app.yml` is on the default branch, open **Actions → Build ManimWire → Run workflow**, select a branch and `macos`, `windows`, or `linux`, then run it. The job uses a native hosted runner: macOS ARM64, Windows x64, or Linux x64. It installs build dependencies, checks the application, builds the installer, and uploads it as a downloadable ZIP artifact. Download it from the build step's link or the run's **Artifacts** section while the cleanup job is waiting.

GitHub's native artifact retention has a [minimum of one day](https://github.com/actions/upload-artifact#retention-period). A separate Linux cleanup job waits until one hour after the artifact's creation and deletes only that artifact through the API. This occupies a runner for about an hour and may consume billable Actions minutes. The workflow remains running during that wait. Queue delays can delay deletion; cancellation or cleanup failure leaves the one-day retention as a fallback. This is automatic deletion, not a native guaranteed one-hour expiry.

The workflow builds unsigned/ad-hoc-signed test installers; it does not publish releases or use signing secrets. Windows and Linux packages require testing on their target OS before distribution.

Users do not install Python, Node, uv, Manim, Pango, Cairo, Typst, or FFmpeg. The installers contain Electron and a frozen Python engine with these dependencies. ManimWire does not download dependencies on first launch.

## Optional LaTeX installation

LaTeX is **not bundled**. Shapes, plain Text, and non-LaTeX animations work without it. Tex, MathTex, and other LaTeX-backed objects (including some numeric labels) need a separate installation:

- macOS: install [MacTeX](https://tug.org/mactex/mactex-download.html).
- Windows: install [MiKTeX](https://miktex.org/howto/install-miktex), or an existing TeX Live installation can be used.

Both `latex` and `dvisvgm` must be available. MiKTeX may require additional packages for the selected template; manage these through MiKTeX Console. Restart ManimWire after installation and check the LaTeX indicator in the status bar. Custom templates and fonts may need additional packages or fonts.

ManimWire preserves the system PATH and checks the standard MacTeX and MiKTeX binary locations, including when launched from the macOS Finder. For a custom installation, add its binary directory to the system/user PATH before launching the app. ManimWire does not modify the system LaTeX installation or its cache settings.

## Build machine

The developer/build runner needs Node.js, pnpm, uv, and the build prerequisites for the existing Python workspace. The commands run `uv sync --frozen --group packaging` automatically. On macOS, building Python native packages may require Xcode command-line tools and Pango/Cairo (`brew install pkg-config cairo pango`). On Ubuntu, install `build-essential pkg-config libcairo2-dev libpango1.0-dev libegl1 libgl1-mesa-dri fonts-dejavu-core`. Build on the target OS and architecture: Windows/Linux x64, Apple Silicon macOS arm64, or Intel macOS x64. The Node and Python architectures must match.

Initialize the Manim submodule over HTTPS before building a fresh checkout:

```sh
git -c submodule.manim.url=https://github.com/ManimCommunity/manim.git submodule update --init
```

The first build needs internet access. Python and JavaScript dependencies are locked. The runtime staging directory is rebuilt each time, removing any LaTeX files left by older builds. No TeX download or installation runs during packaging. The build stops if any command or the bundled-runtime smoke check fails.

## Verification

Before Electron packaging, the frozen engine runs from a temporary working directory with development Python variables removed and only bundled tools plus the OS tools on PATH. It checks catalogue discovery, ordinary text, Typst, and a small MP4 export without requiring LaTeX. The packaged application uses `process.resourcesPath/runtime`, with its working directory under Electron's writable user-data directory.

The frozen `manimwire-engine` executable also accepts `--self-test-tex` for an additional MathTex check when system `latex` and `dvisvgm` are on PATH.

Test each release on a clean machine of its target OS/architecture, including launch, preview, export, and uninstall. Local build checks do not replace clean-machine installation tests, especially for native libraries and font rendering.

## Signing and public distribution

Set a release version in `app/package.json` before publishing. These commands build locally and never publish artifacts.

For normal public macOS distribution, configure electron-builder's Developer ID Application signing/notarization credentials and Developer ID Installer certificate for the PKG. Windows releases should use a code-signing certificate to identify the publisher. The build disables automatic certificate discovery unless `CSC_LINK`, `CSC_NAME`, or `CSC_IDENTITY_AUTO_DISCOVERY` is explicitly configured. Without release signing, OS trust checks can warn or block installation. Signing credentials are not included in this repository.

See the official [macOS packaging](https://www.electron.build/v26/docs/mac/) and [Windows NSIS](https://www.electron.build/v26/docs/nsis/) documentation for signing configuration. Retain the bundled dependency licenses when distributing installers.
