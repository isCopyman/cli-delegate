import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"

import os from "node:os"

import { extractResultText, extractSessionId } from "./parse.mjs"
import { schemaArgs } from "./schema.mjs"
import { runProcess, which, writeTempPrompt } from "./spawn.mjs"

export const CLI_NAMES = ["grok", "cursor", "claude", "codex"]

export function normalizeCli(value) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
  if (raw === "cursor-agent" || raw === "cursor") return "cursor"
  if (raw === "claude-code" || raw === "claude") return "claude"
  if (CLI_NAMES.includes(raw)) return raw
  return null
}

export function detectHost(env = process.env) {
  if (env.CLAUDECODE === "1" || env.CLAUDE_CODE_ENTRYPOINT) return "claude"
  if (env.CODEX_HOME && env.CODEX_CI) return "codex"
  // Grok TUI injects GROK_SESSION_ID / GROK_AGENT=1; GROK_HOME is often unset.
  if (env.GROK_SESSION_ID || env.GROK_AGENT || env.GROK_HOME || env.GROK) {
    return "grok"
  }
  return null
}

function winCursorCandidates(env = process.env) {
  const local = env.LOCALAPPDATA
  if (!local) return []
  return [
    path.join(local, "cursor-agent", "agent.cmd"),
    path.join(local, "cursor-agent", "cursor-agent.cmd"),
    path.join(local, "cursor-agent", "agent.exe"),
  ]
}

export function resolveBinary(cli, env = process.env) {
  if (cli === "grok") {
    return env.GROK_BINARY || which("grok", env)
  }
  if (cli === "claude") {
    return env.CLAUDE_BINARY || which("claude", env)
  }
  if (cli === "codex") {
    return env.CODEX_BINARY || which("codex", env)
  }
  if (cli === "cursor") {
    if (env.CURSOR_AGENT_BIN) return env.CURSOR_AGENT_BIN
    const named = which("cursor-agent", env)
    if (named) return named
    for (const candidate of winCursorCandidates(env)) {
      if (fs.existsSync(candidate)) return candidate
    }
    return null
  }
  return null
}

export function normalizeEffort(raw) {
  const value = String(raw ?? "").trim().toLowerCase()
  return value || null
}

/** Map a unified effort string onto what each CLI actually accepts. */
export function effortForCli(cli, raw) {
  const effort = normalizeEffort(raw)
  if (!effort) return null
  if (cli === "grok") {
    if (effort === "xhigh" || effort === "max" || effort === "ultracode") return "high"
    return effort
  }
  if (cli === "claude") {
    if (effort === "ultracode") return "xhigh"
    return effort
  }
  if (cli === "codex") {
    if (effort === "max" || effort === "ultracode") return "xhigh"
    return effort
  }
  if (cli === "cursor") return effort
  return effort
}

export function cursorModelWithEffort(model, effort) {
  const base = model && String(model).trim() ? String(model).trim() : null
  if (!effort) return base
  // `auto[effort=…]` is rejected. Bracket params only apply to a real model id.
  if (!base || base.toLowerCase() === "auto") return base
  const match = base.match(/^([^[]+)\[(.*)\]$/)
  if (!match) return `${base}[effort=${effort}]`
  const params = match[2]
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !part.toLowerCase().startsWith("effort="))
  params.push(`effort=${effort}`)
  return `${match[1]}[${params.join(",")}]`
}

export function nestedHostBlocked(cli, options = {}, env = process.env) {
  if (options.allowNested) return false
  const host = detectHost(env)
  if (!host) return false
  if (cli === "claude" && host === "claude" && !options.settings) return true
  if (cli === "codex" && host === "codex") return true
  if (cli === "grok" && host === "grok") return true
  return false
}

export function buildInvocation(cli, options) {
  const prompt = String(options.prompt ?? "")
  const cwd = path.resolve(options.cwd || process.cwd())
  const write = options.readOnly ? false : options.write !== false
  const resumeId = options.resumeId || null
  const continueLast = Boolean(options.continueLast) && !resumeId
  const model = options.model || null
  const effort = effortForCli(cli, options.effort)
  const extra = Array.isArray(options.extraArgs) ? options.extraArgs.map(String) : []
  const longPrompt = prompt.length > 3500
  const assignedSessionId =
    options.assignedSessionId ||
    (!resumeId && !continueLast && (cli === "grok" || cli === "claude")
      ? crypto.randomUUID()
      : null)

  if (cli === "grok") {
    const args = ["--no-alt-screen"]
    if (resumeId) args.push("-r", resumeId)
    else if (continueLast) args.push("-c")
    else if (assignedSessionId) args.push("--session-id", assignedSessionId)
    args.push("--cwd", cwd)
    if (write) {
      args.push("--always-approve")
      args.push("--permission-mode", "bypassPermissions")
    } else {
      args.push("--permission-mode", "plan")
      args.push("--sandbox", "read-only")
    }
    if (model) args.push("--model", model)
    if (effort) args.push("--effort", effort)
    args.push("--output-format", options.schema ? "json" : "streaming-json")
    args.push(...extra)
    args.push(...schemaArgs(cli, options.schema))
    const promptFile = writeTempPrompt(prompt)
    args.push("--prompt-file", promptFile)
    return {
      args,
      assignedSessionId,
      promptFile,
      input: null,
      format: options.schema ? "json" : "streaming-json",
    }
  }

  if (cli === "claude") {
    const args = ["-p"]
    const input = longPrompt ? prompt : null
    if (!longPrompt) args.push(prompt)
    args.push("--output-format", "stream-json", "--verbose", "--bare")
    if (resumeId) args.push("-r", resumeId)
    else if (continueLast) args.push("-c")
    else if (assignedSessionId) args.push("--session-id", assignedSessionId)
    if (options.settings) args.push("--settings", options.settings)
    if (write) args.push("--dangerously-skip-permissions")
    else args.push("--permission-mode", "plan")
    if (model) args.push("--model", model)
    if (effort) args.push("--effort", effort)
    args.push(...extra)
    args.push(...schemaArgs(cli, options.schema))
    return { args, assignedSessionId, promptFile: null, input, format: "stream-json" }
  }

  if (cli === "cursor") {
    const args = ["-p", "--output-format", "stream-json", "--trust", "--workspace", cwd]
    if (resumeId) args.push("--resume", resumeId)
    else if (continueLast) args.push("--continue")
    if (write) args.push("--force")
    else args.push("--mode", "plan")
    const cursorModel = cursorModelWithEffort(model, effort)
    if (cursorModel) args.push("--model", cursorModel)
    args.push(...extra)
    args.push(...schemaArgs(cli, options.schema))
    return { args, assignedSessionId: null, promptFile: null, input: prompt, format: "stream-json" }
  }

  if (cli === "codex") {
    const args = ["exec", "--skip-git-repo-check", "-C", cwd, "--json"]
    if (write) args.push("--sandbox", "workspace-write")
    else args.push("--sandbox", "read-only")
    if (model) args.push("--model", model)
    if (effort) args.push("-c", `model_reasoning_effort="${effort}"`)
    args.push(...extra)
    args.push(...schemaArgs(cli, options.schema))
    const input = longPrompt ? prompt : null
    if (resumeId) args.push("resume", resumeId)
    else if (continueLast) args.push("resume", "--last")
    if (!longPrompt) args.push(prompt)
    return { args, assignedSessionId: null, promptFile: null, input, format: "jsonl" }
  }

  throw new Error(`Unsupported cli: ${cli}`)
}

export async function probeBinary(cli, binary, env = process.env) {
  const attempts = cli === "grok" ? [["version"], ["--version"]] : [["--version"]]
  let detail = ""
  for (const args of attempts) {
    const result = await runProcess(binary, args, {
      cwd: os.tmpdir(),
      timeoutMs: 8000,
      env,
    })
    detail = (result.stdout || result.stderr).trim().slice(0, 400)
    if (result.exitCode === 0) return { ok: true, detail }
  }
  return { ok: false, detail }
}

export function interpretOutput(cli, stdout, stderr, assignedSessionId) {
  const combined = `${stdout}\n${stderr}`
  return {
    sessionId: extractSessionId(stdout) || extractSessionId(combined) || assignedSessionId || null,
    result:
      extractResultText(stdout) ||
      extractResultText(stderr) ||
      extractResultText(combined) ||
      "",
  }
}

export function missingBinaryHint(cli) {
  if (cli === "cursor") {
    return "Install Cursor CLI (`curl https://cursor.com/install -fsS | bash`) or set CURSOR_AGENT_BIN. On Windows the binary is usually %LOCALAPPDATA%\\cursor-agent\\agent.cmd — prefer `cursor-agent`, not `agent`."
  }
  if (cli === "grok") return "Install Grok Build and ensure `grok` is on PATH, or set GROK_BINARY."
  if (cli === "claude") return "Install Claude Code so `claude` is on PATH, or set CLAUDE_BINARY."
  if (cli === "codex") return "Install Codex CLI so `codex` is on PATH, or set CODEX_BINARY."
  return `CLI '${cli}' was not found on PATH.`
}

export function defaultTimeoutMs() {
  return 600000
}

export function tmpCleanup(promptFile) {
  if (!promptFile) return
  try {
    fs.rmSync(path.dirname(promptFile), { recursive: true, force: true })
  } catch {
    // ignore
  }
}
