import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { ArgError, loadPrompt, parseArgv } from "../skills/cli-delegate/scripts/lib/args.mjs"

test("parseArgv reads --prompt-file --schema --worktree", () => {
  const parsed = parseArgv([
    "run",
    "--cli",
    "grok",
    "--cwd",
    process.cwd(),
    "--prompt-file",
    "D:/tmp/brief.md",
    "--schema",
    "D:/tmp/schema.json",
    "--worktree",
    "--worktree-name",
    "ui",
    "--allow-stale",
  ])
  assert.equal(parsed.command, "run")
  assert.equal(parsed.cli, "grok")
  assert.equal(parsed.worktree, true)
  assert.equal(parsed.worktreeName, "ui")
  assert.equal(parsed.allowStale, true)
  assert.match(parsed.promptFile.replace(/\\/g, "/"), /brief\.md$/)
  assert.match(parsed.schema.replace(/\\/g, "/"), /schema\.json$/)
  assert.equal(parsed.prompt, "")
})

test("unknown flag throws", () => {
  assert.throws(() => parseArgv(["run", "--nope"]), ArgError)
})

test("-h as the command is help", () => {
  const parsed = parseArgv(["-h"])
  assert.equal(parsed.help, true)
  assert.equal(parsed.command, "help")
})

test("loadPrompt reads the file and rejects mixing with positional", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-prompt-"))
  const file = path.join(dir, "brief.md")
  try {
    fs.writeFileSync(file, "fix the flake\n")
    const parsed = parseArgv(["run", "--cli", "grok", "--prompt-file", file])
    assert.equal(loadPrompt(parsed), "fix the flake\n")
    parsed.prompt = "also this"
    assert.throws(() => loadPrompt(parsed), /either --prompt-file or a positional/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("--file on run is extract-only", () => {
  const parsed = parseArgv(["run", "--cli", "grok", "--file", "D:/tmp/session.jsonl"])
  assert.throws(() => loadPrompt(parsed), /--file is for extract/)
})

test("the default timeout is 15 minutes, from one source", async () => {
  const { DEFAULT_TIMEOUT_MS } = await import(
    "../skills/cli-delegate/scripts/lib/spawn.mjs"
  )
  const { defaultTimeoutMs } = await import(
    "../skills/cli-delegate/scripts/lib/backends.mjs"
  )
  // Codex routinely spends more than ten minutes on a real task, and the kill
  // turned finished work into a `partial` with no report.
  assert.equal(DEFAULT_TIMEOUT_MS, 900000)
  assert.equal(defaultTimeoutMs(), DEFAULT_TIMEOUT_MS)
  // The parser used to carry its own copy of the number, in two places.
  assert.equal(parseArgv(["run", "--cli", "codex", "hi"]).timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.equal(parseArgv(["--help"]).timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.equal(parseArgv(["run", "--timeout", "1234", "hi"]).timeoutMs, 1234)
})
