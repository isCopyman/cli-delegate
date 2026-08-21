# cli-delegate

Host-neutral Agent Skill + Node CLI that shells out to **Grok Build**, **Cursor Agent**, **Claude Code**, or **Codex**, and **resumes the same child session** on later turns.

Claude Code / Codex / Grok / Cursor can all invoke the same script. This is the portable core behind official CC bridges (`xai-org/grok-build-plugin-cc`, `openai/codex-plugin-cc`) without the Claude-only slash commands and hooks.

## Why

Those official plugins only work inside Claude Code. Generic spawn skills (e.g. shinpr/sub-agents-skills) usually start a **new** chat every time. Child CLIs already support resume (`grok -r`, `cursor-agent --resume`, `claude -r`, `codex exec resume`). This repo records the session id per working directory and feeds it back.

## Requirements

- Node.js >= 18.18
- At least one backend on `PATH`: `grok`, `cursor-agent`, `claude`, `codex`

On Windows, Cursor is typically `%LOCALAPPDATA%\cursor-agent\agent.cmd`. Prefer `cursor-agent`, not `agent` (Grok also ships `agent.exe`).

## Install the skill

From this repo:

```powershell
pwsh -File .\install.ps1
```

That junctions `skills/cli-delegate` into whichever of these exist:

- `%USERPROFILE%\.claude\skills\cli-delegate`
- `%USERPROFILE%\.codex\skills\cli-delegate`
- `%USERPROFILE%\.grok\skills\cli-delegate`
- `%USERPROFILE%\.agents\skills\cli-delegate`

Reload the host (Claude `/reload-plugins` is not required for a plain skill; start a new session if it does not appear).

## CLI

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs which --cli grok
node .\skills\cli-delegate\scripts\cli-delegate.mjs run --cli grok --cwd $PWD "investigate the flaky test"
node .\skills\cli-delegate\scripts\cli-delegate.mjs resume --cli grok --cwd $PWD "apply the top fix"
node .\skills\cli-delegate\scripts\cli-delegate.mjs status --cli grok --cwd $PWD
```

Stdout is JSON (`status`, `sessionId`, `jobId`, `result`). State: `%LOCALAPPDATA%\cli-delegate\state.json` on Windows, `~/.local/share/cli-delegate` elsewhere. Override with `CLI_DELEGATE_HOME`.

| Flag | Meaning |
|---|---|
| `--read-only` | Plan/review, no edits |
| `--settings <file>` | Claude `--settings` (third-party API) |
| `--fresh` | Ignore last session |
| `--allow-nested` | Allow Claude-in-Claude / Codex-in-Codex |

Same-host nesting is refused by default so a Claude session does not spawn another Claude unless you pass `--settings` or `--allow-nested`.

## Tests

```powershell
npm test
```

No runtime dependencies. Tests do not call live models.

## Not in v0.1

- Background job PID trees and `/stop` (official CC plugins have this)
- Importing the *current host transcript* into Grok/Codex (host-specific)
- Slash-command wrappers for Claude Code
