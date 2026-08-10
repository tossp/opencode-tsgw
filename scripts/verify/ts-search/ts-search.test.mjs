// 冻结于 2026-08-10（v0.1 行为契约）。
// 黄金值从当前已验收的 dist 产物推导并人工复核；修改实现时不得以放宽断言替代行为审查。
import assert from "node:assert/strict"
import test from "node:test"

import { injectAutoSearchParams } from "../../../dist/ts-search/chat-params.js"
import { tsSearch } from "../../../dist/ts-search/index.js"
import { buildSearchResultMetadata, renderMergedResult } from "../../../dist/ts-search/render.js"
import { collectUrls, extractAnswer } from "../../../dist/ts-search/response.js"
import { createTsSearchTool } from "../../../dist/ts-search/tool.js"

const SEARCH_MODELS = ["gpt-5.4", "grok-4.20-fast"]

const dualRouteResults = [
  {
    family: "gpt",
    model: "gpt-5.4",
    ok: true,
    answer: "OpenCode is extensible.",
    urls: ["https://opencode.ai/docs", "https://example.test/shared"],
    requestId: "gpt-req-001",
    error: "",
  },
  {
    family: "grok",
    model: "grok-4.20-fast",
    ok: true,
    answer: "OpenCode uses plugins.",
    urls: ["https://example.test/shared", "https://x.ai/search"],
    requestId: "grok-req-002",
    error: "",
  },
]

const dualRouteOutput = `backend: aih
result: success
searched models:
- gpt: gpt-5.4
- grok: grok-4.20-fast
gpt answer:
OpenCode is extensible.
grok answer:
OpenCode uses plugins.
merged source URLs:
- https://opencode.ai/docs
- https://example.test/shared
- https://x.ai/search
ah-request-ids:
- gpt: gpt-req-001
- grok: grok-req-002
note: results differ across model families`

const unavailableOutput = `backend: aih
result: failed
searched models:
- gpt: gpt-5.4
- grok: grok-4.20-fast
gpt answer:
[failed] [TSGW_CONFIG] TSGW runtime provider configuration is unavailable.
grok answer:
[failed] [TSGW_CONFIG] TSGW runtime provider configuration is unavailable.
merged source URLs:
- none
ah-request-ids:
- gpt: n/a
- grok: n/a
failure summary: GPT and Grok routes both failed.`

function unavailableMetadata() {
  return {
    backend: "aih",
    status: "failed",
    models: SEARCH_MODELS,
    routes: [
      {
        family: "gpt",
        model: "gpt-5.4",
        status: "failed",
        requestId: "",
        sourceUrls: [],
      },
      {
        family: "grok",
        model: "grok-4.20-fast",
        status: "failed",
        requestId: "",
        sourceUrls: [],
      },
    ],
  }
}

function toolContext(metadataCalls) {
  return {
    abort: new AbortController().signal,
    metadata(value) {
      metadataCalls.push(value)
    },
  }
}

function providerResponse(models) {
  return {
    data: {
      providers: [
        {
          id: "tsgw",
          options: { baseURL: "https://gateway.example.test/v1" },
          models,
        },
      ],
    },
  }
}

test("render: 双路成功结果的输出和 metadata 冻结", () => {
  assert.equal(renderMergedResult(dualRouteResults), dualRouteOutput)
  assert.deepEqual(buildSearchResultMetadata(dualRouteResults), {
    backend: "aih",
    status: "success",
    models: SEARCH_MODELS,
    routes: [
      {
        family: "gpt",
        model: "gpt-5.4",
        status: "success",
        requestId: "gpt-req-001",
        sourceUrls: ["https://opencode.ai/docs", "https://example.test/shared"],
      },
      {
        family: "grok",
        model: "grok-4.20-fast",
        status: "success",
        requestId: "grok-req-002",
        sourceUrls: ["https://example.test/shared", "https://x.ai/search"],
      },
    ],
  })
})

test("render: 空结果的失败输出和 metadata 冻结", () => {
  assert.equal(renderMergedResult([]), `backend: aih
result: failed
searched models:
- gpt: gpt-5.4
- grok: grok-4.20-fast
gpt answer:
[failed] Unknown error.
grok answer:
[failed] Unknown error.
merged source URLs:
- none
ah-request-ids:
- gpt: n/a
- grok: n/a
failure summary: GPT and Grok routes both failed.`)
  assert.deepEqual(buildSearchResultMetadata([]), {
    backend: "aih",
    status: "failed",
    models: SEARCH_MODELS,
    routes: [],
  })
})

test("response: 提取答案并以遍历顺序收集去重 URL", () => {
  const response = {
    choices: [
      {
        message: {
          content: [
            { text: "OpenCode plugin guide: https://opencode.ai/docs/plugins." },
            { content: "Reference: https://example.test/reference)." },
          ],
        },
      },
    ],
    citations: [{ url: "https://source.example.test/article" }],
    nested: { reference_url: "https://nested.example.test/path," },
  }

  assert.equal(
    extractAnswer(response),
    "OpenCode plugin guide: https://opencode.ai/docs/plugins.\nReference: https://example.test/reference).",
  )
  assert.deepEqual(Array.from(collectUrls(response)), [
    "https://opencode.ai/docs/plugins",
    "https://example.test/reference",
    "https://source.example.test/article",
    "https://nested.example.test/path",
  ])
})

test("chat.params: GPT 和 Grok 分别注入冻结的搜索参数", () => {
  const gptOutput = { options: { temperature: 0.1 } }
  injectAutoSearchParams({ model: { id: "tsgw/gpt-5.4" } }, gptOutput)
  assert.deepEqual(gptOutput.options, {
    temperature: 0.1,
    tools: [{ type: "web_search" }],
  })

  const grokOutput = { options: { stream: true } }
  injectAutoSearchParams({ model: { id: "tsgw/grok-4.20-fast" } }, grokOutput)
  assert.deepEqual(grokOutput.options, {
    stream: true,
    search_parameters: {},
  })
})

test("tool: unavailable 状态返回同形的冻结 ToolResult", async () => {
  const definition = createTsSearchTool({
    client: {},
    directory: "/fixture",
    getApiKey: async () => "not-used",
    availability: "unavailable",
  })
  const metadataCalls = []
  const result = await definition.execute({ query: "opencode plugin" }, toolContext(metadataCalls))

  assert.deepEqual(metadataCalls, [{
    title: "TS Search",
    metadata: { backend: "aih", models: SEARCH_MODELS },
  }])
  assert.deepEqual(result, {
    title: "TS Search",
    output: unavailableOutput,
    metadata: unavailableMetadata(),
  })
})

test("plugin: 按模型三层注册逻辑", async (t) => {
  await t.test("有目标活跃模型时注册 ts_search", async () => {
    const hooks = await tsSearch({
      client: { config: { providers: async () => providerResponse({ "gpt-5.4": { status: "active" } }) } },
      directory: "/fixture",
    })

    assert.equal(hooks.auth.provider, "tsgw")
    assert.equal(typeof hooks["chat.params"], "function")
    assert.deepEqual(Object.keys(hooks.tool), ["ts_search"])
  })

  await t.test("无目标活跃模型时不注册工具", async () => {
    const hooks = await tsSearch({
      client: { config: { providers: async () => providerResponse({ "gpt-5.4": { status: "inactive" } }) } },
      directory: "/fixture",
    })

    assert.deepEqual(Object.keys(hooks.tool), [])
  })

  await t.test("配置探测失败时保留工具并返回 unavailable", async () => {
    const hooks = await tsSearch({
      client: { config: { providers: async () => { throw new Error("fixture provider probe failure") } } },
      directory: "/fixture",
    })
    const metadataCalls = []
    const result = await hooks.tool.ts_search.execute({ query: "opencode plugin" }, toolContext(metadataCalls))

    assert.deepEqual(Object.keys(hooks.tool), ["ts_search"])
    assert.deepEqual(result, {
      title: "TS Search",
      output: unavailableOutput,
      metadata: unavailableMetadata(),
    })
  })
})
