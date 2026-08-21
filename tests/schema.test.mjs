import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { ArgError } from "../skills/cli-delegate/scripts/lib/args.mjs"
import {
  buildInvocation,
  tmpCleanup,
} from "../skills/cli-delegate/scripts/lib/backends.mjs"
import { schemaArgs } from "../skills/cli-delegate/scripts/lib/schema.mjs"

function writeSchema() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-schema-"))
  const file = path.join(dir, "schema.json")
  fs.writeFileSync(
    file,
    JSON.stringify({
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    })
  )
  return { dir, file }
}

test("schemaArgs maps per cli", () => {
  const { dir, file } = writeSchema()
  try {
    const grok = schemaArgs("grok", file)
    assert.equal(grok[0], "--json-schema")
    assert.equal(JSON.parse(grok[1]).properties.answer.type, "string")

    const claude = schemaArgs("claude", file)
    assert.equal(claude[0], "--json-schema")

    const codex = schemaArgs("codex", file)
    assert.deepEqual(codex, ["--output-schema", file])

    assert.throws(() => schemaArgs("cursor", file), ArgError)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("buildInvocation puts schema on grok/claude/codex argv", () => {
  const { dir, file } = writeSchema()
  try {
    const grok = buildInvocation("grok", {
      prompt: "x",
      cwd: process.cwd(),
      schema: file,
    })
    try {
      assert.equal(grok.args[grok.args.indexOf("--json-schema") + 1].includes('"answer"'), true)
    } finally {
      tmpCleanup(grok.promptFile)
    }

    const claude = buildInvocation("claude", {
      prompt: "x",
      cwd: process.cwd(),
      schema: file,
    })
    assert.equal(claude.args.includes("--json-schema"), true)

    const codex = buildInvocation("codex", {
      prompt: "x",
      cwd: process.cwd(),
      continueLast: true,
      schema: file,
    })
    const schemaAt = codex.args.indexOf("--output-schema")
    const resumeAt = codex.args.indexOf("resume")
    assert.ok(schemaAt >= 0)
    assert.ok(resumeAt > schemaAt)
    assert.equal(codex.args[schemaAt + 1], file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
