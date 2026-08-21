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

Long jobs: prefer the **host** background around a **blocking** `run`/`resume`. Short quoted prompts are fine; a real task brief goes in `--prompt-file`. Write jobs that must not touch the host tree: `--worktree`. Structured answers: `--schema`.

```bash
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" which --cli grok
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" run --cli grok --cwd "<ABS_CWD>" --read-only --prompt-file "<ABS_BRIEF>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" run --cli grok --cwd "<ABS_CWD>" --worktree-name ui --prompt-file "<ABS_BRIEF>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" run --cli grok --cwd "<ABS_CWD>" --schema "<ABS_SCHEMA_JSON>" --prompt-file "<ABS_BRIEF>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" resume --cli grok --cwd "<ABS_CWD>" --resume "<SESSION_ID>" --worktree-name ui --prompt-file "<ABS_FOLLOWUP>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" status --cli grok --cwd "<ABS_CWD>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" log <jobId>
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" stop <jobId>
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" sessions --cli grok --cwd "<ABS_CWD>"
node "/absolute/path/to/this-skill/scripts/cli-delegate.mjs" extract --file "<jsonl>" --max-chars 8000
```

Default: omit `--model` and `--effort`. The child CLI uses its own default. Do not invent an id and do not keep a roster in this skill. If the user named a model, pass `--model <id>` (and `--effort` if they named that too), or put vendor flags after `--`.

Optional probe only: `models --cli grok|cursor|codex` wraps that vendor's list command (`grok models`, `cursor-agent models`, `codex debug models` slugs). Claude has no list command — `models --cli claude` returns `unsupported`.

Host background (Claude bash bg, Grok `background: true`, Codex bg, …) pings you when this script prints JSON — that is the child finishing. Raise the host tool timeout to at least 600000 ms.

`--background` on this script detaches a worker (`unref`). The host will **not** ping you when the child finishes; ending or compacting this session will **not** kill it. Default `--timeout` 600000 is the backstop. Use it only when the host has no notify/bg, or you need `stop` to kill the child CLI tree (Windows especially). Never both: host-bg plus `--background` makes the host ping on our immediate `{status:running}` while the child is still going. If you passed `--background`, you own the `jobId`: `status`/`log` until done, or `stop`. Do not leave it across compact/new chat without telling the user that `jobId`.

Need prior chat as context: put the **jsonl/transcript path** in the child prompt (or `sessions --cli` to find it). The child should Read/Grep **slices**, never slurp the whole file, never treat it as its own `--resume`. Do not convert Claude jsonl into a Grok/Codex native session. Searching “did we already fix this” is `deja`. `extract` is optional only when the raw file is unreadable event soup — write a small text file the child can Read; do not paste it into the `run` prompt.

## Flags

| Flag | Meaning |
|---|---|
| `--prompt-file <path>` | Task brief from a file. Prefer this over `$(cat …)` / a huge quoted prompt. `--file` is **extract only**. |
| `--schema <file>` | JSON Schema object. Grok/Claude `--json-schema` (inline JSON). Codex `--output-schema` (file). Cursor: not supported — put the shape in the brief. |
| `--worktree` | New extra checkout from **this HEAD**, under `<repo>/.cli-delegate/worktrees/`. Same git objects, separate files. Does not copy uncommitted files. |
| `--worktree-name <slug>` | Named lane (implies `--worktree`). A **persistent parallel environment** you `resume` into. Two names = two lanes. |
| `--allow-stale` | Hide the “this lane is behind source HEAD” warning. |
| `--resume-last` | Newest session for this cwd+cli, even if several exist |
| `--resume <id>` | Continue that session. Required when cwd+cli has more than one recorded session |
| `--fresh` | Force a new session |
| `--read-only` | Review/plan, no edits |
| `--settings <file>` | Claude `--settings` JSON (third-party endpoint) |
| `--model` / `--effort` | Optional. Omit unless the user named them. |
| `--allow-nested` | Override same-host refusal |
| `--background` | Detach our worker. Host will not notify. Prefer host bg around a blocking run. |
| `--timeout <ms>` | Default 600000 |
| `-- …` | Extra argv forwarded to the child CLI (after the prompt) |

`resume` with no id: one recorded session for this cwd+cli → that id; none → vendor `--continue`; **two or more → error with `candidates`**. Do not guess. Pass `--resume <sessionId>` or `--resume-last`. `sessions --cli` lists native ids. A `--worktree` run stores the worktree on the job; resume with the same `--worktree` / `--worktree-name` (or `--resume id` so the job's tree is reused).

### Worktrees are parallel environments

A worktree is a second working copy of the same repo (same objects, different folder + usually `cli-delegate-<slug>`). The child CLI's `--cwd` is that folder. Vendor transcripts (Claude `projects/<encoded-cwd>`, Grok session groups, Cursor `projects/…`) are keyed by **that** path. Delete the folder and you can still have the jsonl, but `resume` has nowhere to land until you reattach.

`--worktree-name ui` is a **continuous lane**, not a temp sandbox: keep using it across `run`/`resume` like a feature branch next to main. A new `run` (not `resume`) on a **clean** lane with no unique commits fast-forwards to source HEAD (sync with the checkout you passed). Unique commits stay; JSON `warnings` say the lane diverged. `resume` never fast-forwards — that would move the branch under a live session.

Do **not** try to keep the child's session under the host cwd and only mention a worktree in the prompt. Isolation is `--cwd` on the child. Prompt-only “please use a worktree” still writes the host tree.

| Situation | Flag |
|---|---|
| Read-only review of the current tree | `--read-only`, no `--worktree` |
| Host is already in a git worktree you made | `--cwd` that tree, no `--worktree` |
| One-shot write, then merge and forget | `--worktree` |
| Ongoing parallel branch you will resume | `--worktree-name feature-x` |
| Two parallel environments at once | two names, e.g. `ui` and `api` |

If the named **directory** is gone but branch `cli-delegate-<slug>` remains, the next `--worktree-name` **reattaches** it. It does not `git worktree add -B`.

### Worktree cleanup (host git, rare)

Default: **do not delete**. Removing the checkout breaks further `resume` into that session until you reattach the branch.

Only remove a path after **all** of: the work is merged or you are discarding it; you will not `--resume` that `sessionId`; for a named lane, you are done with that environment.

```bash
git worktree list
git worktree remove "<worktreePath>"   # from the job JSON
git worktree prune
```

Keep `cli-delegate-<slug>` if you might reattach. After the branch is fully merged and the session is retired: `git branch -d cli-delegate-<slug>`. Do not `git worktree add -B`.

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

- Raise the host tool timeout to at least 600000 ms when a blocking `run` is in the host background.
- Children have no stdin for permission prompts. Default is auto-approve; `--read-only` opts out.
- Windows: `cursor-agent`, never bare `agent` (collides with Grok).
- Windows Git Bash: the `node` path must use forward slashes (`C:/Users/...`), not backslashes. Do not wrap the child CLI in `bash.exe`. Python one-liners in Git Bash often print GBK as mojibake — set `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1`, or use `pwsh`.
- State: `%LOCALAPPDATA%/cli-delegate` or `~/.local/share/cli-delegate`.
