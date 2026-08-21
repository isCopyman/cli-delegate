# cli-delegate

[![linux.do](https://shorturl.at/ggSqS)](https://linux.do)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Host-neutral Agent Skill: from **Claude Code**, **Codex**, **Grok Build**, or **Cursor**, spawn any of the other three as a child CLI, then **resume the same child session**.

This is the cheap substitute for a same-vendor subagent. Claude Code subagents burn the Claude bill; here you keep Claude as the orchestrator and send the work to Grok or Cursor on **their** subscription.

中文说明：[README.zh-CN.md](./README.zh-CN.md)

## Why

Coding CLIs already know how to continue a thread (`grok -r`, `claude -r`, `cursor-agent --resume`, `codex exec resume`). Official bridges (Grok’s Claude plugin, Cursor-in-Claude plugins) only work **inside Claude Code**, one child at a time.

`cli-delegate` is one script + `SKILL.md`. It is **not** a team bus (use Orca / Herdr for that).

- Same `run` / `resume` from any host
- Long jobs: host background shell. Cancel by stopping that shell.
- `--worktree-name`: a parallel checkout of the same repo for work you will resume
- Unified `--effort` mapped per CLI

## Requirements

- Node.js >= 18.18
- At least one backend on `PATH`: `grok`, `cursor-agent`, `claude`, `codex`

Windows: Cursor is usually `%LOCALAPPDATA%\cursor-agent\agent.cmd`. Use `cursor-agent`, never bare `agent` (Grok ships `agent.exe` too).

Not published to npm. Hosts load a **skill folder**; `npx` will not install it into `~/.claude/skills`.

## Install

Start a **new** host session after install. Old sessions may keep a stale script path.

### 1. skillshare (recommended)

```bash
skillshare install isCopyman/cli-delegate -s cli-delegate
skillshare sync
```

Copies into Claude / Codex / Grok / Cursor / `~/.agents` according to your skillshare targets.

Later updates from a clone:

```bash
git pull
pwsh -File .\sync-skill.ps1
skillshare sync -g --force
```

Do **not** `Copy-Item -Recurse scripts dest\scripts` while `dest\scripts` already exists — PowerShell nests `scripts\scripts` and the documented entry stays on the old file.

### 2. git clone + junction / symlink

```powershell
git clone https://github.com/isCopyman/cli-delegate.git
cd cli-delegate
pwsh -File .\install.ps1
```

PowerShell 7. Junctions `skills/cli-delegate` into whichever of these already exist: `~/.claude/skills`, `~/.codex/skills`, `~/.grok/skills`, `~/.agents/skills`.

macOS / Linux:

```bash
git clone https://github.com/isCopyman/cli-delegate.git
SRC="$PWD/cli-delegate/skills/cli-delegate"
for h in "$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.grok/skills" "$HOME/.agents/skills"; do
  [ -d "$(dirname "$h")" ] || continue
  mkdir -p "$h"
  rm -rf "$h/cli-delegate"
  ln -s "$SRC" "$h/cli-delegate"
done
```

The entry is always `scripts/cli-delegate.mjs` next to `SKILL.md`, never `scripts/scripts/`.

### 3. Check it

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs which --cli grok
```

`ready: true` means that CLI is on PATH. Open a **new** Claude / Codex / Grok session and ask it to delegate with cli-delegate. It should call that script with an **absolute path**.

## Usage

For host agents. Follow `SKILL.md`. Stdout is JSON.

Use absolute paths. Git Bash: forward slashes (`C:/Users/.../cli-delegate.mjs`).

### Probe

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs which --cli grok
node .\skills\cli-delegate\scripts\cli-delegate.mjs models --cli grok
```

Omit `--model` unless you already have an id. `models --cli` only wraps a vendor list command (`grok models`, `cursor-agent models`, `codex debug models` slugs). Claude has none — the child uses its own default.

### New thread

Put the brief in a file (no `$(cat …)`):

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs run --cli grok --cwd $PWD --read-only --prompt-file .\brief.md
```

Save `sessionId` and `jobId`. If this cwd already has more than one grok session, the next continue **must** pass `--resume <sessionId>`.

### Background

Put `run` in the host's background shell. The host pings you when the script exits. To cancel, stop that shell — the child CLI dies with it.

`--worktree-name ui` is a persistent parallel checkout. Do not delete it if you will `resume`. A new `run` (not `resume`) fast-forwards a **clean** lane with no unique commits. `resume` never fast-forwards.

One-shot isolation: `--worktree`. Review of the current tree: `--read-only`, no `--worktree`.

### Resume

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs resume --cli grok --cwd $PWD --resume <sessionId> --worktree-name ui --prompt-file .\followup.md
```

Bare `resume`: one recorded session → that id; none → vendor `--continue`; two or more → error with `candidates`. `--resume-last` is the explicit newest.

### Optional schema

`--schema schema.json` → Grok/Claude `--json-schema`, Codex `--output-schema`. Cursor has none — put the shape in the brief.

### Flags

| Flag | Meaning |
|---|---|
| `--prompt-file` | Task brief from a file. `--file` is extract-only. |
| `--schema` | JSON Schema file |
| `--worktree` | New extra checkout |
| `--worktree-name` | Named lane (implies `--worktree`) |
| `--read-only` | Plan/review, no edits |
| `--resume <id>` | Continue that session |
| `--resume-last` | Newest session even if several exist |
| `--effort` | `low\|medium\|high\|xhigh\|max` mapped per CLI |
| `-- …` | Extra argv forwarded to the child |

State: `%LOCALAPPDATA%\cli-delegate` on Windows, `~/.local/share/cli-delegate` elsewhere (`CLI_DELEGATE_HOME`).

When the lane is merged and you will not resume that `sessionId`, the host runs `git worktree remove` on `worktreePath`, then `git worktree prune`.

## Tests

```powershell
npm test
```

Zero runtime dependencies. Tests do not call live models.

## vs official plugins

| | cli-delegate | Official Grok CC plugin | Cursor-in-Claude plugins |
|---|---|---|---|
| Hosts | Claude / Codex / Grok / Cursor | Claude Code only | Claude Code only |
| Child | grok, cursor-agent, claude, codex | grok only | cursor-agent only |
| Resume | per cwd+cli | `grok -r` + jobs | `cursor-agent --resume` |
| Background | host background shell; stop that shell | `/grok-build:stop` | `/cursor:cancel` |

## License

MIT. See [LICENSE](./LICENSE).

## Acknowledgements

Thanks to the [LINUX DO](https://linux.do) community.
