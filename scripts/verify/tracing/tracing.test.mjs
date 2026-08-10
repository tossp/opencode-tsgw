// 冻结于 2026-08-10（v0.2 行为契约）。
// 黄金值从本地 tracing 插件迁移前的实现逐字推导并人工复核。
import assert from "node:assert/strict"
import test from "node:test"

import { tracing } from "../../../dist/tracing/index.js"

async function injectHeaders(input, headers = { Existing: "preserved" }) {
  const hooks = await tracing({})
  const output = { headers }

  await hooks["chat.headers"](input, output)
  return output.headers
}

test("chat.headers: tracing header 注入冻结", async (t) => {
  await t.test("缺少输入 sessionID 时不修改 headers", async () => {
    const headers = await injectHeaders({ message: { id: "trace-without-session" } })

    assert.deepEqual(headers, { Existing: "preserved" })
  })

  await t.test("有 session 且无 message 时注入线程 header", async () => {
    const headers = await injectHeaders({ sessionID: "thread-input" })

    assert.deepEqual(headers, {
      Existing: "preserved",
      "AH-Thread-Id": "thread-input",
    })
  })

  await t.test("message 无 id 时仅注入线程 header", async () => {
    const headers = await injectHeaders({ sessionID: "thread-input", message: {} })

    assert.deepEqual(headers, {
      Existing: "preserved",
      "AH-Thread-Id": "thread-input",
    })
  })

  await t.test("message 有 id 时注入 trace header", async () => {
    const headers = await injectHeaders({ sessionID: "thread-input", message: { id: "trace-message" } })

    assert.deepEqual(headers, {
      Existing: "preserved",
      "AH-Thread-Id": "thread-input",
      "AH-Trace-Id": "trace-message",
    })
  })

  await t.test("message sessionID 覆盖输入 sessionID", async () => {
    const headers = await injectHeaders({
      sessionID: "thread-input",
      message: { sessionID: "thread-message", id: "trace-message" },
    })

    assert.deepEqual(headers, {
      Existing: "preserved",
      "AH-Thread-Id": "thread-message",
      "AH-Trace-Id": "trace-message",
    })
  })
})
