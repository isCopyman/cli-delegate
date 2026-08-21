import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import {
  buildInvocation,
  cursorModelWithEffort,
  effortForCli,
  interpretOutput,
  nestedHostBlocked,
  normalizeCli,
  tmpCleanup,
} from "../skills/cli-delegate/scripts/lib/backends.mjs"
import {
  encodeClaudeProjectDir,
  encodeCursorProjectDir,
} from "../skills/cli-delegate/scripts/lib/sessions.mjs"
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
  assert.equal(
    nestedHostBlocked("grok", {}, { GROK_SESSION_ID: "sess-1", GROK_AGENT: "1" }),
    true
  )
  assert.equal(nestedHostBlocked("cursor", {}, { GROK_SESSION_ID: "sess-1" }), false)
  assert.equal(
    nestedHostBlocked("grok", { allowNested: true }, { GROK_SESSION_ID: "sess-1" }),
    false
  )
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
  assert.equal(inv.input, "keep going")
  assert.equal(inv.args.includes("keep going"), false)
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

test("effort maps per cli", () => {
  assert.equal(effortForCli("grok", "xhigh"), "high")
  assert.equal(effortForCli("claude", "xhigh"), "xhigh")
  assert.equal(effortForCli("codex", "max"), "xhigh")
  assert.equal(effortForCli("cursor", "high"), "high")
})

test("cursor model absorbs effort brackets", () => {
  assert.equal(cursorModelWithEffort("composer", "high"), "composer[effort=high]")
  assert.equal(
    cursorModelWithEffort("claude-opus-4-8[context=1m,effort=low]", "high"),
    "claude-opus-4-8[context=1m,effort=high]"
  )
  assert.equal(cursorModelWithEffort(null, "high"), null)
  assert.equal(cursorModelWithEffort("auto", "high"), "auto")
  assert.equal(cursorModelWithEffort("composer", null), "composer")
})

test("omit --model unless the caller passed one", () => {
  const grok = buildInvocation("grok", {
    prompt: "x",
    cwd: process.cwd(),
  })
  try {
    assert.equal(grok.args.includes("--model"), false)
  } finally {
    tmpCleanup(grok.promptFile)
  }
  const claude = buildInvocation("claude", {
    prompt: "x",
    cwd: process.cwd(),
  })
  assert.equal(claude.args.includes("--model"), false)
  const cursor = buildInvocation("cursor", {
    prompt: "x",
    cwd: process.cwd(),
  })
  assert.equal(cursor.args.includes("--model"), false)
  const codex = buildInvocation("codex", {
    prompt: "x",
    cwd: process.cwd(),
  })
  assert.equal(codex.args.includes("--model"), false)
})

test("claude and grok get --effort; codex gets config", () => {
  const claude = buildInvocation("claude", {
    prompt: "x",
    cwd: process.cwd(),
    effort: "xhigh",
  })
  assert.equal(claude.args[claude.args.indexOf("--effort") + 1], "xhigh")

  const grok = buildInvocation("grok", {
    prompt: "x",
    cwd: process.cwd(),
    effort: "xhigh",
  })
  try {
    assert.equal(grok.args[grok.args.indexOf("--effort") + 1], "high")
  } finally {
    tmpCleanup(grok.promptFile)
  }

  const cursor = buildInvocation("cursor", {
    prompt: "x",
    cwd: process.cwd(),
    model: "composer",
    effort: "high",
  })
  assert.equal(cursor.args[cursor.args.indexOf("--model") + 1], "composer[effort=high]")

  const codex = buildInvocation("codex", {
    prompt: "x",
    cwd: process.cwd(),
    effort: "high",
  })
  assert.ok(codex.args.includes("-c"))
  assert.equal(codex.args[codex.args.indexOf("-c") + 1], 'model_reasoning_effort="high"')
})

test("streaming formats are used unless grok schema forces json", () => {
  const claude = buildInvocation("claude", { prompt: "x", cwd: process.cwd() })
  assert.equal(claude.args[claude.args.indexOf("--output-format") + 1], "stream-json")
  assert.ok(claude.args.includes("--verbose"))

  const cursor = buildInvocation("cursor", { prompt: "x", cwd: process.cwd() })
  assert.equal(cursor.args[cursor.args.indexOf("--output-format") + 1], "stream-json")

  const grok = buildInvocation("grok", { prompt: "x", cwd: process.cwd() })
  try {
    assert.equal(grok.args[grok.args.indexOf("--output-format") + 1], "streaming-json")
  } finally {
    tmpCleanup(grok.promptFile)
  }

  const schemaFile = path.join(os.tmpdir(), "cli-delegate-schema-stream.json")
  fs.writeFileSync(schemaFile, '{"type":"object"}')
  const grokSchema = buildInvocation("grok", {
    prompt: "x",
    cwd: process.cwd(),
    schema: schemaFile,
  })
  try {
    assert.equal(grokSchema.args[grokSchema.args.indexOf("--output-format") + 1], "json")
  } finally {
    tmpCleanup(grokSchema.promptFile)
    fs.rmSync(schemaFile, { force: true })
  }
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

test("extract result from grok streaming-json text deltas", () => {
  const text = [
    JSON.stringify({ type: "thought", data: "The" }),
    JSON.stringify({ type: "text", data: "ping" }),
    JSON.stringify({ type: "end", sessionId: "01a0-stream", stopReason: "end_turn" }),
  ].join("\n")
  assert.equal(extractSessionId(text), "01a0-stream")
  assert.equal(extractResultText(text), "ping")
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

test("extract last Codex agent_message, not command dumps", () => {
  const text = [
    JSON.stringify({ type: "thread.started", thread_id: "01abc-thread" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "item_0", type: "agent_message", text: "working" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_1",
        type: "command_execution",
        command: "rg CLAUDE_CONFIG_DIR",
        aggregated_output: "A".repeat(4000),
        status: "completed",
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "item_2", type: "agent_message", text: "the actual report" },
    }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } }),
  ].join("\n")
  assert.equal(extractSessionId(text), "01abc-thread")
  assert.equal(extractResultText(text), "the actual report")
  const interpreted = interpretOutput("codex", text, "Reading additional input from stdin...\n")
  assert.equal(interpreted.sessionId, "01abc-thread")
  assert.equal(interpreted.result, "the actual report")
})

test("extract session from grok/codex/cursor shapes", () => {
  assert.equal(
    extractSessionId(JSON.stringify({ session_id: "g-1", result: "hi" })),
    "g-1"
  )
  assert.equal(
    extractSessionId('{"type":"thread.started"}\n{"thread_id":"thread_abc","type":"item"}'),
    "thread_abc"
  )
  assert.equal(
    extractSessionId(JSON.stringify({ session: { sessionId: "nested-7" } })),
    "nested-7"
  )
  assert.equal(
    extractSessionId('chat_id = 01234567-89ab-cdef-0123-456789abcdef trailing'),
    "01234567-89ab-cdef-0123-456789abcdef"
  )
})

test("extra args land before prompt-file", () => {
  const grok = buildInvocation("grok", {
    prompt: "x",
    cwd: process.cwd(),
    extraArgs: ["--sandbox", "workspace"],
  })
  try {
    assert.ok(grok.args.includes("--sandbox"))
    assert.equal(grok.args[grok.args.indexOf("--sandbox") + 1], "workspace")
  } finally {
    tmpCleanup(grok.promptFile)
  }
})

test("long Claude prompts travel on stdin", () => {
  const prompt = "p".repeat(4000)
  const inv = buildInvocation("claude", { prompt, cwd: process.cwd() })
  assert.equal(inv.input, prompt)
  assert.equal(inv.args.includes(prompt), false)
})

test("session dir encoding matches on-disk names", () => {
  if (process.platform !== "win32") return
  assert.equal(encodeClaudeProjectDir("C:\\Users\\63036"), "C--Users-63036")
  assert.equal(
    encodeCursorProjectDir("D:\\code\\revisiting\\work\\cli-delegate"),
    "D-code-revisiting-work-cli-delegate"
  )
})
