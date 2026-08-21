---
name: cli-delegate
description: Spawn grok, cursor-agent, claude, or codex as a child CLI and resume that same session on later turns. Use when the user wants to delegate to another coding CLI, continue a previous Grok/Cursor/Claude/Codex run, or run a second opinion without opening a fresh chat.
---

# CLI Delegate

Delegation is two modes. Same script, same JSON stdout. Pick the mode; do not invent a third.

| Mode | Command | When |
|---|---|---|
| Fire-and-forget | `run` | New child thread. One prompt, take `result`, stop. |
| Continue | `resume` | Same cwd+cli thread. Follow-ups, multi-turn, "keep going". |

`run` still records the session. Later `resume` can pick it up. That does not make `run` a continuing turn — only `resume` (or `run --resume` / `--resume-last`) continues.

Unrelated new work: `run --fresh`, never `resume` onto the last thread.

Do **not** spawn the same CLI as this host unless the user passed Claude `--settings` or `--allow-nested`.

The runner is `scripts/cli-delegate.mjs` in the same folder as this `SKILL.md`. Call it with `node` and an **absolute path**. Parse JSON on stdout. No interactive TUI.

## How to call it

Long jobs: `--background` (not a third mode). Short quoted prompts are fine; a real task brief goes in `--prompt-file`. Write jobs that must not touch the host tree: `--worktree`. Structured answers: `--schema`.

```bash
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" which --cli grok
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" run --cli grok --cwd "<ABS_CWD>" --read-only --prompt-file "<ABS_BRIEF>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" run --cli grok --cwd "<ABS_CWD>" --background --worktree --prompt-file "<ABS_BRIEF>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" run --cli grok --cwd "<ABS_CWD>" --schema "<ABS_SCHEMA_JSON>" --prompt-file "<ABS_BRIEF>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" resume --cli grok --cwd "<ABS_CWD>" --worktree --prompt-file "<ABS_FOLLOWUP>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" status --cli grok --cwd "<ABS_CWD>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" log <jobId>
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" stop <jobId>
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" sessions --cli grok --cwd "<ABS_CWD>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" extract --file "<jsonl>" --max-chars 8000
```

`--background` returns `status: running` + `jobId` immediately. Prefer it for long jobs so you can `status` / `log` / `stop`. Claude Code's background shell can wait on a blocking `run`; still use `--background` when you need to kill the child CLI tree or when the host is not Claude Code.

Need prior chat as context: put the **jsonl/transcript path** in the child prompt (or `sessions --cli` to find it). The child should Read/Grep **slices**, never slurp the whole file, never treat it as its own `--resume`. Do not convert Claude jsonl into a Grok/Codex native session. Searching “did we already fix this” is `deja`. `extract` is optional only when the raw file is unreadable event soup — write a small text file the child can Read; do not paste it into the `run` prompt.

## Flags

| Flag | Meaning |
|---|---|
| `--prompt-file <path>` | Task brief from a file. Prefer this over `$(cat …)` / a huge quoted prompt. `--file` is **extract only**. |
| `--schema <file>` | JSON Schema object. Grok/Claude `--json-schema` (inline JSON). Codex `--output-schema` (file). Cursor: not supported — put the shape in the brief. |
| `--worktree` | Create/reuse `<repo>/.cli-delegate/worktrees/<cli>` from **current HEAD**. Write jobs should use this instead of asking the child in prose not to touch the main tree. |
| `--worktree-name <slug>` | Parallel jobs in the same repo. Default slug is the `--cli` name. Resume with the same flag. |
| `--allow-stale` | Override the default refuse when a reused worktree is behind source HEAD. |
| `--resume-last` | Continue last session for this cwd+cli |
| `--resume <id>` | Continue a specific session id |
| `--fresh` | Force a new session |
| `--read-only` | Review/plan, no edits |
| `--settings <file>` | Claude `--settings` JSON (third-party endpoint) |
| `--model` / `--effort` | Model id; unified effort `low\|medium\|high\|xhigh\|max` |
| `--allow-nested` | Override same-host refusal |
| `--background` | Detach; return `jobId` immediately |
| `--timeout <ms>` | Default 600000 |
| `-- …` | Extra argv forwarded to the child CLI (after the prompt) |

`resume` with no id uses the last recorded session for that cwd+cli. A `--worktree` run records sessions under the worktree path — resume with `--worktree` too.

`--worktree` does not copy uncommitted files. If the reused worktree is missing commits that are on the source HEAD, the runner **refuses** (stale line numbers / already-fixed bugs). Pass `--allow-stale` only when that is acceptable.

## Response

```json
{
  "status": "success",
  "cli": "grok",
  "sessionId": "...",
  "jobId": "run-...",
  "continued": false,
  "result": "...",
  "warnings": [],
  "worktreePath": null
}
```

`status`: `success` | `running` | `partial` (timeout) | `error` | `stopped`. Use `result` when finished. For `--background`, poll `status`/`show` and `log`; `stop` kills the worker and child tree. Save `sessionId` only to pass `--resume` yourself; last-session is already stored per cwd+cli. `continued` is true on resume.

`--schema` constrains the **child CLI** (Grok/Claude tool or Codex `text.format`). It is not a retry loop inside this runner. Treat `result` as a claim; re-run tests in the host tree yourself.

## Host notes

- Raise the shell tool timeout to at least 600000 ms.
- Children have no stdin for permission prompts. Default is auto-approve; `--read-only` opts out.
- Windows: `cursor-agent`, never bare `agent` (collides with Grok).
- Windows Git Bash: the `node` path must use forward slashes (`C:/Users/...`), not backslashes. Do not wrap the child CLI in `bash.exe`. Python one-liners in Git Bash often print GBK as mojibake — set `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1`, or use `pwsh`.
- State: `%LOCALAPPDATA%/cli-delegate` or `~/.local/share/cli-delegate`.
