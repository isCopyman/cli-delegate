import assert from "node:assert/strict"
import { test } from "node:test"

import {
  modelListArgs,
  parseCodexModels,
  parseCursorModels,
  parseGrokModels,
  parseModelList,
} from "../skills/cli-delegate/scripts/lib/models.mjs"

test("parse grok models text", () => {
  const text = `You are logged in with grok.com.

Default model: grok-4.6

Available models:
  * grok-4.6 (default)
  - grok-4.5
`
  const parsed = parseGrokModels(text)
  assert.equal(parsed.default, "grok-4.6")
  assert.deepEqual(
    parsed.models.map((m) => m.id),
    ["grok-4.6", "grok-4.5"]
  )
  assert.equal(parsed.models[0].default, true)
})

test("parse cursor models text", () => {
  const text = `Available models

auto - Auto (default)
gpt-5.3-codex - Codex 5.3
composer-2.5 - Composer 2.5
`
  const parsed = parseCursorModels(text)
  assert.equal(parsed.default, "auto")
  assert.equal(parsed.models[0].id, "auto")
  assert.equal(parsed.models[1].id, "gpt-5.3-codex")
  assert.equal(parsed.models[1].label, "Codex 5.3")
})

test("parse codex debug models json slugs only", () => {
  const text = JSON.stringify({
    models: [
      {
        slug: "gpt-5.6-sol",
        display_name: "GPT-5.6-Sol",
        priority: 1,
        visibility: "list",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "xhigh" }],
        model_messages: { instructions_template: "huge" },
      },
      {
        slug: "hidden-one",
        visibility: "hidden",
      },
    ],
  })
  const parsed = parseCodexModels(text)
  assert.equal(parsed.default, "gpt-5.6-sol")
  assert.equal(parsed.models.length, 1)
  assert.equal(parsed.models[0].id, "gpt-5.6-sol")
  assert.deepEqual(parsed.models[0].efforts, ["low", "high", "xhigh"])
  assert.equal(JSON.stringify(parsed).includes("huge"), false)
})

test("claude has no list command and no frozen catalog", () => {
  const spec = modelListArgs("claude")
  assert.equal(spec.unsupported, true)
  assert.equal(spec.args, null)
  const parsed = parseModelList("claude", "")
  assert.equal(parsed.models.length, 0)
  assert.equal(parsed.default, null)
})

test("grok and cursor list from vendor argv", () => {
  assert.deepEqual(modelListArgs("grok").args, ["models"])
  assert.deepEqual(modelListArgs("cursor").args, ["models"])
  assert.deepEqual(modelListArgs("codex").args, ["debug", "models"])
})
