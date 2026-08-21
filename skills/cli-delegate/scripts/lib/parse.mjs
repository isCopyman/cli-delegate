const SESSION_KEYS = [
  "session_id",
  "sessionId",
  "thread_id",
  "threadId",
  "chat_id",
  "chatId",
]

const RESULT_KEYS = ["result", "message", "text", "content", "last_agent_message"]

export function parseJsonValue(text) {
  const raw = String(text ?? "").trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function sessionFromObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null
  for (const key of SESSION_KEYS) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  if (obj.session && typeof obj.session === "object") {
    return sessionFromObject(obj.session)
  }
  return null
}

function resultFromObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null
  for (const key of RESULT_KEYS) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  if (typeof obj.type === "string" && obj.type === "result") {
    if (typeof obj.result === "string") return obj.result
  }
  return null
}

export function extractSessionId(text) {
  const whole = parseJsonValue(text)
  const fromWhole = sessionFromObject(whole)
  if (fromWhole) return fromWhole

  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseJsonValue(lines[i])
    const found = sessionFromObject(parsed)
    if (found) return found
  }

  const match = String(text ?? "").match(
    /(?:session[_ ]id|chat[_ ]id|thread[_ ]id)["\s:=]+([0-9a-fA-F-]{8,})/i
  )
  return match ? match[1] : null
}

export function extractResultText(text) {
  const whole = parseJsonValue(text)
  const fromWhole = resultFromObject(whole)
  if (fromWhole) return fromWhole

  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseJsonValue(lines[i])
    const found = resultFromObject(parsed)
    if (found) return found
  }

  return String(text ?? "").trim()
}

export function previewPrompt(prompt, max = 160) {
  const text = String(prompt ?? "").replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}
