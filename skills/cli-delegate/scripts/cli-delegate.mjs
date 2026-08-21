#!/usr/bin/env node
import path from "node:path"
import process from "node:process"

import {
  buildInvocation,
  defaultTimeoutMs,
  interpretOutput,
  missingBinaryHint,
  nestedHostBlocked,
  normalizeCli,
  resolveBinary,
  tmpCleanup,
} from "./lib/backends.mjs"
import { previewPrompt } from "./lib/parse.mjs"
import { runProcess } from "./lib/spawn.mjs"
import {
  generateJobId,
  getJob,
  lastSession,
  listJobs,
  recordJob,
} from "./lib/state.mjs"

const USAGE = `Usage:
  node cli-delegate.mjs run --cli <grok|cursor|claude|codex> [options] <prompt>
  node cli-delegate.mjs resume --cli <grok|cursor|claude|codex> [--id <session>] [prompt]
  node cli-delegate.mjs status [--cli <name>] [--cwd <dir>]
  node cli-delegate.mjs which --cli <name>

Options for run/resume:
  --cwd <dir>          Workspace (default: current directory)
  --model <id>         Model override
  --effort <level>     Unified effort: low|medium|high|xhigh|max (mapped per CLI)
  --settings <file>    Claude --settings JSON (third-party endpoint)
  --read-only          Plan/review mode, no edits
  --resume-last        Continue last session for this cwd+cli
  --resume <id>        Continue a specific session id
  --fresh              Force a new session
  --allow-nested       Allow spawning the same CLI as the current host
  --timeout <ms>       Kill after this many milliseconds (default 600000)
`

function fail(message, extra = {}) {
  process.stdout.write(
    `${JSON.stringify({ status: "error", error: message, ...extra }, null, 2)}\n`
  )
  process.exit(1)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {
    command: command || "",
    positional: [],
    timeoutMs: defaultTimeoutMs(),
  }
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    const next = () => {
      i += 1
      if (i >= rest.length) fail(`Missing value for ${token}`)
      return rest[i]
    }
    if (token === "--cli") options.cli = next()
    else if (token === "--cwd") options.cwd = next()
    else if (token === "--model") options.model = next()
    else if (token === "--effort") options.effort = next()
    else if (token === "--settings") options.settings = next()
    else if (token === "--resume") options.resumeId = next()
    else if (token === "--id") options.resumeId = next()
    else if (token === "--timeout") options.timeoutMs = Number(next())
    else if (token === "--resume-last") options.continueLast = true
    else if (token === "--fresh") options.fresh = true
    else if (token === "--read-only") options.readOnly = true
    else if (token === "--allow-nested") options.allowNested = true
    else if (token === "--help" || token === "-h") options.help = true
    else if (token.startsWith("--")) fail(`Unknown option ${token}`)
    else options.positional.push(token)
  }
  options.prompt = options.positional.join(" ").trim()
  options.cwd = path.resolve(options.cwd || process.cwd())
  return options
}

function requireCli(raw) {
  const cli = normalizeCli(raw)
  if (!cli) fail(`Unknown --cli '${raw}'. Use grok, cursor, claude, or codex.`)
  return cli
}

async function runDelegate(options) {
  const cli = requireCli(options.cli)
  const prompt =
    options.prompt ||
    (options.continueLast || options.resumeId
      ? "Continue from the current thread state. Pick the next highest-value step and follow through until the task is resolved."
      : "")
  if (!prompt) fail("A prompt is required.")

  if (nestedHostBlocked(cli, options)) {
    fail(
      `Refusing to nest ${cli} inside the same host. Pass --allow-nested, or pick another --cli. For third-party Claude, pass --settings.`
    )
  }

  const binary = resolveBinary(cli)
  if (!binary) fail(missingBinaryHint(cli), { cli })

  let resumeId = options.fresh ? null : options.resumeId || null
  let continueLast = Boolean(options.continueLast) && !resumeId && !options.fresh
  if (!resumeId && !continueLast && !options.fresh && options.command === "resume") {
    resumeId = lastSession(cli, options.cwd)
    if (!resumeId) continueLast = true
  }

  const invocation = buildInvocation(cli, {
    prompt,
    cwd: options.cwd,
    write: !options.readOnly,
    readOnly: options.readOnly,
    resumeId,
    continueLast,
    model: options.model,
    effort: options.effort,
    settings: options.settings,
  })

  const startedAt = new Date().toISOString()
  const jobId = generateJobId()
  let spawned
  try {
    spawned = await runProcess(binary, invocation.args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
    })
  } finally {
    tmpCleanup(invocation.promptFile)
  }

  const interpreted = interpretOutput(
    cli,
    spawned.stdout,
    spawned.stderr,
    invocation.assignedSessionId
  )
  const status = spawned.exitCode === 0 ? "success" : spawned.exitCode === 124 ? "partial" : "error"
  const job = {
    id: jobId,
    cli,
    cwd: options.cwd,
    binary,
    sessionId: interpreted.sessionId,
    resumeId: resumeId || null,
    continued: Boolean(resumeId || continueLast),
    status,
    exitCode: spawned.exitCode,
    promptPreview: previewPrompt(prompt),
    createdAt: startedAt,
    updatedAt: new Date().toISOString(),
    pid: spawned.pid,
  }
  recordJob(job)

  const payload = {
    status,
    cli,
    cwd: options.cwd,
    jobId,
    sessionId: interpreted.sessionId,
    continued: job.continued,
    exitCode: spawned.exitCode,
    result: interpreted.result,
  }
  if (status !== "success") {
    payload.error = spawned.stderr.trim() || `exit ${spawned.exitCode}`
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exit(status === "success" ? 0 : spawned.exitCode === 124 ? 124 : 1)
}

function cmdStatus(options) {
  const cli = options.cli ? requireCli(options.cli) : null
  const jobs = listJobs({ cli, cwd: options.cwd, limit: 20 })
  const last = cli ? lastSession(cli, options.cwd) : null
  process.stdout.write(
    `${JSON.stringify({ status: "success", cli, cwd: options.cwd, lastSessionId: last, jobs }, null, 2)}\n`
  )
}

function cmdWhich(options) {
  const cli = requireCli(options.cli)
  const binary = resolveBinary(cli)
  if (!binary) fail(missingBinaryHint(cli), { cli })
  process.stdout.write(`${JSON.stringify({ status: "success", cli, binary }, null, 2)}\n`)
}

function cmdShow(options) {
  const id = options.positional[0]
  if (!id) fail("Pass a job id.")
  const job = getJob(id)
  if (!job) fail(`Unknown job ${id}`)
  process.stdout.write(`${JSON.stringify({ status: "success", job }, null, 2)}\n`)
}

const argv = process.argv.slice(2)
const parsed = parseArgs(argv)
if (!parsed.command || parsed.help || parsed.command === "help") {
  process.stderr.write(USAGE)
  process.exit(parsed.help || parsed.command === "help" ? 0 : 2)
}

if (parsed.command === "run" || parsed.command === "resume") {
  await runDelegate(parsed)
} else if (parsed.command === "status") {
  cmdStatus(parsed)
} else if (parsed.command === "which") {
  cmdWhich(parsed)
} else if (parsed.command === "show") {
  cmdShow(parsed)
} else {
  fail(`Unknown command '${parsed.command}'`)
}
