import path from "node:path"
import process from "node:process"

/**
 * Git Bash / MSYS (`/d/code/foo`, `//c/Users/x`) and `C:/foo` → Win32.
 * Leave Unix paths and relative paths alone.
 */
export function win32FromHostPath(input, platform = process.platform) {
  const raw = String(input ?? "").trim()
  if (!raw) return raw
  if (platform !== "win32") return raw

  const slashed = raw.replace(/\\/g, "/")
  const msys = slashed.match(/^\/\/?([a-zA-Z])\/(.*)$/)
  if (msys) {
    return path.win32.resolve(`${msys[1].toUpperCase()}:/${msys[2]}`)
  }
  if (/^[a-zA-Z]:/.test(slashed)) {
    return path.win32.resolve(slashed)
  }
  return path.win32.resolve(raw)
}
