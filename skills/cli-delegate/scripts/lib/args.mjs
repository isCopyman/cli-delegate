import fs from "node:fs"
import path from "node:path"
import process from "node:process"

import { win32FromHostPath } from "./paths.mjs"

export class ArgError extends Error {}

function nextValue(rest, i, token) {
  const value = rest[i + 1]
  if (value === undefined) throw new ArgError(`Missing value for ${token}`)
  return value
}

/**
 * Parse cli-delegate argv (without the node/script prefix).
 * Throws ArgError on bad flags. Does not read --prompt-file contents.
 */
export function parseArgv(argv) {
  let [command, ...rest] = argv
  if (command === "--help" || command === "-h") {
    return {
      command: "help",
      positional: [],
      timeoutMs: 600000,
      maxChars: 8000,
      extraArgs: [],
      help: true,
    }
  }
  const options = {
    command: command || "",
    positional: [],
    timeoutMs: 600000,
    maxChars: 8000,
    extraArgs: [],
  }
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    const next = () => {
      const value = nextValue(rest, i, token)
      i += 1
      return value
    }
    if (token === "--cli") options.cli = next()
    else if (token === "--cwd") options.cwd = next()
    else if (token === "--model") options.model = next()
    else if (token === "--effort") options.effort = next()
    else if (token === "--settings") options.settings = next()
    else if (token === "--resume") options.resumeId = next()
    else if (token === "--id") options.resumeId = next()
    else if (token === "--file") options.file = next()
    else if (token === "--prompt-file") options.promptFile = next()
    else if (token === "--schema") options.schema = next()
    else if (token === "--worktree-name") {
      options.worktreeName = next()
      options.worktree = true
    }
    else if (token === "--max-chars") options.maxChars = Number(next())
    else if (token === "--timeout") options.timeoutMs = Number(next())
    else if (token === "--resume-last") options.continueLast = true
    else if (token === "--fresh") options.fresh = true
    else if (token === "--read-only") options.readOnly = true
    else if (token === "--allow-nested") options.allowNested = true
    else if (token === "--worktree") options.worktree = true
    else if (token === "--allow-stale") options.allowStale = true
    else if (token === "--help" || token === "-h") options.help = true
    else if (token === "--") {
      options.extraArgs = rest.slice(i + 1)
      break
    } else if (token.startsWith("--")) {
      throw new ArgError(`Unknown option ${token}`)
    } else {
      options.positional.push(token)
    }
  }
  options.prompt = options.positional.join(" ").trim()
  options.cwd = path.resolve(win32FromHostPath(options.cwd || process.cwd()))
  if (options.settings) options.settings = win32FromHostPath(options.settings)
  if (options.file) options.file = win32FromHostPath(options.file)
  if (options.promptFile) options.promptFile = win32FromHostPath(options.promptFile)
  if (options.schema) options.schema = win32FromHostPath(options.schema)
  return options
}

export function loadPrompt(options) {
  const command = options.command
  if (
    (command === "run" || command === "resume") &&
    options.file &&
    !options.promptFile
  ) {
    throw new ArgError(
      "--file is for extract. Pass the task brief with --prompt-file."
    )
  }
  if (options.promptFile) {
    if (options.prompt) {
      throw new ArgError("Pass either --prompt-file or a positional prompt, not both.")
    }
    let text
    try {
      text = fs.readFileSync(options.promptFile, "utf8")
    } catch (error) {
      throw new ArgError(`Cannot read --prompt-file ${options.promptFile}: ${error.message}`)
    }
    const prompt = text.replace(/^\uFEFF/, "")
    if (!prompt.trim()) throw new ArgError("--prompt-file is empty.")
    return prompt
  }
  return options.prompt || ""
}
