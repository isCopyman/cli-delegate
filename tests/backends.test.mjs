import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildInvocation,
  nestedHostBlocked,
  normalizeCli,
  tmpCleanup,
} from "../skills/cli-delegate/scripts/lib/backends.mjs"
import { extractResultText, extractSessionId } from "../skills/cli-delegate/scripts/lib/parse.mjs"

test("normalizeCli aliases", () => {
  assert.equal(normalizeCli("cursor-agent"), "cursor")
  assert.equal(normalizeCli("CLAUDE"), "claude")
  assert.equal(normalizeCli("nope"), null)
})

test("nested host block", () => {
  assert.equal(nestedHostBlocked("claude", {}, { CLAUDECODE: "1" }), true)
  assert.equal(
    nestedHostBlocked("claude", { settings: "C:/tmp/settings.json" }, { CLAUDECODE: "1" }),
    false
  )
  assert.equal(nestedHostBlocked("grok", {}, { CLAUDECODE: "1" }), false)
  assert.equal(nestedHostBlocked("claude", { allowNested: true }, { CLAUDECODE: "1" }), false)
})

test("grok args include resume and prompt file", () => {
  const inv = buildInvocation("grok", {
    prompt: "fix the test",
    cwd: process.cwd(),
    resumeId: "abc-123",
    write: true,
  })
  try {
    assert.ok(inv.args.includes("-r"))
    assert.equal(inv.args[inv.args.indexOf("-r") + 1], "abc-123")
    assert.ok(inv.args.includes("--prompt-file"))
    assert.ok(inv.args.includes("--always-approve"))
  } finally {
    tmpCleanup(inv.promptFile)
  }
})

test("claude third-party settings and session id", () => {
  const inv = buildInvocation("claude", {
    prompt: "review src",
    cwd: process.cwd(),
    settings: "D:/tmp/settings-cpa.json",
    readOnly: true,
  })
  assert.ok(inv.args.includes("--settings"))
  assert.ok(inv.args.includes("--bare"))
  assert.ok(inv.args.includes("--session-id") || inv.args.includes("-c") || inv.args.includes("-r"))
  assert.ok(inv.args.includes("--permission-mode"))
})

test("cursor resume flag", () => {
  const inv = buildInvocation("cursor", {
    prompt: "keep going",
    cwd: process.cwd(),
    resumeId: "chat_1",
    write: true,
  })
  assert.ok(inv.args.includes("--resume"))
  assert.equal(inv.args[inv.args.indexOf("--resume") + 1], "chat_1")
  assert.ok(inv.args.includes("--force"))
})

test("codex exec resume --last", () => {
  const inv = buildInvocation("codex", {
    prompt: "next step",
    cwd: process.cwd(),
    continueLast: true,
    write: true,
  })
  assert.ok(inv.args.includes("exec"))
  assert.ok(inv.args.includes("resume"))
  assert.ok(inv.args.includes("--last"))
})

test("extract session and result from claude json", () => {
  const text = JSON.stringify({
    type: "result",
    session_id: "11111111-2222-3333-4444-555555555555",
    result: "done",
  })
  assert.equal(extractSessionId(text), "11111111-2222-3333-4444-555555555555")
  assert.equal(extractResultText(text), "done")
})

test("extract session from jsonl", () => {
  const text = [
    '{"type":"start"}',
    '{"type":"item","sessionId":"sess-9"}',
    '{"type":"result","result":"ok"}',
  ].join("\n")
  assert.equal(extractSessionId(text), "sess-9")
  assert.equal(extractResultText(text), "ok")
})
