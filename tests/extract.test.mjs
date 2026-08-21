import assert from "node:assert/strict"
import { test } from "node:test"

import { extractTurns, formatTurns } from "../skills/cli-delegate/scripts/lib/extract.mjs"

test("extracts Claude-style jsonl user/assistant text", () => {
  const raw = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "fix the flake" }] },
    }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "I will look at the test." }] },
    }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
    }),
  ].join("\n")
  const turns = extractTurns(raw)
  assert.equal(turns.length, 2)
  assert.equal(turns[0].role, "user")
  assert.equal(turns[0].text, "fix the flake")
  assert.equal(turns[1].role, "assistant")
  assert.match(turns[1].text, /look at the test/)
})

test("merges Grok ACP assistant chunks", () => {
  const raw = [
    JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } }),
    JSON.stringify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: " world" } }),
  ].join("\n")
  const turns = extractTurns(raw)
  assert.equal(turns.length, 1)
  assert.equal(turns[0].text, "Hello world")
})

test("formatTurns keeps the tail when over max chars", () => {
  const text = formatTurns(
    [
      { role: "user", text: "AAAA" },
      { role: "assistant", text: "BBBB" },
    ],
    10
  )
  assert.equal(text.length, 10)
})
