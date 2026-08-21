import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { ArgError } from "./args.mjs"
import { which } from "./spawn.mjs"

const SLUG_RE = /^[a-zA-Z0-9._-]+$/

export function gitBinary(env = process.env) {
  return env.GIT_BINARY || which("git", env)
}

export function runGit(args, cwd, env = process.env) {
  const git = gitBinary(env)
  if (!git) throw new ArgError("git is required for --worktree. Set GIT_BINARY or put git on PATH.")
  const result = spawnSync(git, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env,
  })
  return {
    code: result.status == null ? 1 : result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  }
}

export function gitRoot(cwd, env = process.env) {
  const result = runGit(["rev-parse", "--show-toplevel"], cwd, env)
  if (result.code !== 0) return null
  return path.resolve(result.stdout)
}

export function sanitizeSlug(raw) {
  const slug = String(raw ?? "")
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
  if (!slug || !SLUG_RE.test(slug)) {
    throw new ArgError(`Invalid --worktree-name '${raw}'. Use letters, digits, dot, underscore, dash.`)
  }
  return slug
}

function sourceAheadCount(gitRootDir, sourceHead, worktreeHead, env) {
  const result = runGit(
    ["rev-list", "--count", `${worktreeHead}..${sourceHead}`],
    gitRootDir,
    env
  )
  if (result.code !== 0) {
    throw new ArgError(`Cannot compare worktree HEAD to source: ${result.stderr || result.stdout}`)
  }
  return Number(result.stdout || "0")
}

/**
 * Create or reuse a git worktree at <gitRoot>/.cli-delegate/worktrees/<slug>
 * based on the current HEAD (not origin/main).
 *
 * Reuse: if the source branch has commits the worktree lacks, refuse unless
 * allowStale. Child commits on the worktree branch are fine.
 */
export function prepareWorktree(options) {
  const cwd = path.resolve(options.cwd)
  const env = options.env || process.env
  const allowStale = Boolean(options.allowStale)
  const root = gitRoot(cwd, env)
  if (!root) {
    throw new ArgError(`--worktree requires a git repository. ${cwd} is not in one.`)
  }

  const slug = sanitizeSlug(options.name || options.cli || "agent")
  const worktreePath = path.join(root, ".cli-delegate", "worktrees", slug)
  const branch = `cli-delegate-${slug}`

  const source = runGit(["rev-parse", "HEAD"], root, env)
  if (source.code !== 0 || !source.stdout) {
    throw new ArgError(`Cannot read HEAD in ${root}: ${source.stderr}`)
  }
  const sourceHead = source.stdout

  const warnings = []
  let created = false

  if (fs.existsSync(worktreePath)) {
    const inside = runGit(["rev-parse", "--is-inside-work-tree"], worktreePath, env)
    if (inside.code !== 0 || inside.stdout !== "true") {
      throw new ArgError(
        `Worktree path exists but is not a git worktree: ${worktreePath}. Remove it or pass --worktree-name.`
      )
    }
    const head = runGit(["rev-parse", "HEAD"], worktreePath, env)
    if (head.code !== 0 || !head.stdout) {
      throw new ArgError(`Cannot read worktree HEAD at ${worktreePath}: ${head.stderr}`)
    }
    const worktreeHead = head.stdout
    const ahead = sourceAheadCount(root, sourceHead, worktreeHead, env)
    const message =
      `worktree ${worktreePath} is at ${worktreeHead.slice(0, 8)}; source HEAD is ${sourceHead.slice(0, 8)} (${ahead} commit(s) missing)`
    if (ahead > 0 && !allowStale) {
      throw new ArgError(
        `${message}. Refusing to run on a stale worktree (line numbers and already-fixed bugs will be wrong). Pass --allow-stale to override, or delete the worktree.`
      )
    }
    if (ahead > 0) warnings.push(message)
    return {
      cwd: worktreePath,
      gitRoot: root,
      slug,
      branch,
      created,
      sourceHead,
      worktreeHead,
      warnings,
    }
  }

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
  const added = runGit(
    ["worktree", "add", "-B", branch, worktreePath, sourceHead],
    root,
    env
  )
  if (added.code !== 0) {
    throw new ArgError(`git worktree add failed: ${added.stderr || added.stdout}`)
  }
  created = true
  return {
    cwd: worktreePath,
    gitRoot: root,
    slug,
    branch,
    created,
    sourceHead,
    worktreeHead: sourceHead,
    warnings,
  }
}
