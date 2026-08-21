import { CLI_NAMES } from "./backends.mjs"

export const NO_LIST_NOTE =
  "No models-list command. Omit --model; the child uses its own default."

export function modelListArgs(cli) {
  if (cli === "grok") return { args: ["models"], source: "grok models" }
  if (cli === "cursor") return { args: ["models"], source: "cursor-agent models" }
  if (cli === "codex") {
    return { args: ["debug", "models"], source: "codex debug models" }
  }
  if (cli === "claude") {
    return {
      args: null,
      source: null,
      unsupported: true,
      note: NO_LIST_NOTE,
    }
  }
  return null
}

export function parseGrokModels(text) {
  const models = []
  let defaultId = null
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const def = line.match(/^\s*Default model:\s+(\S+)/i)
    if (def) {
      defaultId = def[1]
      continue
    }
    const row = line.match(/^\s*[\*\-]\s+(\S+)(?:\s+\(default\))?/)
    if (row) {
      const id = row[1]
      models.push({
        id,
        default: /\(default\)/i.test(line) || id === defaultId,
      })
    }
  }
  if (defaultId && !models.some((m) => m.id === defaultId)) {
    models.unshift({ id: defaultId, default: true })
  }
  return { default: defaultId || models.find((m) => m.default)?.id || null, models }
}

export function parseCursorModels(text) {
  const models = []
  let defaultId = null
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const row = line.match(/^(\S+)\s+-\s+(.+)$/)
    if (!row) continue
    if (row[1].toLowerCase() === "available" && row[2].toLowerCase() === "models") {
      continue
    }
    const id = row[1]
    const label = row[2].replace(/\s+\(default\)\s*$/i, "").trim()
    const isDefault = /\(default\)/i.test(row[2])
    if (isDefault) defaultId = id
    models.push({ id, label, default: isDefault })
  }
  return { default: defaultId, models }
}

export function parseCodexModels(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text ?? "").trim())
  } catch {
    return { default: null, models: [], error: "codex debug models did not return JSON" }
  }
  const list = Array.isArray(parsed?.models)
    ? parsed.models
    : Array.isArray(parsed)
      ? parsed
      : []
  const models = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const visibility = String(item.visibility || "list").toLowerCase()
    if (visibility === "hidden") continue
    const id = item.slug || item.id
    if (!id) continue
    const efforts = Array.isArray(item.supported_reasoning_levels)
      ? item.supported_reasoning_levels
          .map((level) => (typeof level === "string" ? level : level?.effort))
          .filter(Boolean)
      : []
    models.push({
      id,
      label: item.display_name || null,
      default: Boolean(item.priority === 1),
      efforts,
    })
  }
  const defaultId = models.find((m) => m.default)?.id || models[0]?.id || null
  return { default: defaultId, models }
}

export function parseModelList(cli, text) {
  if (cli === "grok") return parseGrokModels(text)
  if (cli === "cursor") return parseCursorModels(text)
  if (cli === "codex") return parseCodexModels(text)
  return { default: null, models: [] }
}

export function effortHint(cli) {
  if (cli === "grok") {
    return { flag: "--effort", values: ["low", "medium", "high"] }
  }
  if (cli === "claude") {
    return { flag: "--effort", values: ["low", "medium", "high", "xhigh", "max"] }
  }
  if (cli === "codex") {
    return {
      flag: '-c model_reasoning_effort="<level>"',
      values: ["low", "medium", "high", "xhigh", "max"],
    }
  }
  if (cli === "cursor") {
    return {
      flag: "--model id[effort=high]",
      values: ["low", "medium", "high", "xhigh"],
      note: "Bracket effort only on a real model id, not auto.",
    }
  }
  return null
}

export function allCliNames() {
  return [...CLI_NAMES]
}
