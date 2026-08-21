#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import { ArgError, loadPrompt, parseArgv } from "./lib/args.mjs"
import {
  buildInvocation,
  interpretOutput,
  missingBinaryHint,
  nestedHostBlocked,
  normalizeCli,
  probeBinary,
  resolveBinary,
  tmpCleanup,
} from "./lib/backends.mjs"
import { extractTranscript } from "./lib/extract.mjs"
import { previewPrompt } from "./lib/parse.mjs"
import { listNativeSessions } from "./lib/sessions.mjs"
import { loadSchemaObject } from "./lib/schema.mjs"
import { killProcessTree, pidAlive, runProcess } from "./lib/spawn.mjs"
import { prepareWorktree } from "./lib/worktree.mjs"
import {
  generateJobId,
  getJob,
  jobLogPath,
  lastSession,
  listJobs,
  readJobResult,
  recordJob,
  writeJobResult,
} from "./lib/state.mjs"

const USAGE = `Usage:
  node cli-delegate.mjs run --cli <grok|cursor|claude|codex> [options] <prompt>
  node cli-delegate.mjs resume --cli <grok|cursor|claude|codex> [--id <session>] [prompt]
  node cli-delegate.mjs status [--cli <name>] [--cwd <dir>]
  node cli-delegate.mjs show <jobId>
  node cli-delegate.mjs log <jobId>
  node cli-delegate.mjs stop <jobId>
  node cli-delegate.mjs extract --file <jsonl> [--max-chars N]
  node cli-delegate.mjs sessions --cli <name> [--cwd <dir>]
  node cli-delegate.mjs which --cli <name>

Options for run/resume:
  --cwd <dir>            Workspace (default: current directory)
  --prompt-file <path>   Task brief from a file (prefer this over a quoted prompt)
  --schema <file>        JSON Schema file. Grok/Claude: --json-schema; Codex: --output-schema
  --worktree             Isolated git worktree at <repo>/.cli-delegate/worktrees/<cli>
  --worktree-name <slug> Worktree folder/branch suffix (default: the --cli name)
  --allow-stale          Allow a worktree that is behind the source HEAD
  --model <id>           Model override
  --effort <level>       Unified effort: low|medium|high|xhigh|max
  --settings <file>      Claude --settings JSON (third-party endpoint)
  --read-only            Plan/review mode, no edits
  --resume-last          Continue last session for this cwd+cli
  --resume <id>          Continue a specific session id
  --fresh                Force a new session
  --allow-nested         Allow spawning the same CLI as the current host
  --background           Return jobId immediately; poll status / log / stop
  --timeout <ms>         Kill after this many milliseconds (default 600000)
  --                     Extra argv passed through to the child CLI
`

const selfPath = fileURLToPath(import.meta.url)

function fail(message, extra = {}) {
  process.stdout.write(
    `${JSON.stringify({ status: "error", error: message, ...extra }, null, 2)}\n`
  )
  process.exit(1)
}

function parseArgs(argv) {
  try {
    return parseArgv(argv)
  } catch (error) {
    fail(error instanceof ArgError ? error.message : error.message)
  }
}

function requireCli(raw) {
  const cli = normalizeCli(raw)
  if (!cli) fail(`Unknown --cli '${raw}'. Use grok, cursor, claude, or codex.`)
  return cli
}

function prepareDelegate(options) {
  const cli = requireCli(options.cli)
  let prompt
  try {
    prompt = loadPrompt(options)
  } catch (error) {
    fail(error instanceof ArgError ? error.message : error.message)
  }
  if (
    !prompt &&
    (options.continueLast || options.resumeId || options.command === "resume")
  ) {
    prompt =
      "Continue from the current thread state. Pick the next highest-value step and follow through until the task is resolved."
  }
  if (!prompt) fail("A prompt is required. Pass a positional prompt or --prompt-file.")

  if (nestedHostBlocked(cli, options)) {
    fail(
      `Refusing to nest ${cli} inside the same host. Pass --allow-nested, or pick another --cli. For third-party Claude, pass --settings.`
    )
  }

  const binary = resolveBinary(cli)
  if (!binary) fail(missingBinaryHint(cli), { cli })

  const warnings = []
  if (options.schema) {
    try {
      loadSchemaObject(options.schema)
    } catch (error) {
      fail(error instanceof ArgError ? error.message : error.message)
    }
  }

  if (options.worktree) {
    try {
      const worktree = prepareWorktree({
        cwd: options.cwd,
        cli,
        name: options.worktreeName,
        allowStale: options.allowStale,
      })
      options.cwd = worktree.cwd
      options.worktreePath = worktree.cwd
      options.sourceHead = worktree.sourceHead
      options.worktreeHead = worktree.worktreeHead
      warnings.push(...worktree.warnings)
      if (worktree.created) {
        warnings.push(`created worktree ${worktree.cwd} at ${worktree.sourceHead.slice(0, 8)}`)
      }
    } catch (error) {
      fail(error instanceof ArgError ? error.message : error.message)
    }
  }

  let resumeId = options.fresh ? null : options.resumeId || null
  let continueLast = Boolean(options.continueLast) && !resumeId && !options.fresh
  if (!resumeId && !continueLast && !options.fresh && options.command === "resume") {
    resumeId = lastSession(cli, options.cwd)
    if (!resumeId) continueLast = true
  }

  return { cli, prompt, binary, resumeId, continueLast, warnings }
}

async function executePrepared(prepared, options, jobId) {
  let invocation
  try {
    invocation = buildInvocation(prepared.cli, {
      prompt: prepared.prompt,
      cwd: options.cwd,
      write: !options.readOnly,
      readOnly: options.readOnly,
      resumeId: prepared.resumeId,
      continueLast: prepared.continueLast,
      model: options.model,
      effort: options.effort,
      settings: options.settings,
      extraArgs: options.extraArgs,
      schema: options.schema,
    })
  } catch (error) {
    fail(error instanceof ArgError ? error.message : error.message)
  }

  let spawned
  try {
    spawned = await runProcess(prepared.binary, invocation.args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      input: invocation.input,
      onSpawn: (pid) => {
        const current = getJob(jobId)
        if (current) {
          recordJob({ ...current, childPid: pid, pid, updatedAt: new Date().toISOString() })
        }
      },
    })
  } finally {
    tmpCleanup(invocation.promptFile)
  }

  const interpreted = interpretOutput(
    prepared.cli,
    spawned.stdout,
    spawned.stderr,
    invocation.assignedSessionId
  )
  const status = spawned.exitCode === 0 ? "success" : spawned.exitCode === 124 ? "partial" : "error"
  return { spawned, interpreted, status, resumeId: prepared.resumeId, continueLast: prepared.continueLast }
}

function spawnWorker(jobId, logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const fd = fs.openSync(logFile, "a")
  const child = spawn(process.execPath, [selfPath, "_worker", jobId], {
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    env: process.env,
  })
  child.unref()
  fs.closeSync(fd)
  return child.pid
}

function startBackground(options, prepared) {
  const jobId = generateJobId()
  const startedAt = new Date().toISOString()
  const logFile = jobLogPath(jobId)
  const job = {
    id: jobId,
    cli: prepared.cli,
    cwd: options.cwd,
    binary: prepared.binary,
    prompt: prepared.prompt,
    readOnly: Boolean(options.readOnly),
    resumeId: prepared.resumeId || null,
    continueLast: Boolean(prepared.continueLast),
    model: options.model || null,
    effort: options.effort || null,
    settings: options.settings || null,
    extraArgs: options.extraArgs || [],
    schema: options.schema || null,
    timeoutMs: options.timeoutMs,
    sessionId: null,
    continued: Boolean(prepared.resumeId || prepared.continueLast),
    status: "running",
    background: true,
    logFile,
    promptPreview: previewPrompt(prepared.prompt),
    createdAt: startedAt,
    updatedAt: startedAt,
    pid: null,
    workerPid: null,
    childPid: null,
  }
  recordJob(job)
  const workerPid = spawnWorker(jobId, logFile)
  recordJob({ ...getJob(jobId), workerPid, pid: workerPid, updatedAt: new Date().toISOString() })
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "running",
        cli: prepared.cli,
        cwd: options.cwd,
        jobId,
        continued: job.continued,
        logFile,
        warnings: prepared.warnings || [],
        worktreePath: options.worktreePath || null,
      },
      null,
      2
    )}\n`
  )
  process.exit(0)
}

async function runDelegate(options) {
  const prepared = prepareDelegate(options)
  if (options.background) {
    startBackground(options, prepared)
    return
  }

  const jobId = generateJobId()
  const startedAt = new Date().toISOString()
  const { spawned, interpreted, status, resumeId, continueLast } = await executePrepared(
    prepared,
    options,
    jobId
  )
  const job = {
    id: jobId,
    cli: prepared.cli,
    cwd: options.cwd,
    binary: prepared.binary,
    sessionId: interpreted.sessionId,
    resumeId: resumeId || null,
    continued: Boolean(resumeId || continueLast),
    status,
    exitCode: spawned.exitCode,
    promptPreview: previewPrompt(prepared.prompt),
    createdAt: startedAt,
    updatedAt: new Date().toISOString(),
    pid: spawned.pid,
    childPid: spawned.pid,
    background: false,
  }
  writeJobResult(jobId, interpreted.result)
  recordJob(job)

  const payload = {
    status,
    cli: prepared.cli,
    cwd: options.cwd,
    jobId,
    sessionId: interpreted.sessionId,
    continued: job.continued,
    exitCode: spawned.exitCode,
    result: interpreted.result,
    warnings: prepared.warnings || [],
    worktreePath: options.worktreePath || null,
  }
  if (status !== "success") {
    payload.error = spawned.stderr.trim() || `exit ${spawned.exitCode}`
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exit(status === "success" ? 0 : spawned.exitCode === 124 ? 124 : 1)
}

async function cmdWorker(jobId) {
  const job = getJob(jobId)
  if (!job) fail(`Unknown job ${jobId}`)
  const options = {
    command: job.continueLast || job.resumeId ? "resume" : "run",
    cwd: job.cwd,
    readOnly: job.readOnly,
    resumeId: job.resumeId,
    continueLast: job.continueLast,
    model: job.model,
    effort: job.effort,
    settings: job.settings,
    extraArgs: job.extraArgs || [],
    schema: job.schema || null,
    timeoutMs: job.timeoutMs,
    allowNested: true,
    prompt: job.prompt,
    cli: job.cli,
  }
  const prepared = {
    cli: job.cli,
    prompt: job.prompt,
    binary: job.binary || resolveBinary(job.cli),
    resumeId: job.resumeId,
    continueLast: job.continueLast,
  }
  const { spawned, interpreted, status } = await executePrepared(prepared, options, jobId)
  writeJobResult(jobId, interpreted.result)
  const latest = getJob(jobId) || job
  recordJob({
    ...latest,
    sessionId: interpreted.sessionId,
    status,
    exitCode: spawned.exitCode,
    childPid: spawned.pid,
    pid: spawned.pid,
    error: status === "success" ? null : spawned.stderr.trim() || `exit ${spawned.exitCode}`,
    updatedAt: new Date().toISOString(),
  })
  process.exit(status === "success" ? 0 : spawned.exitCode === 124 ? 124 : 1)
}

function refreshJob(job) {
  if (!job || job.status !== "running") return job
  if (pidAlive(job.childPid) || pidAlive(job.workerPid) || pidAlive(job.pid)) {
    return { ...job, live: true }
  }
  const latest = getJob(job.id) || job
  if (latest.status !== "running") return latest
  const dead = {
    ...latest,
    status: "error",
    error: latest.error || "worker lost",
    live: false,
    updatedAt: new Date().toISOString(),
  }
  recordJob(dead)
  return dead
}

function cmdStatus(options) {
  const cli = options.cli ? requireCli(options.cli) : null
  const jobs = listJobs({ cli, cwd: options.cwd, limit: 20 }).map(refreshJob)
  const last = cli ? lastSession(cli, options.cwd) : null
  process.stdout.write(
    `${JSON.stringify({ status: "success", cli, cwd: options.cwd, lastSessionId: last, jobs }, null, 2)}\n`
  )
}

async function cmdWhich(options) {
  const cli = requireCli(options.cli)
  const binary = resolveBinary(cli)
  if (!binary) fail(missingBinaryHint(cli), { cli })
  const probe = await probeBinary(cli, binary)
  process.stdout.write(
    `${JSON.stringify({ status: "success", cli, binary, ready: probe.ok, detail: probe.detail }, null, 2)}\n`
  )
}

function cmdSessions(options) {
  const cli = requireCli(options.cli)
  const sessions = listNativeSessions(cli, options.cwd, { limit: 20 })
  process.stdout.write(
    `${JSON.stringify({ status: "success", cli, cwd: options.cwd, sessions }, null, 2)}\n`
  )
}

function cmdShow(options) {
  const id = options.resumeId || options.positional[0]
  if (!id) fail("Pass a job id.")
  const job = refreshJob(getJob(id))
  if (!job) fail(`Unknown job ${id}`)
  const result = readJobResult(id)
  process.stdout.write(`${JSON.stringify({ status: "success", job, result }, null, 2)}\n`)
}

function cmdLog(options) {
  const id = options.resumeId || options.positional[0]
  if (!id) fail("Pass a job id.")
  const job = getJob(id)
  if (!job) fail(`Unknown job ${id}`)
  const logFile = job.logFile || jobLogPath(id)
  let log = ""
  try {
    log = fs.readFileSync(logFile, "utf8")
  } catch {
    log = ""
  }
  if (log.length > 32000) log = log.slice(log.length - 32000)
  process.stdout.write(`${JSON.stringify({ status: "success", jobId: id, logFile, log }, null, 2)}\n`)
}

function cmdStop(options) {
  const id = options.resumeId || options.positional[0]
  if (!id) fail("Pass a job id.")
  const job = getJob(id)
  if (!job) fail(`Unknown job ${id}`)
  if (job.status !== "running") {
    process.stdout.write(
      `${JSON.stringify({ status: "success", jobId: id, stopped: false, jobStatus: job.status }, null, 2)}\n`
    )
    return
  }
  killProcessTree(job.childPid)
  killProcessTree(job.workerPid)
  killProcessTree(job.pid)
  const stopped = {
    ...job,
    status: "stopped",
    exitCode: 143,
    updatedAt: new Date().toISOString(),
    live: false,
  }
  recordJob(stopped)
  process.stdout.write(
    `${JSON.stringify({ status: "success", jobId: id, stopped: true, jobStatus: "stopped" }, null, 2)}\n`
  )
}

function cmdExtract(options) {
  const file = options.file || options.positional[0]
  if (!file) fail("Pass --file <jsonl>.")
  let raw
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch (error) {
    fail(`Cannot read ${file}: ${error.message}`)
  }
  const text = extractTranscript(raw, options.maxChars)
  process.stdout.write(
    `${JSON.stringify({ status: "success", file, chars: text.length, result: text }, null, 2)}\n`
  )
}

const argv = process.argv.slice(2)
const parsed = parseArgs(argv)
if (!parsed.command || parsed.help || parsed.command === "help") {
  process.stderr.write(USAGE)
  process.exit(parsed.help || parsed.command === "help" ? 0 : 2)
}

if (parsed.command === "run" || parsed.command === "resume") {
  await runDelegate(parsed)
} else if (parsed.command === "_worker") {
  const jobId = parsed.positional[0]
  if (!jobId) fail("Worker needs a job id.")
  await cmdWorker(jobId)
} else if (parsed.command === "status") {
  cmdStatus(parsed)
} else if (parsed.command === "which") {
  await cmdWhich(parsed)
} else if (parsed.command === "sessions") {
  cmdSessions(parsed)
} else if (parsed.command === "show") {
  cmdShow(parsed)
} else if (parsed.command === "log") {
  cmdLog(parsed)
} else if (parsed.command === "stop") {
  cmdStop(parsed)
} else if (parsed.command === "extract") {
  cmdExtract(parsed)
} else {
  fail(`Unknown command '${parsed.command}'`)
}
