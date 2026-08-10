import type { Row } from "./contract.js"
import { asIso, decodeText, sqlList, sqlString, str } from "./value.js"

type BunSpawnSyncResult = {
  exitCode: number
  stdout: Uint8Array | string
  stderr: Uint8Array | string
}

type BunRuntime = {
  spawnSync(options: {
    cmd: string[]
    stdout: "pipe"
    stderr: "pipe"
  }): BunSpawnSyncResult
}

declare const Bun: BunRuntime

export function readQuery(sql: string): Row[] {
  const result = Bun.spawnSync({ cmd: ["opencode", "--pure", "db", sql, "--format", "json"], stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error((decodeText(result.stderr) || decodeText(result.stdout) || "opencode db failed").trim())
  const text = decodeText(result.stdout).trim()
  if (!text) return []
  const parsed: unknown = JSON.parse(text)
  return Array.isArray(parsed) ? parsed as Row[] : []
}

export const messageBaseSelect = `
  s.id, s.project_id, s.parent_id, s.slug, s.directory, s.title, s.version, s.share_url,
  s.agent, s.model, s.path, s.metadata, s.time_created, s.time_updated,
  p.name as project_name, p.worktree as project_worktree, p.vcs as project_vcs
`

export function loadSessionRow(sessionId: string): Row | null {
  return readQuery(`select ${messageBaseSelect} from session s join project p on p.id = s.project_id where s.id = ${sqlString(sessionId)} limit 1`)[0] || null
}

export function loadCounts(sessionId: string) {
  const row = readQuery(`
    select
      (select count(*) from session_message where session_id = ${sqlString(sessionId)}) as session_message_count,
      (select count(*) from message where session_id = ${sqlString(sessionId)}) as message_count,
      (select count(*) from part where session_id = ${sqlString(sessionId)}) as part_count,
      (select count(*) from event where aggregate_id = ${sqlString(sessionId)}) as event_count,
      (select count(*) from session where parent_id = ${sqlString(sessionId)}) as child_session_count,
      (select count(*) from todo where session_id = ${sqlString(sessionId)}) as todo_count
  `)[0] || {}
  return {
    session_message_count: Number(row.session_message_count || 0),
    message_count: Number(row.message_count || 0),
    part_count: Number(row.part_count || 0),
    event_count: Number(row.event_count || 0),
    child_session_count: Number(row.child_session_count || 0),
    todo_count: Number(row.todo_count || 0),
  }
}

export function loadMessageRows(sessionId: string, limit: number): Row[] {
  return readQuery(`
    select id, session_id, time_created, time_updated, data from (
      select id, session_id, time_created, time_updated, data
      from message where session_id = ${sqlString(sessionId)} order by time_created desc limit ${limit}
    ) order by time_created asc
  `)
}

export function loadMessageRow(sessionId: string, messageId: string): Row | null {
  return readQuery(`select id, session_id, time_created, time_updated, data from message where session_id = ${sqlString(sessionId)} and id = ${sqlString(messageId)} limit 1`)[0] || null
}

export function loadPartRows(sessionId: string, messageIds: string[], limit: number): Row[] {
  if (!messageIds.length) return []
  return readQuery(`
    select id, message_id, session_id, time_created, time_updated, data from (
      select id, message_id, session_id, time_created, time_updated, data
      from part where session_id = ${sqlString(sessionId)} and message_id in (${sqlList(messageIds)}) order by time_created desc limit ${limit}
    ) order by time_created asc
  `)
}

export function loadPartRowsForMessage(sessionId: string, messageId: string): Row[] {
  return readQuery(`select id, message_id, session_id, time_created, time_updated, data from part where session_id = ${sqlString(sessionId)} and message_id = ${sqlString(messageId)} order by time_created asc`)
}

export function loadPartRow(sessionId: string, partId: string): Row | null {
  return readQuery(`select id, message_id, session_id, time_created, time_updated, data from part where session_id = ${sqlString(sessionId)} and id = ${sqlString(partId)} limit 1`)[0] || null
}

export const loadCompactionRows = (sessionId: string): Row[] => readQuery(`select id, message_id, session_id, time_created, time_updated, data from part where session_id = ${sqlString(sessionId)} and json_extract(data, '$.type') = 'compaction' order by time_created asc`)
export const loadTaskToolRows = (sessionId: string): Row[] => readQuery(`select id, message_id, session_id, time_created, time_updated, data from part where session_id = ${sqlString(sessionId)} and json_extract(data, '$.type') in ('tool','tool-call') and json_extract(data, '$.tool') = 'task' order by time_created asc`)
export const loadTaskTextRows = (sessionId: string): Row[] => readQuery(`select id, message_id, session_id, time_created, time_updated, data from part where session_id = ${sqlString(sessionId)} and json_extract(data, '$.type') = 'text' and data like '%<task id=%' order by time_created asc`)
export const loadToolRowsByCallId = (sessionId: string, callId: string): Row[] => readQuery(`select id, message_id, session_id, time_created, time_updated, data from part where session_id = ${sqlString(sessionId)} and json_extract(data, '$.type') in ('tool','tool-call') and json_extract(data, '$.callID') = ${sqlString(callId)} order by time_created asc`)

export function loadTodos(sessionId: string) {
  return readQuery(`select session_id, content, status, priority, position, time_created, time_updated from todo where session_id = ${sqlString(sessionId)} order by position asc`).map((row: Row) => ({
    sessionId: str(row.session_id), content: str(row.content), status: str(row.status), priority: str(row.priority), position: row.position,
    timeCreated: row.time_created, timeUpdated: row.time_updated, createdAt: asIso(row.time_created), updatedAt: asIso(row.time_updated), ref: { sessionId: str(row.session_id), todoPosition: row.position },
  }))
}

export function loadEvents(sessionId: string, limit: number): Row[] {
  return readQuery(`select id, aggregate_id, seq, type, data from (select id, aggregate_id, seq, type, data from event where aggregate_id = ${sqlString(sessionId)} order by seq desc limit ${limit}) order by seq asc`)
}

export function loadChildren(sessionId: string): Row[] {
  return readQuery(`
    select ${messageBaseSelect},
      (select count(*) from session_message sm where sm.session_id = s.id) as session_message_count,
      (select count(*) from message m where m.session_id = s.id) as message_count,
      (select count(*) from part pt where pt.session_id = s.id) as part_count,
      (select count(*) from event e where e.aggregate_id = s.id) as event_count,
      (select count(*) from session c where c.parent_id = s.id) as child_session_count,
      (select count(*) from todo td where td.session_id = s.id) as todo_count
    from session s join project p on p.id = s.project_id
    where s.parent_id = ${sqlString(sessionId)} order by s.time_created asc
  `)
}
