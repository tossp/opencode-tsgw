import { SUMMARY_EXCERPT_LIMIT, TOOL_OUTPUT_DIR } from "./contract.js"
import type { DetailMode, Dict } from "./contract.js"
import { str } from "./value.js"

export const asToolResult = (title: string, output: string, metadata: Record<string, unknown>) => ({ title, output, metadata })

export function redact(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1[redacted]")
    .replace(/(["']?(?:api[_-]?key|token|password|secret)["']?\s*[:=]\s*["'])[^"'\n]+/ig, "$1[redacted]")
    .replace(/([?&](?:token|key|signature|sig)=)[^&\s]+/ig, "$1[redacted]")
}

export function stringify(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  try { return JSON.stringify(value) } catch { return String(value) }
}

export function excerpt(value: unknown, limit: number) {
  const raw = redact(stringify(value))
  return raw.length <= limit
    ? { text: raw, truncated: false, length: raw.length }
    : { text: `${raw.slice(0, limit)}\n...[truncated ${raw.length - limit} chars]`, truncated: true, length: raw.length }
}

export function contentField(value: unknown, limit: number, mode: Exclude<DetailMode, "none">) {
  const clipped = excerpt(value, mode === "full" ? limit : Math.min(limit, SUMMARY_EXCERPT_LIMIT))
  return mode === "full"
    ? { text: clipped.text, truncated: clipped.truncated, length: clipped.length }
    : { excerpt: clipped.text, truncated: clipped.truncated, length: clipped.length }
}

export function pushWarning(warnings: Array<Record<string, unknown>>, warning: Record<string, unknown>): void {
  const next = JSON.stringify(warning)
  if (warnings.some((item) => JSON.stringify(item) === next)) return
  warnings.push(warning)
}

export function normalizeReasoningInfo(data: Dict) {
  const items = [data.content, data.parts, data.steps, data.items, data.tokens]
  const count = items.find((value) => Array.isArray(value))
  return {
    omitted: true,
    type: str(data.kind) || str(data.format) || "reasoning",
    count: Array.isArray(count) ? count.length : null,
  }
}

export function extractToolReferences(metadata: Dict): Array<Record<string, unknown>> {
  const refs: Array<Record<string, unknown>> = []
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== "string") continue
    if (!/(^path$|_path$|^file$|_file$|^stdoutPath$|^stderrPath$)/i.test(key)) continue
    if (!(value.startsWith("/") || value.startsWith("~/") || value.startsWith(TOOL_OUTPUT_DIR))) continue
    refs.push({ key, path: value, external: value.startsWith(TOOL_OUTPUT_DIR) })
  }
  return refs
}

export function summarizeToolMetadata(metadata: Dict) {
  const refs = extractToolReferences(metadata)
  return {
    exit: metadata.exit ?? null,
    truncated: metadata.truncated ?? null,
    background: metadata.background ?? null,
    durationMs: metadata.durationMs ?? metadata.duration_ms ?? null,
    references: refs,
  }
}
