import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import {
  runProcess,
  writeExtendUntil,
} from "../skills/cli-delegate/scripts/lib/spawn.mjs"
import {
  recordJob,
  readJobExtend,
  writeJobExtend,
} from "../skills/cli-delegate/scripts/lib/state.mjs"

const runner = path.resolve("skills/cli-delegate/scripts/cli-delegate.mjs")

test("a short timeout kills a long child", async () => {
  const started = Date.now()
  const spawned = await runProcess(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
    timeoutMs: 400,
  })
  assert.equal(spawned.exitCode, 124)
  assert.ok(Date.now() - started < 2000)
})

test("writing the extend file pushes the kill deadline", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-extend-"))
  const extendPath = path.join(dir, "job.extend.json")
  writeExtendUntil(extendPath, Date.now() + 400)
  const pending = runProcess(process.execPath, ["-e", "setTimeout(() => {}, 900)"], {
    timeoutMs: 400,
    extendPath,
  })
  await new Promise((resolve) => setTimeout(resolve, 150))
  writeExtendUntil(extendPath, Date.now() + 5000)
  const spawned = await pending
  try {
    assert.equal(spawned.exitCode, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("extend command rewrites the job deadline", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-home-"))
  const env = { ...process.env, CLI_DELEGATE_HOME: home }
  const id = "run-extend-test"
  try {
    recordJob(
      {
        id,
        cli: "codex",
        cwd: process.cwd(),
        sourceCwd: process.cwd(),
        status: "running",
        pid: process.pid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      env
    )
    writeJobExtend(id, Date.now() + 1000, env)
    const result = spawnSync(
      process.execPath,
      [runner, "extend", "--id", id, "--timeout", "8000"],
      { encoding: "utf8", env }
    )
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.status, "success")
    assert.equal(payload.jobId, id)
    assert.equal(payload.addedMs, 8000)
    const until = readJobExtend(id, env)
    assert.ok(until >= Date.now() + 4000)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
