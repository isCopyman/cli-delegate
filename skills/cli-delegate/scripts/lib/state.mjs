import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const MAX_JOBS = 80

export function homeDir(env = process.env) {
  if (env.CLI_DELEGATE_HOME) return path.resolve(env.CLI_DELEGATE_HOME)
  if (process.platform === "win32") {
    const base = env.LOCALAPPDATA || os.homedir()
    return path.join(base, "cli-delegate")
  }
  return path.join(os.homedir(), ".local", "share", "cli-delegate")
}

export function cwdKey(cwd) {
  const resolved = path.resolve(cwd)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export function generateJobId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function emptyState() {
  return { workspaces: {}, jobs: [] }
}

export function statePath(env = process.env) {
  return path.join(homeDir(env), "state.json")
}

export function loadState(env = process.env) {
  const file = statePath(env)
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
    if (!parsed || typeof parsed !== "object") return emptyState()
    return {
      workspaces: parsed.workspaces && typeof parsed.workspaces === "object" ? parsed.workspaces : {},
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    }
  } catch {
    return emptyState()
  }
}

export function saveState(state, env = process.env) {
  const dir = homeDir(env)
  fs.mkdirSync(dir, { recursive: true })
  const next = {
    workspaces: state.workspaces ?? {},
    jobs: (state.jobs ?? []).slice(0, MAX_JOBS),
  }
  fs.writeFileSync(statePath(env), `${JSON.stringify(next, null, 2)}\n`, "utf8")
}

export function recordJob(job, env = process.env) {
  const state = loadState(env)
  const key = cwdKey(job.cwd)
  if (!state.workspaces[key]) state.workspaces[key] = {}
  if (job.sessionId) {
    state.workspaces[key][job.cli] = {
      lastSessionId: job.sessionId,
      lastJobId: job.id,
      updatedAt: job.updatedAt ?? new Date().toISOString(),
    }
  }
  state.jobs = [job, ...state.jobs.filter((item) => item.id !== job.id)].slice(0, MAX_JOBS)
  saveState(state, env)
  return job
}

export function lastSession(cli, cwd, env = process.env) {
  const state = loadState(env)
  const entry = state.workspaces[cwdKey(cwd)]?.[cli]
  return entry?.lastSessionId ?? null
}

export function listJobs({ cli, cwd, limit = 10 } = {}, env = process.env) {
  const state = loadState(env)
  const key = cwd ? cwdKey(cwd) : null
  return state.jobs
    .filter((job) => (cli ? job.cli === cli : true))
    .filter((job) => (key ? cwdKey(job.cwd) === key : true))
    .slice(0, limit)
}

export function getJob(id, env = process.env) {
  return loadState(env).jobs.find((job) => job.id === id) ?? null
}

export function jobsDir(env = process.env) {
  return path.join(homeDir(env), "jobs")
}

export function jobLogPath(id, env = process.env) {
  return path.join(jobsDir(env), `${id}.log`)
}

export function jobResultPath(id, env = process.env) {
  return path.join(jobsDir(env), `${id}.result.txt`)
}

export function readJobResult(id, env = process.env) {
  try {
    return fs.readFileSync(jobResultPath(id, env), "utf8")
  } catch {
    return null
  }
}

export function writeJobResult(id, text, env = process.env) {
  const dir = jobsDir(env)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(jobResultPath(id, env), String(text ?? ""), "utf8")
}
