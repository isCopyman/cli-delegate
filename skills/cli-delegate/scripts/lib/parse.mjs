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

const SKIP_RESULT_TYPES =
  /command_execution|tool_call|tool_result|mcp_tool|file_change|reasoning|thought/i

function resultFromObject(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null
  const kind = String(obj.type || "")
  if (SKIP_RESULT_TYPES.test(kind)) return null
  for (const key of RESULT_KEYS) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  if (kind === "result" && typeof obj.result === "string") return obj.result
  if (depth < 2 && obj.item && typeof obj.item === "object") {
    return resultFromObject(obj.item, depth + 1)
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

  const deltas = []
  for (const line of lines) {
    const parsed = parseJsonValue(line)
    if (parsed?.type === "text" && typeof parsed.data === "string") {
      deltas.push(parsed.data)
    }
  }
  if (deltas.length) return deltas.join("")

  // Vendor stream-json / --json: never return the raw dump as `result`.
  const jsonl = lines.filter((line) => parseJsonValue(line)).length
  if (jsonl >= 2) return ""

  return String(text ?? "").trim()
}

export function previewPrompt(prompt, max = 160) {
  const text = String(prompt ?? "").replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

export function lastJsonObject(text) {
  const whole = parseJsonValue(text)
  if (whole && typeof whole === "object" && !Array.isArray(whole)) return whole

  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseJsonValue(lines[i])
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
  }

  const raw = String(text ?? "")
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start >= 0 && end > start) {
    const parsed = parseJsonValue(raw.slice(start, end + 1))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
  }
  return null
}

function asResultText(value) {
  if (typeof value === "string") return value.trim()
  if (value == null) return ""
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

/** Grok `--output-format json`: one `{ text, sessionId, structuredOutput? }`. */
export function interpretGrokOutput(stdout, stderr, assignedSessionId) {
  const obj = lastJsonObject(stdout)
  if (
    obj &&
    (obj.sessionId ||
      obj.text !== undefined ||
      obj.structuredOutput !== undefined ||
      obj.type === "error")
  ) {
    const sessionId = sessionFromObject(obj) || assignedSessionId || null
    if (obj.type === "error") {
      return { sessionId, result: asResultText(obj.message) }
    }
    if (obj.structuredOutput != null && typeof obj.structuredOutput === "object") {
      return { sessionId, result: asResultText(obj.structuredOutput) }
    }
    if (Object.prototype.hasOwnProperty.call(obj, "text")) {
      return { sessionId, result: asResultText(obj.text) }
    }
    return { sessionId, result: extractResultText(stdout) }
  }
  return {
    sessionId: assignedSessionId || extractSessionId(stdout) || extractSessionId(stderr) || null,
    result: String(stdout ?? "").trimEnd(),
  }
}

/** Claude `-p --output-format json`: one `{ type:"result", result, session_id }`. */
export function interpretClaudeOutput(stdout, stderr, assignedSessionId) {
  const obj = lastJsonObject(stdout) || lastJsonObject(stderr)
  if (obj && (obj.type === "result" || obj.result !== undefined || obj.session_id)) {
    return {
      sessionId: sessionFromObject(obj) || assignedSessionId || null,
      result: asResultText(obj.result),
    }
  }
  return {
    sessionId: assignedSessionId || extractSessionId(stdout) || extractSessionId(stderr) || null,
    result: extractResultText(stdout) || extractResultText(stderr) || "",
  }
}

/** Cursor `-p --output-format json`: Claude-shaped `{ type:"result", result, chat_id|session_id }`. */
export function interpretCursorOutput(stdout, stderr, assignedSessionId) {
  const obj = lastJsonObject(stdout) || lastJsonObject(stderr)
  if (obj && (obj.type === "result" || obj.result !== undefined || obj.chat_id || obj.session_id)) {
    return {
      sessionId: sessionFromObject(obj) || assignedSessionId || null,
      result: asResultText(obj.result),
    }
  }
  return {
    sessionId: assignedSessionId || extractSessionId(stdout) || extractSessionId(stderr) || null,
    result: extractResultText(stdout) || extractResultText(stderr) || "",
  }
}

function stripCodexBanners(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^Reading additional input from stdin/i.test(line.trim()))
    .join("\n")
    .trim()
}

/** Codex `exec --json`: wait for the process, then take last `agent_message` + `thread_id`. */
export function interpretCodexOutput(stdout, stderr, assignedSessionId, lastMessage) {
  const sidecar = String(lastMessage ?? "").trim()
  const sessionId =
    extractSessionId(stdout) || extractSessionId(stderr) || assignedSessionId || null
  const fromJsonl = extractResultText(stdout)
  if (fromJsonl) return { sessionId, result: fromJsonl }
  if (sidecar) return { sessionId, result: sidecar }
  return { sessionId, result: stripCodexBanners(stdout) }
}

export function interpretCliOutput(cli, stdout, stderr, assignedSessionId, lastMessage) {
  if (cli === "grok") return interpretGrokOutput(stdout, stderr, assignedSessionId)
  if (cli === "claude") return interpretClaudeOutput(stdout, stderr, assignedSessionId)
  if (cli === "cursor") return interpretCursorOutput(stdout, stderr, assignedSessionId)
  if (cli === "codex") {
    return interpretCodexOutput(stdout, stderr, assignedSessionId, lastMessage)
  }
  return {
    sessionId: assignedSessionId || extractSessionId(stdout) || extractSessionId(stderr) || null,
    result: extractResultText(stdout) || extractResultText(stderr) || "",
  }
}
