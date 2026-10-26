# FD CODE

This repository now ships the current **FD CODE** app, based on the newer Alpha codebase, with General chat, local Laya routing, Brain continuity and ARTsie integration.

## Download

| Platform | Installer |
| --- | --- |
| macOS, Apple Silicon | [FD-CODE-macOS-arm64.dmg](https://github.com/faheemdehalvi/fd-code/releases/latest/download/FD-CODE-macOS-arm64.dmg) |
| Windows x64 | [FD-CODE-Windows-x64.exe](https://github.com/faheemdehalvi/fd-code/releases/latest/download/FD-CODE-Windows-x64.exe) |

Each installer has a `.sha256` file next to it on the [release page](https://github.com/faheemdehalvi/fd-code/releases/latest). Neither build is notarised or code-signed by a publisher, so macOS and Windows warn on first launch. See [Installation](docs/user/fd-code.md) for how to allow it.

## Add-ons

The app runs without any of these. Install only the ones you want.

| Add-on | What it adds | macOS / Linux | Windows (PowerShell) |
| --- | --- | --- | --- |
| Laya | Local routing for General chat | `curl -fsSL https://raw.githubusercontent.com/faheemdehalvi/fd-code/t3-beta/scripts/laya-setup.mjs -o laya-setup.mjs && node laya-setup.mjs` | `iwr https://raw.githubusercontent.com/faheemdehalvi/fd-code/t3-beta/scripts/laya-setup.mjs -OutFile laya-setup.mjs; node laya-setup.mjs --python python` |
| RAG skill | Agents search your document knowledge bases | `git clone https://github.com/faheemdehalvi/rag-skill.git ~/.claude/skills/rag && ~/.claude/skills/rag/scripts/setup.sh` | Use WSL and the macOS / Linux command |
| Graphify skill | Agents query a repository as a knowledge graph | `uv tool install graphifyy && graphify install` | `uv tool install graphifyy; graphify install` |
| ARTsie editors | ArtCraft creative apps with a shared MCP gateway (macOS only) | `git clone https://github.com/faheemdehalvi/artsie.git ARTsie && cd ARTsie && ./setup.sh --apps soundcraft` | Not available |

Laya needs Node and Python 3.11. Graphify needs [uv](https://docs.astral.sh/uv/).

**ARTsie: choose your editors.** Replace `soundcraft` with any of the ids below, as many as you want. `./setup.sh --apps photocraft effectcraft` installs those two and nothing else; `--all` installs the full suite (about 6 GB). Run it again later with more ids to add editors.

| Editor | id | Editor | id |
| --- | --- | --- | --- |
| PhotoCraft | `photocraft` | SoundCraft (audio) | `soundcraft` |
| EffectCraft | `effectcraft` | FilmCraft | `filmcraft` |
| VectorCraft | `vectorcraft` | LightCraft | `lightcraft` |
| DesignCraft | `designcraft` | FigCraft | `figcraft` |
| PdfCraft | `pdfcraft` | WordCraft | `wordcraft` |
| DeckCraft | `deckcraft` | GridCraft | `gridcraft` |
| CADCraft | `cadcraft` | ArtCraft Launcher | `craft-launcher` |

`/rag` and `/graphify` inside a chat are built into the app and need no add-on. Brain session continuity is also built in; the separate Brain knowledge desk is not distributed.

## More

- [Installation, General chat and Laya](docs/user/fd-code.md)

The older Beta implementation remains in Git history. Upstream T3 Code documentation follows below; upstream downloads are not this customised build.

---

# T3 Code

This is Faheem's Alpha source fork of [T3 Code](https://github.com/pingdotgg/t3code), with native
local Brain continuity, mid-session model switching, and `/rag` / `/graphify` context retrieval.
See [Brain and provider handoffs](docs/user/portable-handoffs.md#local-brain-context-in-this-fork)
for usage and local prerequisites. Use the [development setup](docs/operations/development.md)
to build this source; the upstream installers below install the official release.

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, T3 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Command line

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

Then run `t3` to start the server and open the local web app. `t3 service install` keeps it running in the background, `t3 update` moves to a newer release, and `t3 --help` has the full reference.

To try it once without installing, run `npx fd-code@latest` instead.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.FDCode
```

#### Windows (`scoop`)

```bash
scoop install extras/t3code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Debian, Ubuntu (`.deb`)

Download the `.deb` from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), then:

```bash
sudo apt install ./T3-Code-*.deb
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S fd-code-bin
```

Nightly:

```bash
yay -S fd-code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
