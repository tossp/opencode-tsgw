import { DEFAULT_OUTPUT_LIMIT, SUMMARY_EXCERPT_LIMIT } from "./contract.js"
import type { DetailMode, Dict, Row } from "./contract.js"
import { excerpt, summarizeToolMetadata } from "./content.js"
import { parsePart } from "./parts.js"
import { loadChildren } from "./repository.js"
import { diagnostics, parseSession, storageMode } from "./session.js"
import { asIso, bool, obj, safeJsonParse, str } from "./value.js"

export function summarizeMessage(row: Row, parts: ReturnType<typeof parsePart>[], includeParts: boolean) {
  const data = obj(safeJsonParse(row.data))
  const textParts = parts.filter((part) => part.type === "text")
  const visibleText = textParts.map((part) => str((part as Dict).text) || str((part as Dict).excerpt)).filter(Boolean).join("\n\n")
  const content = str(data.content)
  const fallback = visibleText || content || parts.filter((part) => part.type === "tool" || part.type === "tool-call").map((part) => str((part as Dict).tool) || "tool").join(", ")
  const types = parts.reduce<Record<string, number>>((acc, part) => ((acc[part.type] = (acc[part.type] || 0) + 1), acc), {})
  return {
    id: str(row.id),
    sessionId: str(row.session_id),
    role: str(data.role) || "unknown",
    parentId: data.parentID || null,
    agent: data.agent || null,
    mode: data.mode || null,
    model: data.model || (data.modelID || data.providerID ? { modelID: data.modelID || null, providerID: data.providerID || null, variant: data.variant || null } : null),
    finish: data.finish || null,
    path: data.path || null,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    createdAt: asIso(row.time_created),
    updatedAt: asIso(row.time_updated),
    excerpt: excerpt(fallback, DEFAULT_OUTPUT_LIMIT),
    partCount: parts.length,
    partTypes: types,
    parts: includeParts ? parts : undefined,
    ref: { sessionId: str(row.session_id), messageId: str(row.id) },
  }
}

export function parseTaskTags(text: string, limit: number): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = []
  const pattern = /<task\s+id="([^"]+)"\s+state="([^"]+)"[^>]*>([\s\S]*?)<task_result>([\s\S]*?)<\/task_result>[\s\S]*?<\/task>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(match[3])
    const result = excerpt(match[4].trim(), Math.min(limit, SUMMARY_EXCERPT_LIMIT))
    items.push({ taskId: match[1], state: match[2], summary: summaryMatch?.[1]?.trim() || null, resultExcerpt: result.text, truncated: result.truncated, length: result.length })
  }
  return items
}

export function summarizeTaskChild(row: Row) {
  const counts = { message_count: Number(row.message_count || 0), part_count: Number(row.part_count || 0), event_count: Number(row.event_count || 0) }
  return {
    sessionId: str(row.id),
    title: str(row.title) || null,
    agent: row.agent || null,
    storageMode: storageMode({
      session_message_count: Number(row.session_message_count || 0),
      message_count: counts.message_count,
      part_count: counts.part_count,
      event_count: counts.event_count,
      child_session_count: Number(row.child_session_count || 0),
      todo_count: Number(row.todo_count || 0),
    }),
    counts,
    ref: { sessionId: str(row.id) },
  }
}

export function summarizeTasks(taskToolRows: Row[], taskTextRows: Row[], children: ReturnType<typeof loadChildren>, maxOutputChars: number): Dict[] {
  const map = new Map<string, Dict>()
  const childMap = new Map(children.map((row) => [str(row.id), row]))
  const ensure = (id: string) => {
    if (!map.has(id)) map.set(id, { taskId: id, calls: [], completions: [], childSession: null })
    return map.get(id) as Dict & { calls: Record<string, unknown>[], completions: Record<string, unknown>[], childSession: unknown }
  }
  const addCompletion = (task: Dict & { completions: Record<string, unknown>[] }, completion: Record<string, unknown>) => {
    const key = `${str(completion.taskId)}:${str(completion.state)}:${str(completion.summary)}:${str(completion.resultExcerpt)}`
    if (task.completions.some((item) => `${str(item.taskId)}:${str(item.state)}:${str(item.summary)}:${str(item.resultExcerpt)}` === key)) return
    task.completions.push(completion)
  }
  for (const row of taskToolRows) {
    const data = obj(safeJsonParse(row.data))
    const state = obj(data.state)
    const input = obj(state.input)
    const meta = obj(state.metadata)
    const taskId = str(input.task_id) || str(meta.sessionId) || str(meta.jobId) || str(data.callID) || str(row.id)
    const task = ensure(taskId)
    const tags = parseTaskTags(str(state.output), Math.min(maxOutputChars, SUMMARY_EXCERPT_LIMIT))
    const promptExcerpt = excerpt(input.prompt, Math.min(maxOutputChars, SUMMARY_EXCERPT_LIMIT))
    task.calls.push({
      partId: str(row.id),
      messageId: str(row.message_id),
      callId: str(data.callID) || null,
      status: str(state.status) || null,
      subagentType: input.subagent_type || null,
      description: input.description || null,
      background: input.background ?? null,
      taskId: input.task_id || null,
      promptExcerpt: promptExcerpt.text,
      promptLength: promptExcerpt.length,
      promptTruncated: promptExcerpt.truncated,
      metadata: summarizeToolMetadata(meta),
      completionCount: tags.length,
      time: obj(state.time),
      timeCreated: row.time_created,
      createdAt: asIso(row.time_created),
      ref: { sessionId: str(row.session_id), messageId: str(row.message_id), partId: str(row.id), callId: str(data.callID) || null, taskId },
    })
    for (const item of tags) addCompletion(task, { ...item, partId: str(row.id), messageId: str(row.message_id), timeCreated: row.time_created, createdAt: asIso(row.time_created), ref: { sessionId: str(row.session_id), messageId: str(row.message_id), partId: str(row.id), taskId: str(item.taskId) } })
    const childId = str(meta.sessionId) || str(input.task_id)
    if (childId && childMap.has(childId)) task.childSession = summarizeTaskChild(childMap.get(childId) as Row)
  }
  for (const row of taskTextRows) {
    const data = obj(safeJsonParse(row.data))
    for (const item of parseTaskTags(str(data.text), Math.min(maxOutputChars, SUMMARY_EXCERPT_LIMIT))) {
      const task = ensure(str(item.taskId))
      addCompletion(task, { ...item, partId: str(row.id), messageId: str(row.message_id), timeCreated: row.time_created, createdAt: asIso(row.time_created), ref: { sessionId: str(row.session_id), messageId: str(row.message_id), partId: str(row.id), taskId: str(item.taskId) } })
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const ac = (a as Dict & { calls?: Dict[], completions?: Dict[] }).calls?.[0]
    const at = (a as Dict & { calls?: Dict[], completions?: Dict[] }).completions?.[0]
    const bc = (b as Dict & { calls?: Dict[], completions?: Dict[] }).calls?.[0]
    const bt = (b as Dict & { calls?: Dict[], completions?: Dict[] }).completions?.[0]
    return Number(ac?.timeCreated || at?.timeCreated || 0) - Number(bc?.timeCreated || bt?.timeCreated || 0)
  })
}

export function summarizeCompactions(rows: Row[]) {
  return rows.map((row) => {
    const data = obj(safeJsonParse(row.data))
    return {
      id: str(row.id),
      messageId: str(row.message_id),
      sessionId: str(row.session_id),
      type: "compaction",
      auto: bool(data.auto),
      tailStartId: data.tail_start_id || null,
      marker: data.marker || null,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
      createdAt: asIso(row.time_created),
      updatedAt: asIso(row.time_updated),
      ref: { sessionId: str(row.session_id), messageId: str(row.message_id), partId: str(row.id) },
    }
  })
}

export function summarizeEvents(rows: Row[]) {
  return rows.map((row) => {
    const data = obj(safeJsonParse(row.data))
    const part = obj(data.part)
    const info = obj(data.info)
    const summary = part.type === "reasoning"
      ? `reasoning omitted for ${str(part.messageID) || str(part.messageId) || "unknown-message"}`
      : str(part.type)
        ? `${str(part.type)} part for ${str(part.messageID) || str(part.messageId) || "unknown-message"}`
        : excerpt(info.title || info.id || data.sessionID || data.messageID || data, SUMMARY_EXCERPT_LIMIT).text
    return { id: str(row.id), aggregateId: str(row.aggregate_id), seq: row.seq, type: str(row.type), summary, ref: { sessionId: str(row.aggregate_id), eventId: str(row.id) } }
  })
}

export function summarizeChild(row: Row, includeDiagnostic = true) {
  const counts = {
    session_message_count: Number(row.session_message_count || 0),
    message_count: Number(row.message_count || 0),
    part_count: Number(row.part_count || 0),
    event_count: Number(row.event_count || 0),
    child_session_count: Number(row.child_session_count || 0),
    todo_count: Number(row.todo_count || 0),
  }
  return {
    session: parseSession(row),
    counts,
    storageMode: storageMode(counts),
    diagnostics: includeDiagnostic ? diagnostics(counts) : undefined,
  }
}

export function messageTimelineItem(message: ReturnType<typeof summarizeMessage>) {
  const item: Dict = {
    kind: "message",
    sessionId: message.sessionId,
    messageId: message.id,
    role: message.role,
    summary: str(message.excerpt.text),
    excerpt: message.excerpt,
    createdAt: message.createdAt,
    partCount: message.partCount,
    partTypes: message.partTypes,
    counts: { partCount: message.partCount },
    ref: message.ref,
  }
  if (message.parts) item.parts = message.parts
  return item
}

export function toolTimelineItems(parts: ReturnType<typeof parsePart>[], includeTools: DetailMode): Dict[] {
  return parts
    .filter((part) => part.type === "tool" || part.type === "tool-call")
    .map((part) => {
      const data = part as Dict
      const item: Dict = {
        kind: "tool",
        sessionId: part.sessionId,
        messageId: part.messageId,
        partId: part.id,
        callId: data.callId || null,
        tool: data.tool || null,
        status: data.status || null,
        title: data.title || null,
        summary: data.title || data.tool || "tool",
        createdAt: part.createdAt,
        counts: { updates: 1 },
        ref: part.ref,
      }
      if (includeTools !== "none") {
        item.input = data.input || null
        item.output = data.output || null
        item.metadata = data.metadata || null
      }
      return item
    })
}

export function taskTimelineItems(tasks: Dict[]): Dict[] {
  const items: Dict[] = []
  for (const task of tasks) {
    const calls = Array.isArray(task.calls) ? task.calls as Dict[] : []
    const completions = Array.isArray(task.completions) ? task.completions as Dict[] : []
    const firstCall = calls[0] || {}
    items.push({
      kind: "task",
      sessionId: str(obj(firstCall.ref).sessionId) || null,
      messageId: str(firstCall.messageId) || null,
      partId: str(firstCall.partId) || null,
      callId: str(firstCall.callId) || null,
      taskId: str(task.taskId),
      childSessionId: str(obj(task.childSession).sessionId) || null,
      status: firstCall.status || null,
      title: firstCall.description || firstCall.subagentType || "task",
      summary: firstCall.promptExcerpt || null,
      excerpt: firstCall.promptExcerpt ? { excerpt: str(firstCall.promptExcerpt), truncated: Boolean(firstCall.promptTruncated), length: Number(firstCall.promptLength || 0) } : null,
      createdAt: firstCall.createdAt || (completions[0] && completions[0].createdAt) || null,
      counts: { callCount: calls.length, completionCount: completions.length },
      ref: obj(firstCall.ref),
    })
    for (const completion of completions) {
      items.push({
        kind: "task-completion",
        sessionId: str(obj(completion.ref).sessionId) || null,
        messageId: completion.messageId || null,
        partId: completion.partId || null,
        taskId: completion.taskId || null,
        status: completion.state || null,
        title: completion.summary || "task completion",
        summary: completion.resultExcerpt || null,
        excerpt: { excerpt: str(completion.resultExcerpt), truncated: Boolean(completion.truncated), length: Number(completion.length || 0) },
        createdAt: completion.createdAt || null,
        ref: completion.ref || null,
      })
    }
  }
  return items
}

export function compactionTimelineItems(compactions: ReturnType<typeof summarizeCompactions>): Dict[] {
  return compactions.map((compaction) => ({
    kind: "compaction",
    sessionId: compaction.sessionId,
    messageId: compaction.messageId,
    partId: compaction.id,
    summary: compaction.marker || "compaction",
    title: compaction.marker || "compaction",
    createdAt: compaction.createdAt,
    counts: { auto: compaction.auto },
    ref: compaction.ref,
  }))
}

export function childTimelineItems(children: ReturnType<typeof summarizeChild>[]): Dict[] {
  return children.map((child) => ({
    kind: "child-session",
    sessionId: str(obj(child.session).id),
    childSessionId: str(obj(child.session).id),
    title: str(obj(child.session).title) || null,
    summary: str(obj(child.diagnostics).reason) || null,
    createdAt: obj(child.session).createdAt || null,
    counts: child.counts,
    status: child.storageMode,
    ref: obj(child.session).ref,
  }))
}

export function eventTimelineItems(events: ReturnType<typeof summarizeEvents>): Dict[] {
  return events.map((event) => ({
    kind: "event",
    sessionId: event.aggregateId,
    title: event.type,
    summary: event.summary,
    createdAt: null,
    counts: { seq: event.seq },
    ref: event.ref,
  }))
}

export function sortTimeline(items: Dict[]): Dict[] {
  return items.sort((a, b) => {
    const at = Date.parse(str(a.createdAt) || "")
    const bt = Date.parse(str(b.createdAt) || "")
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt
    return str(a.kind).localeCompare(str(b.kind))
  })
}
