import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import {
  ResumeAmbiguousError,
  listResumeCandidates,
  recordJob,
  resolveResumeTarget,
} from "../skills/cli-delegate/scripts/lib/state.mjs"

function isolatedEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-resume-"))
  return { dir, env: { ...process.env, CLI_DELEGATE_HOME: dir } }
}

function job(overrides) {
  return {
    id: overrides.id,
    cli: "grok",
    cwd: overrides.cwd,
    sourceCwd: overrides.sourceCwd || overrides.cwd,
    sessionId: overrides.sessionId,
    status: "success",
    promptPreview: overrides.promptPreview || "task",
    worktreePath: overrides.worktreePath || null,
    updatedAt: overrides.updatedAt || new Date().toISOString(),
  }
}

test("resume with no recorded session uses vendor continue", () => {
  const { dir, env } = isolatedEnv()
  try {
    const target = resolveResumeTarget(
      { cli: "grok", cwd: dir, command: "resume" },
      env
    )
    assert.equal(target.resumeId, null)
    assert.equal(target.continueLast, true)
    assert.equal(target.candidates.length, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("resume with one session auto-picks it", () => {
  const { dir, env } = isolatedEnv()
  try {
    recordJob(job({ id: "run-1", cwd: dir, sessionId: "sess-a" }), env)
    const target = resolveResumeTarget(
      { cli: "grok", cwd: dir, command: "resume" },
      env
    )
    assert.equal(target.resumeId, "sess-a")
    assert.equal(target.continueLast, false)
    assert.equal(target.candidates.length, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("resume with two sessions refuses to guess", () => {
  const { dir, env } = isolatedEnv()
  try {
    recordJob(
      job({
        id: "run-1",
        cwd: dir,
        sessionId: "sess-a",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      env
    )
    recordJob(
      job({
        id: "run-2",
        cwd: dir,
        sessionId: "sess-b",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
      env
    )
    assert.equal(listResumeCandidates("grok", dir, env).length, 2)
    assert.throws(
      () => resolveResumeTarget({ cli: "grok", cwd: dir, command: "resume" }, env),
      (err) =>
        err instanceof ResumeAmbiguousError &&
        err.candidates.length === 2 &&
        /--resume/.test(err.message)
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("explicit --resume and --resume-last still work with several sessions", () => {
  const { dir, env } = isolatedEnv()
  try {
    recordJob(job({ id: "run-1", cwd: dir, sessionId: "sess-a" }), env)
    recordJob(job({ id: "run-2", cwd: dir, sessionId: "sess-b" }), env)
    const named = resolveResumeTarget(
      { cli: "grok", cwd: dir, command: "resume", resumeId: "sess-a" },
      env
    )
    assert.equal(named.resumeId, "sess-a")
    const newest = resolveResumeTarget(
      { cli: "grok", cwd: dir, command: "resume", continueLast: true },
      env
    )
    assert.equal(newest.resumeId, "sess-b")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("new run does not resume just because jobs exist", () => {
  const { dir, env } = isolatedEnv()
  try {
    recordJob(job({ id: "run-1", cwd: dir, sessionId: "sess-a" }), env)
    const target = resolveResumeTarget(
      { cli: "grok", cwd: dir, command: "run" },
      env
    )
    assert.equal(target.resumeId, null)
    assert.equal(target.continueLast, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
