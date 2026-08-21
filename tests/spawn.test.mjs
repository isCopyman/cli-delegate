import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import {
  escapeWinCmdArg,
  planSpawn,
  powershellExe,
  readNpmCmdShim,
} from "../skills/cli-delegate/scripts/lib/spawn.mjs"

test("escapeWinCmdArg quotes spaces so cmd does not split the prompt", () => {
  const escaped = escapeWinCmdArg("Smoke test. Do not use tools.")
  assert.equal(escaped.startsWith('^"') || escaped.startsWith('"'), true)
  assert.match(escaped, /\^?"$/)
  assert.equal(escaped.includes("Smoke"), true)
  assert.equal(escaped.includes("test."), true)
})

test("readNpmCmdShim resolves the node_modules js target", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-shim-"))
  try {
    const jsRel = path.join("node_modules", "@openai", "codex", "bin", "codex.js")
    const jsAbs = path.join(dir, jsRel)
    fs.mkdirSync(path.dirname(jsAbs), { recursive: true })
    fs.writeFileSync(jsAbs, "console.log(1)\n")
    const cmd = path.join(dir, "codex.CMD")
    fs.writeFileSync(
      cmd,
      `@ECHO off\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\n`
    )
    assert.equal(readNpmCmdShim(cmd), jsAbs)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("planSpawn unwraps cursor .cmd to powershell -File .ps1", () => {
  if (process.platform !== "win32") return
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-ps1-"))
  try {
    const cmd = path.join(dir, "agent.cmd")
    const ps1 = path.join(dir, "cursor-agent.ps1")
    fs.writeFileSync(cmd, "@echo off\n")
    fs.writeFileSync(ps1, "Write-Output 1\n")
    const planned = planSpawn(cmd, ["-p", "Smoke test. hello"], process.env)
    assert.match(planned.command.toLowerCase(), /pwsh(\.exe)?$|powershell\.exe$/)
    assert.equal(planned.args.includes("-File"), true)
    assert.equal(planned.args.includes(ps1), true)
    assert.equal(planned.args.at(-1), "Smoke test. hello")
    assert.equal(planned.shell, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("powershellExe prefers pwsh on PATH", () => {
  if (process.platform !== "win32") return
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-pwsh-"))
  try {
    const fake = path.join(dir, "pwsh.exe")
    fs.writeFileSync(fake, "")
    const resolved = powershellExe({
      ...process.env,
      PATH: dir,
      Path: dir,
      PATHEXT: ".EXE",
    })
    assert.equal(resolved.toLowerCase(), fake.toLowerCase())
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
