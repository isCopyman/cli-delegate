# cli-delegate

[![linux.do](https://shorturl.at/ggSqS)](https://linux.do)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Host-neutral Agent Skill: from **Claude Code**, **Codex**, **Grok Build**, or **Cursor**, spawn any of the other three as a child CLI, then **resume the same child session**.

This is the cheap substitute for a same-vendor subagent. Claude Code subagents burn the Claude bill; here you keep Claude as the orchestrator and send the work to Grok or Cursor on **their** subscription.

中文说明：[README.zh-CN.md](./README.zh-CN.md)

## Why

Coding CLIs already know how to continue a thread (`grok -r`, `claude -r`, `cursor-agent --resume`, `codex exec resume`). Official bridges (Grok’s Claude plugin, Cursor-in-Claude plugins) only work **inside Claude Code**, one child at a time.

`cli-delegate` is one script + `SKILL.md`:

- Same `run` / `resume` from any host
- Background jobs (`status` / `log` / `stop`)
- Optional git worktree so the child cannot touch the main tree
- Unified `--effort` mapped per CLI

## Requirements

- Node.js >= 18.18
- At least one backend on `PATH`: `grok`, `cursor-agent`, `claude`, `codex`

Windows: Cursor is usually `%LOCALAPPDATA%\cursor-agent\agent.cmd`. Use `cursor-agent`, never bare `agent` (Grok ships `agent.exe` too).

## Install

The host loads a **skill folder**, not a PATH binary.

**skillshare** (copy into Claude / Codex / Grok / Cursor / `~/.agents`):

```bash
skillshare install isCopyman/cli-delegate -s cli-delegate
skillshare sync
```

**Clone + junction** (PowerShell 7):

```powershell
git clone https://github.com/isCopyman/cli-delegate.git
pwsh -File .\cli-delegate\install.ps1
```

That junctions `skills/cli-delegate` into whichever of `~/.claude/skills`, `~/.codex/skills`, `~/.grok/skills`, `~/.agents/skills` already exist. Start a **new** host session so the skill is picked up.

Optional, humans only: `npm link` for a `cli-delegate` command. Agents should keep calling `node` on the skill-folder script with an **absolute path**.

## CLI

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs which --cli grok
node .\skills\cli-delegate\scripts\cli-delegate.mjs run --cli grok --cwd $PWD --prompt-file .\brief.md
node .\skills\cli-delegate\scripts\cli-delegate.mjs run --cli grok --cwd $PWD --background --worktree --prompt-file .\brief.md
node .\skills\cli-delegate\scripts\cli-delegate.mjs run --cli grok --cwd $PWD --schema .\schema.json --prompt-file .\brief.md
node .\skills\cli-delegate\scripts\cli-delegate.mjs resume --cli grok --cwd $PWD --worktree --prompt-file .\followup.md
node .\skills\cli-delegate\scripts\cli-delegate.mjs log <jobId>
node .\skills\cli-delegate\scripts\cli-delegate.mjs stop <jobId>
```

Stdout is JSON (`status`, `sessionId`, `jobId`, `result`). State: `%LOCALAPPDATA%\cli-delegate` on Windows, `~/.local/share/cli-delegate` elsewhere (`CLI_DELEGATE_HOME` overrides).

| Flag | Meaning |
|---|---|
| `--prompt-file` | Task brief from a file. `--file` is extract-only. |
| `--schema` | JSON Schema file. Grok/Claude `--json-schema`; Codex `--output-schema`. Cursor has none. |
| `--worktree` | New throwaway git worktree from this checkout's HEAD. |
| `--worktree-name` | Sticky named lane (implies `--worktree`). Warns if behind; does not refuse. |
| `--effort` | `low\|medium\|high\|xhigh\|max` mapped per CLI |
| `--read-only` | Plan/review, no edits |
| `--background` | Return `jobId` immediately |
| `-- …` | Extra argv forwarded to the child |

Same-host nesting is refused unless `--settings` (third-party Claude) or `--allow-nested`.

## Tests

```powershell
npm test
```

Zero runtime dependencies. Tests do not call live models. They pin argv contracts and session-id extraction so a vendor CLI change fails here first.

## vs official plugins

| | cli-delegate | Official Grok CC plugin | Cursor-in-Claude plugins |
|---|---|---|---|
| Hosts | Claude / Codex / Grok / Cursor | Claude Code only | Claude Code only |
| Child | grok, cursor-agent, claude, codex | grok only | cursor-agent only |
| Resume | per cwd+cli | `grok -r` + jobs | `cursor-agent --resume` |
| Background | `--background` / `log` / `stop` | `/stop` | `/cursor:cancel` |

Use the official plugin when you live inside Claude Code and want slash commands. Use this when the host might be Codex or Grok, or you want one interface across four CLIs.

## License

MIT. See [LICENSE](./LICENSE).

## Acknowledgements

Thanks to the [LINUX DO](https://linux.do) community.
