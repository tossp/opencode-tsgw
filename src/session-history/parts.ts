import { DEFAULT_TOOL_LIMIT } from "./contract.js"
import type { ParsePartOptions, Row } from "./contract.js"
import { contentField, excerpt, normalizeReasoningInfo, pushWarning, summarizeToolMetadata } from "./content.js"
import { asIso, bool, obj, safeJsonParse, str } from "./value.js"

export function parsePart(row: Row, options: ParsePartOptions) {
  const data = obj(safeJsonParse(row.data))
  const type = str(data.type) || "unknown"
  const state = obj(data.state)
  const base = {
    id: str(row.id),
    messageId: str(row.message_id),
    sessionId: str(row.session_id),
    type,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    createdAt: asIso(row.time_created),
    updatedAt: asIso(row.time_updated),
    ref: { sessionId: str(row.session_id), messageId: str(row.message_id), partId: str(row.id) },
  }
  if (type === "text") {
    if (options.detailMode === "none") return { ...base, summary: "text part", omitted: true }
    const text = contentField(data.text, options.maxOutputChars, options.detailMode === "full" ? "full" : "summary")
    return options.detailMode === "full"
      ? { ...base, text: text.text, truncated: text.truncated, length: text.length }
      : { ...base, excerpt: text.excerpt, truncated: text.truncated, length: text.length }
  }
  if (type === "reasoning") {
    return { ...base, summary: "reasoning omitted", reasoning: normalizeReasoningInfo(data) }
  }
  if (type === "tool" || type === "tool-call") {
    const meta = obj(state.metadata)
    const metadata = summarizeToolMetadata(meta)
    if (meta.truncated || metadata.references.length > 0) {
      pushWarning(options.warnings, { code: "tool_output_reference", partId: base.id, callId: str(data.callID) || null, references: metadata.references })
    }
    const toolMode = options.toolMode === "none" ? "summary" : options.toolMode
    const toolLimit = toolMode === "full" ? Math.min(options.maxOutputChars, DEFAULT_TOOL_LIMIT) : Math.min(options.maxOutputChars, 240)
    const input = options.toolMode === "none" ? null : contentField(state.input, toolLimit, toolMode)
    const output = options.toolMode === "none" ? null : contentField(state.output, toolLimit, toolMode)
    return {
      ...base,
      tool: str(data.tool) || null,
      callId: str(data.callID) || null,
      status: str(state.status) || null,
      title: str(state.title) || null,
      input,
      output,
      metadata,
      time: obj(state.time),
    }
  }
  if (type === "step-start") return { ...base, snapshot: data.snapshot || null }
  if (type === "step-finish") return { ...base, snapshot: data.snapshot || null, reason: data.reason || null, tokens: data.tokens || null, cost: data.cost ?? null }
  if (type === "patch") return { ...base, files: Array.isArray(data.files) ? data.files.slice(0, 20) : [], hash: data.hash || null }
  if (type === "compaction") return { ...base, auto: bool(data.auto), tailStartId: data.tail_start_id || null, marker: data.marker || null }
  const summary = excerpt(data, Math.min(options.maxOutputChars, DEFAULT_TOOL_LIMIT))
  pushWarning(options.warnings, { code: "unknown_part_type", type, partId: base.id, messageId: base.messageId })
  return { ...base, summary: summary.text, truncated: summary.truncated, warning: "unknown_part_type" }
}

export function groupByMessage(rows: Row[], options: ParsePartOptions) {
  const parsed = rows.map((row) => parsePart(row, options))
  const map = new Map<string, typeof parsed>()
  for (const part of parsed) {
    const list = map.get(part.messageId) || []
    list.push(part)
    map.set(part.messageId, list)
  }
  return { parsed, byMessage: map }
}
