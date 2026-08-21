import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { listNativeSessions } from "../skills/cli-delegate/scripts/lib/sessions.mjs"

function writeRollout(root, day, id, cwd, stamp) {
  const dir = path.join(root, "sessions", ...day.split("/"))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `rollout-${stamp.replace(/[:.]/g, "-")}-${id}.jsonl`)
  const line = JSON.stringify({
    timestamp: stamp,
    type: "session_meta",
    payload: {
      id,
      cwd,
      timestamp: stamp,
      base_instructions: { text: "pad".repeat(8000) },
    },
  })
  fs.writeFileSync(file, `${line}\n${"x".repeat(20000)}\n`)
  return file
}

test("Codex sessions walk newest day first and stop at limit", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-codex-sessions-"))
  const cwdA = path.join(home, "proj-a")
  const cwdB = path.join(home, "proj-b")
  try {
    writeRollout(home, "2026/04/03", "old-a", cwdA, "2026-04-03T08:00:00.000Z")
    writeRollout(home, "2026/08/21", "new-b", cwdB, "2026-08-21T10:00:00.000Z")
    const newestA = writeRollout(
      home,
      "2026/08/21",
      "new-a",
      cwdA,
      "2026-08-21T15:00:00.000Z"
    )
    const env = { ...process.env, CODEX_HOME: home }
    const rows = listNativeSessions("codex", cwdA, { limit: 1 }, env)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, "new-a")
    assert.equal(rows[0].path, newestA)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
