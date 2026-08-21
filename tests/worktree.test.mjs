import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import { parseArgv } from "../skills/cli-delegate/scripts/lib/args.mjs"
import {
  canonicalRepoRoot,
  gitBinary,
  prepareWorktree,
} from "../skills/cli-delegate/scripts/lib/worktree.mjs"

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

function cleanupWorktrees(dir) {
  const wt = path.join(dir, ".cli-delegate", "worktrees")
  if (!fs.existsSync(wt)) return
  for (const name of fs.readdirSync(wt)) {
    spawnSync(gitBinary(), ["worktree", "remove", "--force", path.join(wt, name)], {
      cwd: dir,
      windowsHide: true,
    })
  }
}

test("--worktree-name implies --worktree", () => {
  const parsed = parseArgv(["run", "--cli", "grok", "--worktree-name", "ui"])
  assert.equal(parsed.worktree, true)
  assert.equal(parsed.worktreeName, "ui")
})

test("ephemeral --worktree creates a new folder each run", async (t) => {
  if (!gitBinary()) {
    t.skip("git not on PATH")
    return
  }
  const dir = initRepo()
  try {
    const first = prepareWorktree({ cwd: dir, cli: "grok" })
    const second = prepareWorktree({ cwd: dir, cli: "grok" })
    assert.equal(first.kind, "ephemeral")
    assert.equal(second.kind, "ephemeral")
    assert.equal(first.created, true)
    assert.equal(second.created, true)
    assert.notEqual(first.cwd, second.cwd)
    assert.equal(first.worktreeHead, first.sourceHead)
  } finally {
    cleanupWorktrees(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("named lane reuses the same folder", async (t) => {
  if (!gitBinary()) {
    t.skip("git not on PATH")
    return
  }
  const dir = initRepo()
  try {
    const first = prepareWorktree({ cwd: dir, cli: "grok", name: "ui" })
    const again = prepareWorktree({ cwd: dir, cli: "grok", name: "ui" })
    assert.equal(first.kind, "named")
    assert.equal(again.created, false)
    assert.equal(again.cwd, first.cwd)
  } finally {
    cleanupWorktrees(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("named lane behind source warns and does not refuse", async (t) => {
  if (!gitBinary()) {
    t.skip("git not on PATH")
    return
  }
  const dir = initRepo()
  try {
    prepareWorktree({ cwd: dir, cli: "grok", name: "ui" })
    fs.writeFileSync(path.join(dir, "a.txt"), "two\n")
    git(["add", "a.txt"], dir)
    git(["-c", "commit.gpgsign=false", "commit", "-m", "two"], dir)

    const next = prepareWorktree({ cwd: dir, cli: "grok", name: "ui" })
    assert.equal(next.created, false)
    // clean lane with no unique commits should fast-forward
    assert.equal(next.worktreeHead, next.sourceHead)
    assert.ok(next.warnings.some((w) => /fast-forwarded/.test(w)))
  } finally {
    cleanupWorktrees(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("resume does not fast-forward a named lane", async (t) => {
  if (!gitBinary()) {
    t.skip("git not on PATH")
    return
  }
  const dir = initRepo()
  try {
    const first = prepareWorktree({ cwd: dir, cli: "grok", name: "ui" })
    fs.writeFileSync(path.join(dir, "a.txt"), "two\n")
    git(["add", "a.txt"], dir)
    git(["-c", "commit.gpgsign=false", "commit", "-m", "two"], dir)

    const resumed = prepareWorktree({
      cwd: dir,
      cli: "grok",
      name: "ui",
      continuing: true,
    })
    assert.equal(resumed.worktreeHead, first.worktreeHead)
    assert.ok(resumed.warnings.some((w) => /not in this worktree/.test(w)))
  } finally {
    cleanupWorktrees(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("worktree from an existing linked worktree lands under the main repo", async (t) => {
  if (!gitBinary()) {
    t.skip("git not on PATH")
    return
  }
  const dir = initRepo()
  const linked = path.join(os.tmpdir(), `cli-delegate-link-${Date.now().toString(36)}`)
  try {
    git(["worktree", "add", linked, "HEAD"], dir)
    const root = canonicalRepoRoot(linked)
    assert.equal(path.resolve(root), path.resolve(dir))
    const child = prepareWorktree({ cwd: linked, cli: "grok", name: "from-link" })
    assert.ok(child.cwd.startsWith(path.join(dir, ".cli-delegate", "worktrees")))
    assert.equal(child.cwd.includes(linked), false)
  } finally {
    cleanupWorktrees(dir)
    spawnSync(gitBinary(), ["worktree", "remove", "--force", linked], {
      cwd: dir,
      windowsHide: true,
    })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("reattach named lane does not reset an existing branch", async (t) => {
  if (!gitBinary()) {
    t.skip("git not on PATH")
    return
  }
  const dir = initRepo()
  try {
    const first = prepareWorktree({ cwd: dir, cli: "grok", name: "ui" })
    fs.writeFileSync(path.join(first.cwd, "a.txt"), "lane\n")
    git(["add", "a.txt"], first.cwd)
    git(["-c", "commit.gpgsign=false", "commit", "-m", "lane"], first.cwd)
    const laneHead = git(["rev-parse", "HEAD"], first.cwd)
    git(["worktree", "remove", "--force", first.cwd], dir)
    const again = prepareWorktree({ cwd: dir, cli: "grok", name: "ui" })
    assert.equal(again.worktreeHead, laneHead)
    assert.ok(again.warnings.some((w) => /reattached existing branch/.test(w)))
  } finally {
    cleanupWorktrees(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("allowStale suppresses behind warning on resume", async (t) => {
  if (!gitBinary()) {
    t.skip("git not on PATH")
    return
  }
  const dir = initRepo()
  try {
    prepareWorktree({ cwd: dir, cli: "grok", name: "ui" })
    fs.writeFileSync(path.join(dir, "a.txt"), "two\n")
    git(["add", "a.txt"], dir)
    git(["-c", "commit.gpgsign=false", "commit", "-m", "two"], dir)
    const resumed = prepareWorktree({
      cwd: dir,
      cli: "grok",
      name: "ui",
      continuing: true,
      allowStale: true,
    })
    assert.equal(resumed.warnings.some((w) => /not in this worktree/.test(w)), false)
  } finally {
    cleanupWorktrees(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
