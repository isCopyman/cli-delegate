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
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" run --cli grok --cwd "<ABS_CWD>" --background --worktree-name ui --prompt-file "<ABS_BRIEF>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" run --cli grok --cwd "<ABS_CWD>" --schema "<ABS_SCHEMA_JSON>" --prompt-file "<ABS_BRIEF>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" resume --cli grok --cwd "<ABS_CWD>" --resume "<SESSION_ID>" --worktree-name ui --prompt-file "<ABS_FOLLOWUP>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" status --cli grok --cwd "<ABS_CWD>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" log <jobId>
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" stop <jobId>
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" sessions --cli grok --cwd "<ABS_CWD>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" extract --file "<jsonl>" --max-chars 8000
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" worktrees --cwd "<ABS_CWD>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" cleanup --cwd "<ABS_CWD>" --ephemeral --yes
```

`--background` returns `status: running` + `jobId` immediately. Prefer it for long jobs so you can `status` / `log` / `stop`. Claude Code's background shell can wait on a blocking `run`; still use `--background` when you need to kill the child CLI tree or when the host is not Claude Code.

Need prior chat as context: put the **jsonl/transcript path** in the child prompt (or `sessions --cli` to find it). The child should Read/Grep **slices**, never slurp the whole file, never treat it as its own `--resume`. Do not convert Claude jsonl into a Grok/Codex native session. Searching “did we already fix this” is `deja`. `extract` is optional only when the raw file is unreadable event soup — write a small text file the child can Read; do not paste it into the `run` prompt.

## Flags

| Flag | Meaning |
|---|---|
| `--prompt-file <path>` | Task brief from a file. Prefer this over `$(cat …)` / a huge quoted prompt. `--file` is **extract only**. |
| `--schema <file>` | JSON Schema object. Grok/Claude `--json-schema` (inline JSON). Codex `--output-schema` (file). Cursor: not supported — put the shape in the brief. |
| `--worktree` | Throwaway isolation: new git worktree from **this checkout's HEAD**, under the main repo `.cli-delegate/worktrees/`. Does not copy uncommitted files. |
| `--worktree-name <slug>` | Named lane (implies `--worktree`). Same folder every time. For a feature you will `resume`. Parallel jobs = different names. |
| `--allow-stale` | Hide the “this lane is behind source HEAD” warning. |
| `--resume-last` | Newest session for this cwd+cli, even if several exist |
| `--resume <id>` | Continue that session. Required when cwd+cli has more than one recorded session |
| `--fresh` | Force a new session |
| `--read-only` | Review/plan, no edits |
| `--settings <file>` | Claude `--settings` JSON (third-party endpoint) |
| `--model` / `--effort` | Model id; unified effort `low\|medium\|high\|xhigh\|max` |
| `--allow-nested` | Override same-host refusal |
| `--background` | Detach; return `jobId` immediately |
| `--timeout <ms>` | Default 600000 |
| `-- …` | Extra argv forwarded to the child CLI (after the prompt) |

`resume` with no id: one recorded session for this cwd+cli → that id; none → vendor `--continue`; **two or more → error with `candidates`**. Do not guess. Pass `--resume <sessionId>` or `--resume-last`. `sessions --cli` lists native ids. A `--worktree` run stores the worktree on the job; resume with the same `--worktree` / `--worktree-name` (or `--resume id` so the job's tree is reused).

### When to use a worktree

| Situation | Flag |
|---|---|
| Read-only review of the current tree | `--read-only`, no `--worktree` |
| Host is already in a git worktree you made | `--cwd` that tree, no `--worktree` |
| One-shot write job that must not touch this checkout | `--worktree` (new folder each `run`) |
| Multi-turn write job (`run` then `resume`) | `--worktree-name feature-x` |
| Two write jobs at once | two names, e.g. `ui` and `api` |

A reused named lane that is behind source HEAD **warns** (SHA + how many commits). It does not refuse. `resume` never fast-forwards: that would throw away the child's branch. A new `run` on a **clean** named lane with no unique commits fast-forwards. Leftover child commits stay; the JSON `warnings` say so.

If a named worktree **directory** was deleted but the branch `cli-delegate-<slug>` still exists, the next `--worktree-name` **reattaches** that branch. It does not `git worktree add -B` (that would reset unique commits).

### Worktree cleanup

This runner does **not** delete trees when a job finishes. Throwaway `--worktree` folders accumulate under `<repo>/.cli-delegate/worktrees/`.

```bash
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" worktrees --cwd "<ABS_CWD>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" cleanup --cwd "<ABS_CWD>" --ephemeral
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" cleanup --cwd "<ABS_CWD>" --ephemeral --yes
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" cleanup --cwd "<ABS_CWD>" --worktree-name ui --yes
```

Without `--yes`, `cleanup` only lists. `--ephemeral` drops throwaway slugs (`grok-…`, `claude-…`, …) and their branches. Named lanes: `git worktree remove` the folder, **keep** the branch so you can reattach. After you merge, delete the branch yourself: `git branch -d cli-delegate-ui`.

Or by hand: `git worktree list`, `git worktree remove <path>`, `git worktree prune`.

## Not a team runtime

Do not turn this into Teams / mailbox / wait / fan-in. Tools like Orca and Herdr already do persistent multi-agent collaboration. This skill is **one child CLI, run or resume, then stop**. Complementary to host subagents, not a replacement for a team bus.

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

`status`: `success` | `running` | `partial` (timeout) | `error` | `stopped`. Use `result` when finished. For `--background`, poll `status`/`show` and `log`; `stop` kills the worker and child tree. Keep `sessionId` from `run` and pass `--resume <sessionId>` on the next turn whenever this cwd+cli might have more than one child. Bare `resume` only auto-picks if exactly one session is recorded. `continued` is true on resume.

`--schema` constrains the **child CLI** (Grok/Claude tool or Codex `text.format`). It is not a retry loop inside this runner. Treat `result` as a claim; re-run tests in the host tree yourself.

## Host notes

- Raise the shell tool timeout to at least 600000 ms.
- Children have no stdin for permission prompts. Default is auto-approve; `--read-only` opts out.
- Windows: `cursor-agent`, never bare `agent` (collides with Grok).
- Windows Git Bash: the `node` path must use forward slashes (`C:/Users/...`), not backslashes. Do not wrap the child CLI in `bash.exe`. Python one-liners in Git Bash often print GBK as mojibake — set `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1`, or use `pwsh`.
- State: `%LOCALAPPDATA%/cli-delegate` or `~/.local/share/cli-delegate`.
