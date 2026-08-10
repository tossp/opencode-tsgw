// 冻结于 2026-08-10（v0.2 行为契约）。
// 夹具通过 Bun.spawnSync 替身覆盖只读查询；不得调用真实 opencode db 子进程。
import assert from "node:assert/strict"
import test from "node:test"

import { asToolResult, excerpt, redact } from "../../../dist/session-history/content.js"
import { buildInspectPayload } from "../../../dist/session-history/payloads.js"
import { sessionHistory } from "../../../dist/session-history/index.js"
import { readQuery } from "../../../dist/session-history/repository.js"

const SESSION_ID = "session-1"
const sessionRow = {
  id: SESSION_ID,
  project_id: "project-1",
  parent_id: null,
  slug: "fixture",
  directory: "/fixture",
  title: "Fixture session",
  version: "1.18.15",
  share_url: null,
  agent: "build",
  model: null,
  path: null,
  metadata: null,
  time_created: 0,
  time_updated: 0,
  project_name: "fixture-project",
  project_worktree: "/fixture",
  project_vcs: null,
}
const emptyCounts = {
  session_message_count: 0,
  message_count: 0,
  part_count: 0,
  event_count: 0,
  child_session_count: 0,
  todo_count: 0,
}

function installDbMock(rowsForQuery) {
  const calls = []
  globalThis.Bun = {
    spawnSync({ cmd }) {
      assert.deepEqual(cmd.slice(0, 3), ["opencode", "--pure", "db"])
      assert.match(cmd[3], /^\s*select\b/i)
      calls.push(cmd[3])
      return {
        exitCode: 0,
        stdout: new TextEncoder().encode(JSON.stringify(rowsForQuery(cmd[3]))),
        stderr: new Uint8Array(),
      }
    },
  }
  return calls
}

function fixtureRows(sql) {
  if (sql.includes("from session s join project p") && sql.includes(`s.id = '${SESSION_ID}'`)) return [sessionRow]
  if (sql.includes("session_message_count")) return [emptyCounts]
  return []
}

function schemaChecks(definition, valid, invalid) {
  assert.equal(definition.safeParse(valid).success, true)
  assert.equal(definition.safeParse(invalid).success, false)
}

test("工具参数: 三个工具的合法与非法矩阵冻结", async () => {
  const hooks = await sessionHistory({})
  const { session_read: read, session_timeline: timeline, session_inspect: inspect } = hooks.tool

  schemaChecks(read.args.sessionId, SESSION_ID, undefined)
  schemaChecks(read.args.includeParts, true, "true")
  schemaChecks(read.args.includeTodos, false, "false")
  schemaChecks(read.args.limitMessages, 50, 51)
  schemaChecks(read.args.limitMessages, 1, 0)
  schemaChecks(read.args.format, "markdown", "json")

  schemaChecks(timeline.args.sessionId, SESSION_ID, undefined)
  schemaChecks(timeline.args.view, "current_context", "context")
  schemaChecks(timeline.args.includeChildren, "full", "all")
  schemaChecks(timeline.args.includeParts, "summary", "detail")
  schemaChecks(timeline.args.includeTools, "none", "minimal")
  schemaChecks(timeline.args.includeEvents, true, "true")
  schemaChecks(timeline.args.limitMessages, 50, 51)
  schemaChecks(timeline.args.limitParts, 400, 401)
  schemaChecks(timeline.args.maxOutputChars, 12000, 12001)
  schemaChecks(timeline.args.maxTotalChars, 200000, 200001)

  schemaChecks(inspect.args.sessionId, SESSION_ID, undefined)
  for (const target of ["messageId", "partId", "callId", "taskId", "childSessionId"]) {
    schemaChecks(inspect.args[target], "target-1", 1)
  }
  schemaChecks(inspect.args.includeParts, "full", "none")
  schemaChecks(inspect.args.includeToolIO, "summary", "none")
  schemaChecks(inspect.args.maxOutputChars, 12000, 12001)
})

test("工具输出: 成功负载与 metadata 内嵌 payload", async () => {
  const calls = installDbMock(fixtureRows)
  const hooks = await sessionHistory({})

  const read = await hooks.tool.session_read.execute({ sessionId: ` ${SESSION_ID} `, includeParts: true, includeTodos: true, limitMessages: 50, format: "structured" })
  assert.deepEqual(Object.keys(read).sort(), ["metadata", "output", "title"])
  assert.equal(read.title, `session_read ${SESSION_ID}`)
  assert.equal(read.metadata.format, "structured")
  assert.equal(read.metadata.session_read.ok, true)
  assert.deepEqual(JSON.parse(read.output), read.metadata.session_read)

  const timeline = await hooks.tool.session_timeline.execute({
    sessionId: SESSION_ID,
    view: "audit",
    includeChildren: "none",
    includeParts: "full",
    includeTools: "full",
    includeEvents: false,
    limitMessages: 50,
    limitParts: 400,
    maxOutputChars: 12000,
    maxTotalChars: 200000,
  })
  assert.deepEqual(Object.keys(timeline).sort(), ["metadata", "output", "title"])
  assert.equal(timeline.title, `session_timeline ${SESSION_ID}`)
  assert.equal(timeline.metadata.session_timeline.ok, true)
  assert.equal(timeline.output, JSON.stringify(timeline.metadata.session_timeline))
  assert.ok(calls.length > 0)
})

test("失败负载: SESSION_NOT_FOUND、INVALID_ARGUMENT 与 TARGET_NOT_FOUND 冻结", async () => {
  const hooks = await sessionHistory({})

  installDbMock(() => [])
  const read = await hooks.tool.session_read.execute({ sessionId: "missing" })
  assert.deepEqual(JSON.parse(read.output), {
    ok: false,
    error: { code: "SESSION_NOT_FOUND", message: "Session not found: missing" },
    ref: { sessionId: "missing" },
    source: { type: "opencode-db", tables: ["session", "project"] },
  })
  assert.deepEqual(read.metadata.session_read, JSON.parse(read.output))

  installDbMock(fixtureRows)
  const invalid = await hooks.tool.session_inspect.execute({ sessionId: SESSION_ID })
  assert.deepEqual(JSON.parse(invalid.output).error, {
    code: "INVALID_ARGUMENT",
    message: "Provide one target: messageId | partId | callId | taskId | childSessionId",
  })
  const multiple = await hooks.tool.session_inspect.execute({ sessionId: SESSION_ID, messageId: "message-1", partId: "part-1" })
  assert.deepEqual(JSON.parse(multiple.output).error, {
    code: "INVALID_ARGUMENT",
    message: "Provide exactly one target for session_inspect",
  })
  const missingTarget = await hooks.tool.session_inspect.execute({ sessionId: SESSION_ID, messageId: "missing" })
  assert.deepEqual(JSON.parse(missingTarget.output).error, {
    code: "TARGET_NOT_FOUND",
    message: "messageId not found: missing",
  })
})

test("inspect: 恰一个 target 的成功负载保持结构", () => {
  const calls = installDbMock((sql) => {
    if (sql.includes("from session s join project p")) return [sessionRow]
    if (sql.includes("session_message_count")) return [emptyCounts]
    if (sql.includes("from message") && sql.includes("message-1")) {
      return [{ id: "message-1", session_id: SESSION_ID, time_created: 0, time_updated: 0, data: JSON.stringify({ role: "user", content: "hello" }) }]
    }
    return []
  })
  const result = buildInspectPayload({
    sessionId: SESSION_ID,
    messageId: "message-1",
    includeParts: "full",
    includeToolIO: "full",
    maxOutputChars: 12000,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.target, { type: "message", messageId: "message-1" })
  assert.equal(result.message.role, "user")
  assert.ok(calls.length >= 4)
})

test("内容脱敏与截断: 凭据模式及文本长度冻结", () => {
  assert.equal(
    redact("Bearer abc.def-123 token='secret' https://example.test/?signature=signed"),
    "Bearer [redacted] token='[redacted]' https://example.test/?signature=[redacted]",
  )
  assert.deepEqual(excerpt("abcdef", 4), {
    text: "abcd\n...[truncated 2 chars]",
    truncated: true,
    length: 6,
  })
  assert.deepEqual(asToolResult("title", "output", { payload: { ok: true } }), {
    title: "title",
    output: "output",
    metadata: { payload: { ok: true } },
  })
})

test("数据库命令失败: readQuery 保留原始错误而不包装", () => {
  globalThis.Bun = {
    spawnSync() {
      return {
        exitCode: 1,
        stdout: new Uint8Array(),
        stderr: new TextEncoder().encode("database unavailable"),
      }
    },
  }
  assert.throws(() => readQuery("select 1"), { message: "database unavailable" })
})
