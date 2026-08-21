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

function touchWorkspace(state, cwd, cli, patch) {
  if (!cwd || !cli) return
  const key = cwdKey(cwd)
  if (!state.workspaces[key]) state.workspaces[key] = {}
  state.workspaces[key][cli] = { ...state.workspaces[key][cli], ...patch }
}

export function recordJob(job, env = process.env) {
  const state = loadState(env)
  const stamp = job.updatedAt ?? new Date().toISOString()
  const patch = {
    lastJobId: job.id,
    lastWorktreePath: job.worktreePath || null,
    lastWorktreeName: job.worktreeName || null,
    updatedAt: stamp,
  }
  if (job.sessionId) patch.lastSessionId = job.sessionId
  const sourceCwd = job.sourceCwd || job.cwd
  touchWorkspace(state, sourceCwd, job.cli, patch)
  if (job.cwd && cwdKey(job.cwd) !== cwdKey(sourceCwd)) {
    touchWorkspace(state, job.cwd, job.cli, patch)
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

export function lastWorktreePath(cli, cwd, env = process.env) {
  const state = loadState(env)
  const entry = state.workspaces[cwdKey(cwd)]?.[cli]
  return entry?.lastWorktreePath ?? null
}

export function findJobBySession(cli, sessionId, env = process.env) {
  if (!sessionId) return null
  return (
    loadState(env).jobs.find(
      (job) => job.cli === cli && job.sessionId === sessionId
    ) ?? null
  )
}

export class ResumeAmbiguousError extends Error {
  constructor(candidates) {
    super(
      `Multiple sessions for this cwd+cli. Pass --resume <sessionId> or --resume-last.`
    )
    this.candidates = candidates
  }
}

function candidateFromJob(job) {
  return {
    sessionId: job.sessionId,
    jobId: job.id,
    updatedAt: job.updatedAt || job.createdAt || null,
    promptPreview: job.promptPreview || null,
    worktreePath: job.worktreePath || null,
    worktreeName: job.worktreeName || null,
    status: job.status || null,
  }
}

export function listResumeCandidates(cli, cwd, env = process.env) {
  const jobs = listJobs({ cli, cwd, limit: MAX_JOBS }, env)
  const bySession = new Map()
  for (const job of jobs) {
    if (!job.sessionId) continue
    if (!bySession.has(job.sessionId)) bySession.set(job.sessionId, job)
  }
  const last = lastSession(cli, cwd, env)
  if (last && !bySession.has(last)) {
    const entry = loadState(env).workspaces[cwdKey(cwd)]?.[cli]
    bySession.set(last, {
      id: entry?.lastJobId || null,
      sessionId: last,
      updatedAt: entry?.updatedAt || null,
      worktreePath: entry?.lastWorktreePath || null,
      worktreeName: entry?.lastWorktreeName || null,
    })
  }
  return [...bySession.values()].map(candidateFromJob)
}

/**
 * Pick which child session to continue.
 * `resume` with no id: 0 recorded → vendor --continue; 1 → that id; 2+ → throw.
 * `--resume-last` is the explicit "use newest" override.
 */
export function resolveResumeTarget(options, env = process.env) {
  const cli = options.cli
  const cwd = options.cwd
  const candidates = listResumeCandidates(cli, cwd, env)
  if (options.fresh) {
    return { resumeId: null, continueLast: false, job: null, candidates }
  }
  if (options.resumeId) {
    return {
      resumeId: options.resumeId,
      continueLast: false,
      job: findJobBySession(cli, options.resumeId, env),
      candidates,
    }
  }
  if (options.continueLast) {
    const last = lastSession(cli, cwd, env) || candidates[0]?.sessionId || null
    return {
      resumeId: last,
      continueLast: !last,
      job: last ? findJobBySession(cli, last, env) : null,
      candidates,
    }
  }
  if (options.command !== "resume") {
    return { resumeId: null, continueLast: false, job: null, candidates }
  }
  if (candidates.length === 0) {
    return { resumeId: null, continueLast: true, job: null, candidates }
  }
  if (candidates.length === 1) {
    const sessionId = candidates[0].sessionId
    return {
      resumeId: sessionId,
      continueLast: false,
      job: findJobBySession(cli, sessionId, env),
      candidates,
    }
  }
  throw new ResumeAmbiguousError(candidates)
}

export function listJobs({ cli, cwd, limit = 10 } = {}, env = process.env) {
  const state = loadState(env)
  const key = cwd ? cwdKey(cwd) : null
  return state.jobs
    .filter((job) => (cli ? job.cli === cli : true))
    .filter((job) => {
      if (!key) return true
      return cwdKey(job.cwd) === key || cwdKey(job.sourceCwd || "") === key
    })
    .slice(0, limit)
}

export function getJob(id, env = process.env) {
  return loadState(env).jobs.find((job) => job.id === id) ?? null
}

export function jobsDir(env = process.env) {
  return path.join(homeDir(env), "jobs")
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
