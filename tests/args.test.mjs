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
    "--background",
    "--allow-stale",
  ])
  assert.equal(parsed.command, "run")
  assert.equal(parsed.cli, "grok")
  assert.equal(parsed.worktree, true)
  assert.equal(parsed.worktreeName, "ui")
  assert.equal(parsed.background, true)
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
