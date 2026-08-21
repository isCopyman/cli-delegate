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

/** Main repo directory, even when `cwd` is already a linked worktree. */
export function canonicalRepoRoot(cwd, env = process.env) {
  const result = runGit(["rev-parse", "--git-common-dir"], cwd, env)
  if (result.code !== 0 || !result.stdout) return gitRoot(cwd, env)
  const common = path.resolve(cwd, result.stdout)
  if (path.basename(common) === ".git") return path.dirname(common)
  return gitRoot(cwd, env)
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

function revParse(cwd, env) {
  const result = runGit(["rev-parse", "HEAD"], cwd, env)
  if (result.code !== 0 || !result.stdout) {
    throw new ArgError(`Cannot read HEAD in ${cwd}: ${result.stderr}`)
  }
  return result.stdout
}

function countRange(gitRootDir, range, env) {
  const result = runGit(["rev-list", "--count", range], gitRootDir, env)
  if (result.code !== 0) return 0
  return Number(result.stdout || "0")
}

export function gitDirty(cwd, env = process.env) {
  const result = runGit(["status", "--porcelain"], cwd, env)
  return result.code === 0 && Boolean(result.stdout)
}

function isGitWorktree(dir, env) {
  if (!fs.existsSync(dir)) return false
  const inside = runGit(["rev-parse", "--is-inside-work-tree"], dir, env)
  return inside.code === 0 && inside.stdout === "true"
}

function inspect(worktreePath, sourceHead, gitRootDir, env) {
  const worktreeHead = revParse(worktreePath, env)
  return {
    worktreeHead,
    sourceAhead: countRange(gitRootDir, `${worktreeHead}..${sourceHead}`, env),
    worktreeUnique: countRange(gitRootDir, `${sourceHead}..${worktreeHead}`, env),
    dirty: gitDirty(worktreePath, env),
  }
}

function addWorktree(repoRoot, worktreePath, branch, sourceHead, env) {
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
  const added = runGit(
    ["worktree", "add", "-B", branch, worktreePath, sourceHead],
    repoRoot,
    env
  )
  if (added.code !== 0) {
    throw new ArgError(`git worktree add failed: ${added.stderr || added.stdout}`)
  }
}

function fastForward(worktreePath, sourceHead, env) {
  const merged = runGit(["merge", "--ff-only", sourceHead], worktreePath, env)
  return merged.code === 0
}

function behindWarning(worktreePath, info, sourceHead) {
  if (info.sourceAhead <= 0) return null
  return (
    `worktree ${worktreePath} is at ${info.worktreeHead.slice(0, 8)}; ` +
    `source HEAD is ${sourceHead.slice(0, 8)} (${info.sourceAhead} commit(s) not in this worktree). ` +
    `Line numbers and already-fixed bugs may not match the source checkout.`
  )
}

function leftoverWarning(worktreePath, info) {
  if (info.worktreeUnique <= 0 && !info.dirty) return null
  const bits = []
  if (info.worktreeUnique > 0) bits.push(`${info.worktreeUnique} commit(s) not in source`)
  if (info.dirty) bits.push("uncommitted files")
  return `worktree ${worktreePath} still has ${bits.join(" and ")}. This named lane is continuing that work, not a clean copy of source HEAD.`
}

export function ephemeralSlug(cli) {
  return sanitizeSlug(
    `${cli || "agent"}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  )
}

/**
 * Isolation for write jobs. Two shapes:
 *
 * - Named (`--worktree-name`): a sticky lane. Reuse the same folder/branch.
 *   Behind source → warn (and ff if the lane is clean with no unique commits).
 *   Never refuse.
 * - Ephemeral (`--worktree` only): a new folder per run. Resume reuses
 *   `reusePath` from the last job; a new run does not.
 *
 * Start point is HEAD of `cwd` (the checkout you passed), not origin/main.
 * The folder always lives under the canonical repo so we do not nest inside
 * an existing worktree.
 */
export function prepareWorktree(options) {
  const cwd = path.resolve(options.cwd)
  const env = options.env || process.env
  const allowStale = Boolean(options.allowStale)
  const continuing = Boolean(options.continuing)
  const repoRoot = canonicalRepoRoot(cwd, env)
  if (!repoRoot) {
    throw new ArgError(`--worktree requires a git repository. ${cwd} is not in one.`)
  }

  const sourceHead = revParse(cwd, env)
  const warnings = []
  if (gitDirty(cwd, env)) {
    warnings.push(
      `source ${cwd} has uncommitted files. --worktree starts from HEAD and will not copy them.`
    )
  }

  const named = Boolean(options.name)
  const kind = named ? "named" : "ephemeral"
  let slug
  let created = false
  let worktreePath

  if (named) {
    slug = sanitizeSlug(options.name)
    worktreePath = path.join(repoRoot, ".cli-delegate", "worktrees", slug)
  } else if (continuing && options.reusePath && isGitWorktree(options.reusePath, env)) {
    worktreePath = path.resolve(options.reusePath)
    slug = path.basename(worktreePath)
  } else {
    slug = ephemeralSlug(options.cli)
    worktreePath = path.join(repoRoot, ".cli-delegate", "worktrees", slug)
    if (continuing && options.reusePath) {
      warnings.push(
        `previous worktree ${options.reusePath} is gone; created a new one from current HEAD`
      )
    }
  }

  const branch = `cli-delegate-${slug}`

  if (!isGitWorktree(worktreePath, env)) {
    if (fs.existsSync(worktreePath)) {
      throw new ArgError(
        `Worktree path exists but is not a git worktree: ${worktreePath}. Remove it or pass --worktree-name.`
      )
    }
    addWorktree(repoRoot, worktreePath, branch, sourceHead, env)
    created = true
    return {
      cwd: worktreePath,
      gitRoot: repoRoot,
      sourceCwd: cwd,
      slug,
      branch,
      kind,
      created,
      sourceHead,
      worktreeHead: sourceHead,
      warnings,
    }
  }

  let info = inspect(worktreePath, sourceHead, repoRoot, env)

  if (!continuing && named && info.sourceAhead > 0 && info.worktreeUnique === 0 && !info.dirty) {
    if (fastForward(worktreePath, sourceHead, env)) {
      warnings.push(`fast-forwarded named worktree ${slug} to ${sourceHead.slice(0, 8)}`)
      info = inspect(worktreePath, sourceHead, repoRoot, env)
    }
  }

  if (!allowStale) {
    const behind = behindWarning(worktreePath, info, sourceHead)
    if (behind) warnings.push(behind)
  }
  if (named && !continuing) {
    const leftover = leftoverWarning(worktreePath, info)
    if (leftover) warnings.push(leftover)
  }

  return {
    cwd: worktreePath,
    gitRoot: repoRoot,
    sourceCwd: cwd,
    slug,
    branch,
    kind,
    created,
    sourceHead,
    worktreeHead: info.worktreeHead,
    warnings,
  }
}
