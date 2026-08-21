import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import { ArgError } from "../skills/cli-delegate/scripts/lib/args.mjs"
import { gitBinary, prepareWorktree } from "../skills/cli-delegate/scripts/lib/worktree.mjs"

function git(args, cwd) {
  const bin = gitBinary()
  const result = spawnSync(bin, args, { cwd, encoding: "utf8", windowsHide: true })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`)
  }
  return result.stdout.trim()
}

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-wt-"))
  git(["init"], dir)
  git(["config", "user.email", "t@t.test"], dir)
  git(["config", "user.name", "t"], dir)
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n")
  git(["add", "a.txt"], dir)
  git(["-c", "commit.gpgsign=false", "commit", "-m", "one"], dir)
  return dir
}

test("prepareWorktree creates from current HEAD and reuses", async (t) => {
  if (!gitBinary()) {
    t.skip("git not on PATH")
    return
  }
  const dir = initRepo()
  try {
    const first = prepareWorktree({ cwd: dir, cli: "grok" })
    assert.equal(first.created, true)
    assert.equal(fs.existsSync(path.join(first.cwd, "a.txt")), true)
    assert.equal(first.worktreeHead, first.sourceHead)

    const again = prepareWorktree({ cwd: dir, cli: "grok" })
    assert.equal(again.created, false)
    assert.equal(again.cwd, first.cwd)
    assert.equal(again.warnings.length, 0)
  } finally {
    spawnSync(gitBinary(), ["worktree", "remove", "--force", path.join(dir, ".cli-delegate", "worktrees", "grok")], {
      cwd: dir,
      windowsHide: true,
    })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("prepareWorktree refuses a worktree behind source HEAD", async (t) => {
  if (!gitBinary()) {
    t.skip("git not on PATH")
    return
  }
  const dir = initRepo()
  try {
    prepareWorktree({ cwd: dir, cli: "grok" })
    fs.writeFileSync(path.join(dir, "a.txt"), "two\n")
    git(["add", "a.txt"], dir)
    git(["-c", "commit.gpgsign=false", "commit", "-m", "two"], dir)

    assert.throws(
      () => prepareWorktree({ cwd: dir, cli: "grok" }),
      (err) => err instanceof ArgError && /stale worktree/.test(err.message)
    )

    const forced = prepareWorktree({ cwd: dir, cli: "grok", allowStale: true })
    assert.equal(forced.created, false)
    assert.ok(forced.warnings.some((w) => /missing/.test(w)))
  } finally {
    spawnSync(gitBinary(), ["worktree", "remove", "--force", path.join(dir, ".cli-delegate", "worktrees", "grok")], {
      cwd: dir,
      windowsHide: true,
    })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
