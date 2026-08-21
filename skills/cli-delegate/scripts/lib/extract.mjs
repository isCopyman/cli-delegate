import { parseJsonValue } from "./parse.mjs"

const SKIP_TYPES = /tool[_-]?call|tool[_-]?result|tool_use|tool_result|function_call/i

function textFromUnknown(value, depth = 0) {
  if (depth > 6 || value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return ""
  if (Array.isArray(value)) {
    return value.map((part) => textFromUnknown(part, depth + 1)).filter(Boolean).join("")
  }
  if (typeof value !== "object") return ""
  const type = String(value.type || "")
  if (SKIP_TYPES.test(type)) return ""
  if (typeof value.text === "string") return value.text
  if (typeof value.content === "string") return value.content
  if (value.content) return textFromUnknown(value.content, depth + 1)
  if (value.message) return textFromUnknown(value.message, depth + 1)
  if (value.delta) return textFromUnknown(value.delta, depth + 1)
  if (value.item) return textFromUnknown(value.item, depth + 1)
  return ""
}

export function roleFromObject(obj) {
  if (!obj || typeof obj !== "object") return null
  const role = String(obj.role || obj.author || "").toLowerCase()
  if (role === "user" || role === "human") return "user"
  if (role === "assistant" || role === "agent" || role === "model") return "assistant"
  const type = String(obj.type || obj.sessionUpdate || "").toLowerCase()
  if (SKIP_TYPES.test(type)) return null
  if (/\buser\b/.test(type) && !/assistant/.test(type)) return "user"
  if (/assistant|agent_message|agent_text/.test(type)) return "assistant"
  if (obj.message && typeof obj.message === "object") return roleFromObject(obj.message)
  if (obj.item && typeof obj.item === "object") return roleFromObject(obj.item)
  return null
}

function objectsFromTranscript(raw) {
  const whole = parseJsonValue(raw)
  if (Array.isArray(whole)) return whole.filter((item) => item && typeof item === "object")
  if (whole && typeof whole === "object" && Array.isArray(whole.messages)) {
    return whole.messages.filter((item) => item && typeof item === "object")
  }
  return String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => parseJsonValue(line))
    .filter((item) => item && typeof item === "object")
}

export function extractTurns(raw) {
  const turns = []
  for (const obj of objectsFromTranscript(raw)) {
    const role = roleFromObject(obj)
    const text = textFromUnknown(obj.message ?? obj).replace(/\s+\n/g, "\n")
    if (!role || !text.trim()) continue
    const last = turns[turns.length - 1]
    if (last && last.role === role) {
      const glue = last.text.endsWith("\n") || text.startsWith("\n") || text.startsWith(" ") ? "" : "\n"
      last.text = `${last.text}${glue}${text}`
    } else turns.push({ role, text })
  }
  return turns
}

export function formatTurns(turns, maxChars = 8000) {
  const blocks = turns.map((turn) => {
    const label = turn.role === "user" ? "User" : "Assistant"
    return `${label}:\n${turn.text}`
  })
  let out = blocks.join("\n\n").trim()
  const cap = Number(maxChars)
  const limit = Number.isFinite(cap) && cap > 0 ? cap : 8000
  if (out.length <= limit) return out
  return out.slice(out.length - limit)
}

export function extractTranscript(raw, maxChars = 8000) {
  return formatTurns(extractTurns(raw), maxChars)
}
