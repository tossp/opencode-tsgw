// 冻结于 2026-08-10（v0.2 行为契约）。
// 本夹具只使用纯逻辑或 mock client；不调用远端 OpenCode server。
import assert from "node:assert/strict"
import test from "node:test"

import { resolveBaseUrlSelection } from "../../../dist/worktree-tools/connection.js"
import { createWorktreeTool } from "../../../dist/worktree-tools/create.js"
import { removeWorktreeAction, resetWorktreeAction } from "../../../dist/worktree-tools/dangerous-action.js"
import { createWorktreeRemoveTool } from "../../../dist/worktree-tools/remove.js"
import { createWorktreeResetTool } from "../../../dist/worktree-tools/reset.js"
import { getCurrentWorktreeName, isValidWorktreeName } from "../../../dist/worktree-tools/shared.js"
import { resolveNamedWorktreeDirectory } from "../../../dist/worktree-tools/target-resolution.js"

const selection = {
  baseUrl: "http://127.0.0.1:2086",
  candidatePrimary: "http://127.0.0.1:2086/",
  candidateFixed: "http://127.0.0.1:2086",
  probeDirectory: "/fixture",
  usesPrimary: true,
}

function toolContext({ directory = "/fixture", worktree = "" } = {}) {
  const metadataCalls = []
  return {
    context: {
      abort: new AbortController().signal,
      agent: "fixture",
      directory,
      messageID: "message-fixture",
      sessionID: "session-fixture",
      worktree,
      metadata(value) {
        metadataCalls.push(value)
      },
      async ask() {},
    },
    metadataCalls,
  }
}

function mockClient(directories) {
  return {
    worktree: {
      async list() {
        return { data: directories }
      },
    },
  }
}

test("connection: 无效 serverUrl 初始化时降级至固定地址", async () => {
  const fixedAddress = "http://127.0.0.1:2086"
  const result = await resolveBaseUrlSelection(
    { serverUrl: "not-a-url", directory: "/fixture", worktree: "" },
    fixedAddress,
  )

  assert.deepEqual(result, {
    baseUrl: fixedAddress,
    candidatePrimary: fixedAddress,
    candidateFixed: fixedAddress,
    probeDirectory: "/fixture",
    usesPrimary: false,
  })
})

test("target-resolution: basename 校验拒绝路径和父级标记", () => {
  assert.equal(isValidWorktreeName("feature-one"), true)
  assert.equal(isValidWorktreeName("nested/feature"), false)
  assert.equal(isValidWorktreeName("nested\\feature"), false)
  assert.equal(isValidWorktreeName("feature..old"), false)
  assert.equal(getCurrentWorktreeName({ worktree: "/sandbox/project/current" }), "current")
})

test("target-resolution: 当前 worktree 名称与唯一匹配失败保持冻结文案", async () => {
  const noMatch = await resolveNamedWorktreeDirectory({
    client: mockClient(["/sandbox/project/other"]),
    executionDirectory: "/fixture",
    name: "target",
  })
  assert.deepEqual(noMatch, {
    ok: false,
    refused: true,
    matchCount: 0,
    error: '未找到匹配名称 "target" 的 worktree。',
  })

  const multipleMatches = await resolveNamedWorktreeDirectory({
    client: mockClient(["/sandbox/one/target", "/sandbox/two/target"]),
    executionDirectory: "/fixture",
    name: "target",
  })
  assert.deepEqual(multipleMatches, {
    ok: false,
    refused: true,
    matchCount: 2,
    error: '找到多个匹配名称 "target" 的 worktree。',
  })
})

test("危险操作: remove/reset 保持各自 SDK 请求字段", async () => {
  const calls = []
  const client = {
    worktree: {
      async remove(request) {
        calls.push({ method: "remove", request })
        return { data: { removed: true } }
      },
      async reset(request) {
        calls.push({ method: "reset", request })
        return { data: { reset: true } }
      },
    },
  }

  await removeWorktreeAction.execute(client, "/fixture", "/sandbox/project/remove-target")
  await resetWorktreeAction.execute(client, "/fixture", "/sandbox/project/reset-target")

  assert.deepEqual(calls, [
    {
      method: "remove",
      request: {
        directory: "/fixture",
        worktreeRemoveInput: { directory: "/sandbox/project/remove-target" },
      },
    },
    {
      method: "reset",
      request: {
        directory: "/fixture",
        worktreeResetInput: { directory: "/sandbox/project/reset-target" },
      },
    },
  ])
})

test("拒绝文案: create/remove/reset 的非法输入保持冻结", async () => {
  const createContext = toolContext({ directory: "", worktree: "" })
  assert.deepEqual(await createWorktreeTool(selection).execute({}, createContext.context), {
    title: "worktree_create",
    output: "无法解析 worktree_create 的项目目录。",
    metadata: { ok: false },
  })

  const removeContext = toolContext()
  assert.deepEqual(await createWorktreeRemoveTool(selection).execute({ name: "nested/target" }, removeContext.context), {
    title: "worktree_remove",
    output: "拒绝: name 必须是合法的 worktree 名称，不能包含 '/'、'\\' 或 '..'。",
    metadata: { ok: false, refused: true, name: "nested/target" },
  })

  const resetContext = toolContext({ worktree: "/sandbox/project/current" })
  assert.deepEqual(await createWorktreeResetTool(selection).execute({ name: "current" }, resetContext.context), {
    title: "worktree_reset",
    output: "拒绝: 不允许重置当前 context.worktree。",
    metadata: { ok: false, refused: true, name: "current", currentWorktree: "/sandbox/project/current" },
  })
})
