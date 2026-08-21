import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

export function which(command, env = process.env) {
  if (!command) return null
  if (path.isAbsolute(command) && fs.existsSync(command)) return command
  const pathValue = env.PATH || env.Path || ""
  const extList =
    process.platform === "win32"
      ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""]
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue
    for (const ext of extList) {
      const candidate = path.join(dir, command + ext)
      if (fs.existsSync(candidate)) return candidate
    }
    const bare = path.join(dir, command)
    if (fs.existsSync(bare)) return bare
  }
  return null
}

export function needsShell(binary) {
  if (process.platform !== "win32") return false
  const ext = path.extname(binary).toLowerCase()
  return ext === ".cmd" || ext === ".bat" || ext === ""
}

export function runProcess(binary, args, options = {}) {
  const cwd = options.cwd || process.cwd()
  const timeoutMs = options.timeoutMs ?? 600000
  const env = options.env ?? process.env
  const input = options.input

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(binary, args, {
        cwd,
        env,
        windowsHide: true,
        shell: needsShell(binary),
        stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"],
      })
    } catch (error) {
      resolve({
        exitCode: 127,
        stdout: "",
        stderr: error.message,
        pid: null,
      })
      return
    }

    let stdout = ""
    let stderr = ""
    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
    })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    if (input != null && child.stdin) {
      child.stdin.end(String(input))
    }

    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({
        exitCode: error.code === "ENOENT" ? 127 : 1,
        stdout,
        stderr: stderr || error.message,
        pid: child.pid ?? null,
      })
    })

    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout,
        stderr,
        pid: child.pid ?? null,
      })
    })
  })
}

export function writeTempPrompt(prompt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-delegate-"))
  const file = path.join(dir, "prompt.txt")
  fs.writeFileSync(file, String(prompt ?? ""), "utf8")
  return file
}
