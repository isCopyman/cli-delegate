import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

/**
 * How long a delegated run may take before it is killed.
 *
 * 50 minutes: 10/15/25 were all still short for Codex (read the tree, edit,
 * then cargo and vitest). A kill turns finished work into a `partial` with
 * no report. A timeout only truncates, so the generous value costs nothing
 * when a child finishes early.
 */
export const DEFAULT_TIMEOUT_MS = 3000000

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

const WIN_META = /([()\][%!^"`<>&|;, *?])/g

export function needsShell(binary) {
  if (process.platform !== "win32") return false
  const ext = path.extname(binary).toLowerCase()
  return ext === ".cmd" || ext === ".bat" || ext === ".ps1" || ext === ""
}

export function escapeWinCmdCommand(command) {
  return String(command).replace(WIN_META, "^$1")
}

export function escapeWinCmdArg(arg, doubleEscape = false) {
  let value = String(arg)
  value = value.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"")
  value = value.replace(/(?=(\\+?)?)\1$/, "$1$1")
  value = `"${value}"`
  value = value.replace(WIN_META, "^$1")
  if (doubleEscape) value = value.replace(WIN_META, "^$1")
  return value
}

export function readNpmCmdShim(cmdPath) {
  try {
    const text = fs.readFileSync(cmdPath, "utf8")
    const match = text.match(/"%dp0%\\node_modules\\([^"]+\.js)"/i)
    if (!match) return null
    const jsPath = path.join(path.dirname(cmdPath), "node_modules", match[1])
    return fs.existsSync(jsPath) ? jsPath : null
  } catch {
    return null
  }
}

export function powershellExe(env = process.env) {
  const pwsh = which("pwsh", env)
  if (pwsh) return pwsh
  // Last resort only. This machine and install.ps1 are PowerShell 7 (`pwsh`).
  const rooted = which("powershell", env)
  if (rooted) return rooted
  const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows"
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

/**
 * Keep argv intact on Windows. `.cmd` through `shell: true` splits prompts
 * on spaces (`codex exec` saw `test.` as a flag).
 */
export function planSpawn(binary, args, env = process.env) {
  if (process.platform !== "win32") {
    return { command: binary, args, shell: false, windowsVerbatimArguments: false }
  }
  const ext = path.extname(binary).toLowerCase()
  if (ext === ".exe" || ext === ".com") {
    return { command: binary, args, shell: false, windowsVerbatimArguments: false }
  }
  if (ext === ".ps1") {
    return {
      command: powershellExe(env),
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", binary, ...args],
      shell: false,
      windowsVerbatimArguments: false,
    }
  }
  if (ext === ".cmd" || ext === ".bat") {
    const dir = path.dirname(binary)
    const siblingPs1 = path.join(dir, `${path.basename(binary, ext)}.ps1`)
    const cursorPs1 = path.join(dir, "cursor-agent.ps1")
    const ps1 = fs.existsSync(siblingPs1)
      ? siblingPs1
      : fs.existsSync(cursorPs1)
        ? cursorPs1
        : null
    if (ps1) {
      return {
        command: powershellExe(env),
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, ...args],
        shell: false,
        windowsVerbatimArguments: false,
      }
    }
    const npmJs = readNpmCmdShim(binary)
    if (npmJs) {
      return {
        command: env.NODE_BINARY || process.execPath,
        args: [npmJs, ...args],
        shell: false,
        windowsVerbatimArguments: false,
      }
    }
    const doubleEscape = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i.test(binary)
    const line = [
      escapeWinCmdCommand(path.normalize(binary)),
      ...args.map((arg) => escapeWinCmdArg(arg, doubleEscape)),
    ].join(" ")
    return {
      command: env.ComSpec || env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", `"${line}"`],
      shell: false,
      windowsVerbatimArguments: true,
    }
  }
  return { command: binary, args, shell: true, windowsVerbatimArguments: false }
}

export function killProcessTree(pid) {
  const n = Number(pid)
  if (!Number.isFinite(n) || n <= 0) return
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(n), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    })
    return
  }
  try {
    process.kill(n, "SIGTERM")
  } catch {
    // already gone
  }
}

export function pidRunning(pid) {
  const n = Number(pid)
  if (!Number.isFinite(n) || n <= 0) return false
  try {
    process.kill(n, 0)
    return true
  } catch (error) {
    return error && error.code === "EPERM"
  }
}

export function readExtendUntil(extendPath) {
  if (!extendPath) return null
  try {
    const raw = JSON.parse(fs.readFileSync(extendPath, "utf8"))
    const until = Number(raw?.until)
    return Number.isFinite(until) && until > 0 ? until : null
  } catch {
    return null
  }
}

export function writeExtendUntil(extendPath, until) {
  const dir = path.dirname(extendPath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `${path.basename(extendPath)}.${process.pid}.tmp`)
  fs.writeFileSync(tmp, `${JSON.stringify({ until: Number(until) })}\n`, "utf8")
  fs.renameSync(tmp, extendPath)
}

export function runProcess(binary, args, options = {}) {
  const cwd = options.cwd || process.cwd()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const env = options.env ?? process.env
  const input = options.input

  return new Promise((resolve) => {
    let child
    try {
      const planned = planSpawn(binary, args, env)
      child = spawn(planned.command, planned.args, {
        cwd,
        env,
        windowsHide: true,
        shell: planned.shell,
        windowsVerbatimArguments: planned.windowsVerbatimArguments,
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
    // Default off: the host shell would otherwise ingest the child's full
    // stdout/stderr as the tool result. Final JSON belongs on this process's
    // stdout after interpretOutput.
    const forward = options.forward === true
    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk) => {
      stdout += chunk
      if (forward) process.stderr.write(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
      if (forward) process.stderr.write(chunk)
    })

    if (typeof options.onSpawn === "function") {
      try {
        options.onSpawn(child.pid)
      } catch {
        // bookkeeping must not kill the child
      }
    }

    let timedOut = false
    let deadline = Date.now() + timeoutMs
    const extendPath = options.extendPath || null
    const tick = setInterval(() => {
      if (timedOut) return
      const until = readExtendUntil(extendPath)
      if (until && until > deadline) deadline = until
      if (Date.now() < deadline) return
      timedOut = true
      killProcessTree(child.pid)
    }, 250)

    if (input != null && child.stdin) {
      child.stdin.end(String(input))
    }

    child.on("error", (error) => {
      clearInterval(tick)
      resolve({
        exitCode: error.code === "ENOENT" ? 127 : 1,
        stdout,
        stderr: stderr || error.message,
        pid: child.pid ?? null,
      })
    })

    child.on("close", (code) => {
      clearInterval(tick)
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
