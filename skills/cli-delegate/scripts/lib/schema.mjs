import fs from "node:fs"

import { ArgError } from "./args.mjs"

const MAX_INLINE_SCHEMA_CHARS = 6000

export function loadSchemaObject(schemaPath) {
  let raw
  try {
    raw = fs.readFileSync(schemaPath, "utf8")
  } catch (error) {
    throw new ArgError(`Cannot read --schema ${schemaPath}: ${error.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new ArgError(`--schema is not valid JSON: ${error.message}`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ArgError("--schema must be a JSON object.")
  }
  return parsed
}

/**
 * Map a schema file onto the child CLI's native structured-output flag.
 * Cursor has none — fail rather than silently ignore.
 */
export function schemaArgs(cli, schemaPath) {
  if (!schemaPath) return []
  if (cli === "cursor") {
    throw new ArgError(
      "Cursor has no native structured-output flag. Put the shape in the prompt, or pass a future flag after -- ."
    )
  }
  if (cli === "codex") {
    return ["--output-schema", schemaPath]
  }
  const compact = JSON.stringify(loadSchemaObject(schemaPath))
  if (compact.length > MAX_INLINE_SCHEMA_CHARS) {
    throw new ArgError(
      `--schema JSON is ${compact.length} chars; ${cli} takes the schema on argv (max ${MAX_INLINE_SCHEMA_CHARS}). Shrink it.`
    )
  }
  if (cli === "grok" || cli === "claude") {
    return ["--json-schema", compact]
  }
  throw new ArgError(`Unsupported cli for --schema: ${cli}`)
}
