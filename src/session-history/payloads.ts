import { DEFAULT_PART_LIMIT, MAX_PART_LIMIT } from "./contract.js"
import type { DetailMode, Dict, Row } from "./contract.js"
import { contentField, excerpt, pushWarning } from "./content.js"
import { groupByMessage, parsePart } from "./parts.js"
import {
  loadChildren,
  loadCompactionRows,
  loadCounts,
  loadEvents,
  loadMessageRow,
  loadMessageRows,
  loadPartRow,
  loadPartRows,
  loadPartRowsForMessage,
  loadSessionRow,
  loadTaskTextRows,
  loadTaskToolRows,
  loadTodos,
  loadToolRowsByCallId,
} from "./repository.js"
import { diagnostics, parseSession, storageMode, summarizeSessionForIndex } from "./session.js"
import {
  childTimelineItems,
  compactionTimelineItems,
  eventTimelineItems,
  messageTimelineItem,
  sortTimeline,
  summarizeChild,
  summarizeCompactions,
  summarizeEvents,
  summarizeMessage,
  summarizeTasks,
  taskTimelineItems,
  toolTimelineItems,
} from "./summaries.js"
import { clamp, num, obj, str } from "./value.js"

export function buildReadPayload(sessionId: string, includeParts: boolean, includeTodos: boolean, limitMessages: number, maxOutputChars: number) {
  const row = loadSessionRow(sessionId)
  if (!row) return { ok: false, error: { code: "SESSION_NOT_FOUND", message: `Session not found: ${sessionId}` }, ref: { sessionId }, source: { type: "opencode-db", tables: ["session", "project"] } }
  const counts = loadCounts(sessionId)
  const mode = storageMode(counts)
  const diag = diagnostics(counts)
  const warnings: Array<Record<string, unknown>> = []
  const messageRows = diag.reason === "message_part_available" ? loadMessageRows(sessionId, limitMessages) : []
  const messageIds = messageRows.map((item) => str(item.id)).filter(Boolean)
  const { byMessage, parsed } = groupByMessage(
    includeParts || messageRows.length > 0 ? loadPartRows(sessionId, messageIds, clamp(undefined, DEFAULT_PART_LIMIT, MAX_PART_LIMIT)) : [],
    { detailMode: "summary", toolMode: "summary", maxOutputChars, warnings },
  )
  const messages = messageRows.map((messageRow) => summarizeMessage(messageRow, byMessage.get(str(messageRow.id)) || [], includeParts))
  return {
    ok: true,
    source: { type: "opencode-db", mode: "read-only", tables: ["session", "project", "message", "part", "session_message", ...(includeTodos ? ["todo"] : [])] },
    session: parseSession(row),
    counts,
    storageMode: mode,
    diagnostics: diag,
    window: { total: counts.message_count, returned: messages.length, truncated: counts.message_count > messages.length, limit: limitMessages },
    messages,
    parts: includeParts ? parsed : [],
    todos: includeTodos ? loadTodos(sessionId) : [],
    warnings,
  }
}

export function enforceMaxTotalChars(result: Dict, maxTotalChars: number): Dict {
  const size = () => JSON.stringify(result).length
  if (size() <= maxTotalChars) return result
  const timeline = Array.isArray(result.timeline) ? [...result.timeline as Dict[]] : []
  let removed = 0
  while (timeline.length > 1 && size() > maxTotalChars) {
    timeline.shift()
    removed += 1
    result.timeline = timeline
  }
  if (size() > maxTotalChars && Array.isArray(result.timeline)) {
    result.timeline = (result.timeline as Dict[]).map((item) => {
      const next = { ...item }
      delete next.parts
      if (obj(next.input).text) next.input = contentField(obj(next.input).text, 240, "summary")
      if (obj(next.output).text) next.output = contentField(obj(next.output).text, 240, "summary")
      return next
    })
  }
  if (removed > 0) {
    const first = timeline[0] || {}
    result.nextCursor = {
      createdAt: first.createdAt || null,
      kind: first.kind || null,
      sessionId: first.sessionId || null,
      messageId: first.messageId || null,
      partId: first.partId || null,
      taskId: first.taskId || null,
      childSessionId: first.childSessionId || null,
    }
    result.coverage = {
      returnedTimelineItems: timeline.length,
      omittedTimelineItems: removed,
      truncatedBy: "maxTotalChars",
    }
    pushWarning(result.warnings as Array<Record<string, unknown>>, { code: "max_total_chars", message: "timeline truncated by maxTotalChars", maxTotalChars, omittedTimelineItems: removed })
  }
  return result
}

export function buildTimelinePayload(args: { sessionId: string, view: "full" | "current_context" | "audit", includeChildren: "none" | "summary" | "full", includeParts: DetailMode, includeTools: DetailMode, includeEvents: boolean, limitMessages: number, limitParts: number, maxOutputChars: number, maxTotalChars: number }) {
  const row = loadSessionRow(args.sessionId)
  if (!row) return { ok: false, error: { code: "SESSION_NOT_FOUND", message: `Session not found: ${args.sessionId}` }, ref: { sessionId: args.sessionId }, source: { type: "opencode-db", tables: ["session", "project"] } }
  const counts = loadCounts(args.sessionId)
  const mode = storageMode(counts)
  const diag = diagnostics(counts)
  const warnings: Array<Record<string, unknown>> = []
  const compactions = summarizeCompactions(loadCompactionRows(args.sessionId))
  const latestCompaction = compactions[compactions.length - 1] || null
  const childrenRows = args.includeChildren === "none" ? [] : loadChildren(args.sessionId)
  const children = args.includeChildren === "none" ? [] : childrenRows.map((child) => summarizeChild(child, true))
  const events = args.includeEvents ? summarizeEvents(loadEvents(args.sessionId, Math.max(args.limitMessages * 6, 50))) : []
  if (diag.reason !== "message_part_available") {
    const fallback = {
      ok: true,
      source: { type: "opencode-db", mode: "read-only", tables: ["session", "project", "message", "part", "event", "session_message"] },
      session: summarizeSessionForIndex(row),
      counts,
      storageMode: mode,
      diagnostics: diag,
      timeline: sortTimeline([
        ...compactionTimelineItems(args.view === "current_context" && latestCompaction ? [latestCompaction] : compactions),
        ...(args.includeChildren === "none" ? [] : childTimelineItems(children)),
        ...(args.includeEvents ? eventTimelineItems(events) : []),
      ]),
      warnings,
      view: args.view,
      limits: { limitMessages: args.limitMessages, limitParts: args.limitParts, maxOutputChars: args.maxOutputChars, maxTotalChars: args.maxTotalChars, includeParts: args.includeParts, includeTools: args.includeTools },
    }
    return enforceMaxTotalChars(fallback, args.maxTotalChars)
  }
  const messageRows = loadMessageRows(args.sessionId, args.limitMessages)
  const messageIds = messageRows.map((item) => str(item.id)).filter(Boolean)
  const messageIdSet = new Set(messageIds)
  const partRows = loadPartRows(args.sessionId, messageIds, args.limitParts)
  const timelineGroups = groupByMessage(partRows, { detailMode: args.includeParts, toolMode: args.includeTools, maxOutputChars: args.maxOutputChars, warnings })
  const toolGroups = groupByMessage(partRows, { detailMode: "summary", toolMode: args.includeTools, maxOutputChars: args.maxOutputChars, warnings })
  const cutoff = args.view === "current_context" ? num(latestCompaction?.timeCreated) : null
  const visibleMessages = messageRows.map((messageRow) => {
    const allParts = timelineGroups.byMessage.get(str(messageRow.id)) || []
    const parts = cutoff !== null && str(messageRow.id) === str(latestCompaction?.messageId)
      ? allParts.filter((part) => part.id === latestCompaction?.id || Number(part.timeCreated || 0) >= cutoff)
      : cutoff !== null && Number(messageRow.time_created || 0) < cutoff
        ? []
        : allParts
    return summarizeMessage(messageRow, parts, args.includeParts !== "none")
  }).filter((message) => args.view !== "current_context" || message.partCount > 0 || Number(message.timeCreated || 0) >= Number(cutoff || 0) || message.id === latestCompaction?.messageId)
  const toolParts = args.view === "current_context" && cutoff !== null
    ? toolGroups.parsed.filter((part) => Number(part.timeCreated || 0) >= cutoff || part.id === latestCompaction?.id)
    : toolGroups.parsed
  const inWindow = (rows: Row[]): Row[] => rows.filter((item) => messageIdSet.has(str(item.message_id)))
  const taskToolRows = inWindow(loadTaskToolRows(args.sessionId))
  const taskTextRows = inWindow(loadTaskTextRows(args.sessionId))
  const currentOnly = (rows: Row[]): Row[] => cutoff === null ? rows : rows.filter((item) => Number(item.time_created || 0) >= cutoff)
  const tasks = summarizeTasks(args.view === "current_context" ? currentOnly(taskToolRows) : taskToolRows, args.view === "current_context" ? currentOnly(taskTextRows) : taskTextRows, childrenRows, args.maxOutputChars)
  const timeline = sortTimeline([
    ...(args.view === "audit" ? [] : visibleMessages.map(messageTimelineItem)),
    ...(args.view === "audit" ? [] : toolTimelineItems(toolParts, args.includeTools)),
    ...(args.view === "audit" ? [] : taskTimelineItems(tasks)),
    ...compactionTimelineItems(args.view === "current_context" && latestCompaction ? [latestCompaction] : compactions),
    ...(args.includeChildren === "none" ? [] : childTimelineItems(children)),
    ...(args.includeEvents ? eventTimelineItems(events) : []),
  ])
  const oldest = timeline[0] || {}
  const newest = timeline[timeline.length - 1] || {}
  return enforceMaxTotalChars({
    ok: true,
    source: { type: "opencode-db", mode: "read-only", tables: ["session", "project", "message", "part", "event", "todo", "session_message"] },
    session: summarizeSessionForIndex(row),
    counts,
    storageMode: mode,
    diagnostics: diag,
    timeline,
    warnings,
    view: args.view,
    window: {
      messageLimit: args.limitMessages,
      messagesReturned: visibleMessages.length,
      partsLoaded: partRows.length,
      oldestCreatedAt: oldest.createdAt || null,
      newestCreatedAt: newest.createdAt || null,
    },
    limits: { limitMessages: args.limitMessages, limitParts: args.limitParts, maxOutputChars: args.maxOutputChars, maxTotalChars: args.maxTotalChars, includeParts: args.includeParts, includeTools: args.includeTools },
  }, args.maxTotalChars)
}

export function buildInspectPayload(args: { sessionId: string, messageId?: string, partId?: string, callId?: string, taskId?: string, childSessionId?: string, includeParts: Exclude<DetailMode, "none">, includeToolIO: Exclude<DetailMode, "none">, maxOutputChars: number }) {
  const row = loadSessionRow(args.sessionId)
  if (!row) return { ok: false, error: { code: "SESSION_NOT_FOUND", message: `Session not found: ${args.sessionId}` }, ref: { sessionId: args.sessionId } }
  const targetCount = [args.messageId, args.partId, args.callId, args.taskId, args.childSessionId].filter(Boolean).length
  if (!targetCount) return { ok: false, error: { code: "INVALID_ARGUMENT", message: "Provide one target: messageId | partId | callId | taskId | childSessionId" }, ref: { sessionId: args.sessionId } }
  if (targetCount > 1) return { ok: false, error: { code: "INVALID_ARGUMENT", message: "Provide exactly one target for session_inspect" }, ref: { sessionId: args.sessionId } }
  const warnings: Array<Record<string, unknown>> = []
  const counts = loadCounts(args.sessionId)
  const base = {
    ok: true,
    session: parseSession(row),
    counts,
    storageMode: storageMode(counts),
    diagnostics: diagnostics(counts),
    warnings,
    source: { type: "opencode-db", mode: "read-only", tables: ["session", "project", "message", "part", "event", "todo", "session_message"] },
  }
  if (args.messageId) {
    const messageRow = loadMessageRow(args.sessionId, args.messageId)
    if (!messageRow) return { ...base, ok: false, error: { code: "TARGET_NOT_FOUND", message: `messageId not found: ${args.messageId}` } }
    const parts = loadPartRowsForMessage(args.sessionId, args.messageId)
    const grouped = groupByMessage(parts, { detailMode: args.includeParts, toolMode: args.includeToolIO, maxOutputChars: args.maxOutputChars, warnings })
    return { ...base, target: { type: "message", messageId: args.messageId }, message: summarizeMessage(messageRow, grouped.byMessage.get(args.messageId) || [], true) }
  }
  if (args.partId) {
    const partRow = loadPartRow(args.sessionId, args.partId)
    if (!partRow) return { ...base, ok: false, error: { code: "TARGET_NOT_FOUND", message: `partId not found: ${args.partId}` } }
    return { ...base, target: { type: "part", partId: args.partId }, part: parsePart(partRow, { detailMode: args.includeParts, toolMode: args.includeToolIO, maxOutputChars: args.maxOutputChars, warnings }) }
  }
  if (args.callId) {
    const rows = loadToolRowsByCallId(args.sessionId, args.callId)
    if (!rows.length) return { ...base, ok: false, error: { code: "TARGET_NOT_FOUND", message: `callId not found: ${args.callId}` } }
    const parts = rows.map((toolRow) => parsePart(toolRow, { detailMode: "summary", toolMode: args.includeToolIO, maxOutputChars: args.maxOutputChars, warnings }))
    const latest = parts[parts.length - 1] as Dict
    return {
      ...base,
      target: { type: "call", callId: args.callId },
      toolCall: {
        sessionId: str(latest.sessionId),
        messageId: str(latest.messageId),
        partId: str(latest.id),
        callId: args.callId,
        tool: latest.tool || null,
        status: latest.status || null,
        title: latest.title || null,
        input: latest.input || null,
        output: latest.output || null,
        metadata: latest.metadata || null,
        time: latest.time || null,
        updateCount: parts.length,
        updates: parts,
      },
    }
  }
  if (args.taskId) {
    const childrenRows = loadChildren(args.sessionId)
    const tasks = summarizeTasks(loadTaskToolRows(args.sessionId), loadTaskTextRows(args.sessionId), childrenRows, args.maxOutputChars)
    const task = tasks.find((item) => str(item.taskId) === args.taskId)
    if (!task) return { ...base, ok: false, error: { code: "TARGET_NOT_FOUND", message: `taskId not found: ${args.taskId}` } }
    return { ...base, target: { type: "task", taskId: args.taskId }, task }
  }
  const childRow = loadSessionRow(args.childSessionId!)
  if (!childRow || childRow.parent_id !== args.sessionId) return { ...base, ok: false, error: { code: "TARGET_NOT_FOUND", message: `childSessionId not found: ${args.childSessionId}` } }
  const childCounts = loadCounts(args.childSessionId!)
  return {
    ...base,
    target: { type: "child-session", childSessionId: args.childSessionId },
    childSession: {
      session: parseSession(childRow),
      counts: childCounts,
      storageMode: storageMode(childCounts),
      diagnostics: diagnostics(childCounts),
    },
  }
}

export function renderReadMarkdown(result: Dict): string {
  if (result.ok === false) return `# session_read\n\n${str(obj(result.error).message)}`
  const session = obj(result.session)
  const counts = obj(result.counts)
  const lines = [
    `# ${str(session.title) || str(session.id)}`,
    "",
    `- sessionId: \`${str(session.id)}\``,
    `- project: \`${str(obj(session.project).name) || str(obj(session.project).id) || "unknown"}\``,
    `- storageMode: ${str(result.storageMode)}`,
    `- diagnostics: ${str(obj(result.diagnostics).reason)}`,
    `- counts: message=${counts.message_count || 0}, part=${counts.part_count || 0}, event=${counts.event_count || 0}, legacy=${counts.session_message_count || 0}`,
    "",
    "## Messages",
  ]
  for (const message of Array.isArray(result.messages) ? result.messages as Dict[] : []) {
    lines.push("", `### ${str(message.role)} \`${str(message.id)}\``, str(obj(message.excerpt).text))
  }
  return lines.join("\n")
}
