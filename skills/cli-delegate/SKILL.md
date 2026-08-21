---
name: cli-delegate
description: Spawn grok, cursor-agent, claude, or codex as a child CLI and resume that same session on later turns. Use when the user wants to delegate to another coding CLI, continue a previous Grok/Cursor/Claude/Codex run, or run a second opinion without opening a fresh chat.
---

# CLI Delegate

Run `{SKILL_DIR}/scripts/cli-delegate.mjs` via the host's shell. Parse JSON on stdout. Do not wrap the child in an interactive TUI.

## When to use

- Hand a coding or review task to **grok**, **cursor**, **claude**, or **codex**
- Continue a previous child session instead of starting over
- Claude Code / Codex / Grok / Cursor hosts all invoke the same script

Do **not** spawn the same CLI as the current host (Claude inside Claude, Codex inside Codex) unless the user passed a third-party `--settings` file or explicitly asked to nest.

## Commands

Replace `{SKILL_DIR}` with this skill directory. Use `node` (Node >= 18.18).

```bash
node "{SKILL_DIR}/scripts/cli-delegate.mjs" run --cli grok --cwd "<ABS_CWD>" "<prompt>"
node "{SKILL_DIR}/scripts/cli-delegate.mjs" resume --cli grok --cwd "<ABS_CWD>" "<follow-up>"
node "{SKILL_DIR}/scripts/cli-delegate.mjs" status --cli grok --cwd "<ABS_CWD>"
node "{SKILL_DIR}/scripts/cli-delegate.mjs" which --cli grok
```

`--cli`: `grok` | `cursor` | `claude` | `codex` (`cursor-agent` is accepted).

| Flag | Meaning |
|---|---|
| `--resume-last` | Continue last session for this cwd+cli |
| `--resume <id>` | Continue a specific session id |
| `--fresh` | Force a new session |
| `--read-only` | Review/plan, no edits |
| `--settings <file>` | Claude third-party settings JSON |
| `--model` / `--effort` | Model id; unified effort `low\|medium\|high\|xhigh\|max` (mapped per CLI) |
| `--allow-nested` | Override same-host refusal |
| `--timeout <ms>` | Default 600000 |

`resume` without `--id` uses the last recorded session for that cwd+cli.

## Response

Stdout is JSON:

```json
{
  "status": "success",
  "cli": "grok",
  "sessionId": "...",
  "jobId": "run-...",
  "continued": false,
  "result": "..."
}
```

`status`: `success` | `partial` (timeout) | `error`. Use `result` as the child's answer. Save `sessionId` only if you need to pass `--resume` yourself; the script already stores last-session per cwd+cli.

## Host notes

- Raise the shell tool timeout to at least 600000 ms.
- Child CLIs have no stdin for permission prompts. Default runs are auto-approved in the workspace (`--read-only` to opt out).
- On Windows prefer `cursor-agent`, never bare `agent` (collides with Grok).
- Third-party Claude: `run --cli claude --settings <abs-json>`.
- State lives in `%LOCALAPPDATA%/cli-delegate` (Windows) or `~/.local/share/cli-delegate`.
