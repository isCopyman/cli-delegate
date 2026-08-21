import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

const DEFAULT_LIMIT = 20

function grokHome(env = process.env) {
  return env.GROK_HOME || path.join(os.homedir(), ".grok")
}

function claudeHome(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")
}

function codexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex")
}

function cursorProjects(env = process.env) {
  return path.join(os.homedir(), ".cursor", "projects")
}

export function encodeClaudeProjectDir(cwd) {
  return path.resolve(cwd).replace(/[:/\\]/g, "-")
}

export function encodeCursorProjectDir(cwd) {
  return path
    .resolve(cwd)
    .replace(/^([A-Za-z]):[\\/]/, "$1-")
    .replace(/[\\/]/g, "-")
}

export function grokSessionGroupNames(cwd) {
  const resolved = path.resolve(cwd)
  const variants = [resolved, resolved.replace(/\\/g, "/"), resolved.replace(/\//g, "\\")]
  return [...new Set(variants.map((value) => encodeURIComponent(value)))]
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

function mtimeIso(file) {
  try {
    return fs.statSync(file).mtime.toISOString()
  } catch {
    return null
  }
}

function peekClaudeTitle(jsonlPath) {
  try {
    const chunk = fs.readFileSync(jsonlPath, { encoding: "utf8", flag: "r" }).slice(0, 8000)
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue
      let obj
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (obj?.type !== "user") continue
      const content = obj.message?.content
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.map((part) => part?.text || "").join("")
            : ""
      const title = text.replace(/\s+/g, " ").trim()
      if (title) return title.slice(0, 80)
    }
  } catch {
    // ignore
  }
  return null
}

function listGrok(cwd, limit, env) {
  const root = path.join(grokHome(env), "sessions")
  if (!fs.existsSync(root)) return []
  const groups = grokSessionGroupNames(cwd)
    .map((name) => path.join(root, name))
    .filter((dir) => fs.existsSync(dir))
  const out = []
  for (const group of groups) {
    let entries = []
    try {
      entries = fs.readdirSync(group, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(group, entry.name)
      const summary = readJson(path.join(dir, "summary.json")) || {}
      const info = summary.info && typeof summary.info === "object" ? summary.info : {}
      const id = info.id || entry.name
      const title =
        summary.generated_title || summary.session_summary || summary.last_turn_summary || null
      const updatedAt = summary.updated_at || summary.last_active_at || mtimeIso(dir)
      const transcript = path.join(dir, "updates.jsonl")
      out.push({
        id,
        title: title || null,
        updatedAt,
        path: fs.existsSync(transcript) ? transcript : dir,
      })
    }
  }
  return out
}

function listClaude(cwd, limit, env) {
  const dir = path.join(claudeHome(env), "projects", encodeClaudeProjectDir(cwd))
  if (!fs.existsSync(dir)) return []
  let files = []
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"))
  } catch {
    return []
  }
  return files.map((name) => {
    const file = path.join(dir, name)
    return {
      id: name.replace(/\.jsonl$/i, ""),
      title: peekClaudeTitle(file),
      updatedAt: mtimeIso(file),
      path: file,
    }
  })
}

function listCursor(cwd, limit, env) {
  const encoded = encodeCursorProjectDir(cwd)
  const lower = encoded.replace(/^([A-Z])-/, (all, letter) => `${letter.toLowerCase()}-`)
  const root = cursorProjects(env)
  const out = []
  for (const name of [...new Set([encoded, lower])]) {
    const dir = path.join(root, name, "agent-transcripts")
    if (!fs.existsSync(dir)) continue
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      out.push({
        id: entry.name.replace(/\.jsonl$/i, ""),
        title: null,
        updatedAt: mtimeIso(target),
        path: target,
      })
    }
  }
  return out
}

function cwdMatches(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

function readFirstLine(file, maxBytes = 1024 * 1024) {
  const fd = fs.openSync(file, "r")
  try {
    const chunk = Buffer.alloc(64 * 1024)
    let acc = ""
    let pos = 0
    while (acc.length < maxBytes) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos)
      if (n <= 0) break
      pos += n
      acc += chunk.toString("utf8", 0, n)
      const nl = acc.search(/\r?\n/)
      if (nl >= 0) return acc.slice(0, nl)
    }
    return acc
  } finally {
    fs.closeSync(fd)
  }
}

/** Codex stores rollouts as ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl — by date, not project. */
function listCodexDayDirs(root) {
  const days = []
  let years = []
  try {
    years = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return days
  }
  for (const year of years) {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue
    const yearDir = path.join(root, year.name)
    let months = []
    try {
      months = fs.readdirSync(yearDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const month of months) {
      if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) continue
      const monthDir = path.join(yearDir, month.name)
      let monthDays = []
      try {
        monthDays = fs.readdirSync(monthDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const day of monthDays) {
        if (!day.isDirectory() || !/^\d{2}$/.test(day.name)) continue
        days.push(path.join(monthDir, day.name))
      }
    }
  }
  days.sort((left, right) => right.localeCompare(left))
  return days
}

function listCodex(cwd, limit, env) {
  const root = path.join(codexHome(env), "sessions")
  if (!fs.existsSync(root)) return []
  const cap = Number(limit) > 0 ? Number(limit) : DEFAULT_LIMIT
  const out = []
  for (const dir of listCodexDayDirs(root)) {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((left, right) => right.name.localeCompare(left.name))
    for (const entry of entries) {
      if (entry.isDirectory()) continue
      if (!entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) continue
      const full = path.join(dir, entry.name)
      let first = ""
      try {
        first = readFirstLine(full)
      } catch {
        continue
      }
      let obj
      try {
        obj = JSON.parse(first)
      } catch {
        continue
      }
      const payload = obj.payload && typeof obj.payload === "object" ? obj.payload : obj
      const sessionCwd = payload.cwd
      if (sessionCwd && !cwdMatches(sessionCwd, cwd)) continue
      const id =
        payload.id ||
        entry.name.replace(/^rollout-.*?-/, "").replace(/\.jsonl$/i, "")
      out.push({
        id,
        title: null,
        updatedAt: payload.timestamp || obj.timestamp || mtimeIso(full),
        path: full,
      })
      if (out.length >= cap) return out
    }
  }
  return out
}

export function listNativeSessions(cli, cwd, options = {}, env = process.env) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : DEFAULT_LIMIT
  const resolved = path.resolve(cwd || process.cwd())
  let rows = []
  if (cli === "grok") rows = listGrok(resolved, limit, env)
  else if (cli === "claude") rows = listClaude(resolved, limit, env)
  else if (cli === "cursor") rows = listCursor(resolved, limit, env)
  else if (cli === "codex") rows = listCodex(resolved, limit, env)
  else return []
  const seen = new Set()
  return rows
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    .filter((row) => {
      if (seen.has(row.id)) return false
      seen.add(row.id)
      return true
    })
    .slice(0, limit)
}
