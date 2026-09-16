import assert from "node:assert/strict"
import test from "node:test"

import { tsMark } from "../../../dist/ts-mark/index.js"

globalThis.fetch = async () => { throw new Error("Unexpected fetch: offline fixture") }
const directory = "/fixture/media"
const context = () => ({ directory, abort: new AbortController().signal, metadata() {} })
const cases = [
  ["ts_mark_image", "gpt-image-2", { prompt: "offline" }, "images/generations"],
  ["ts_mark_image", "gpt-5.6-luna", { prompt: "offline" }, "responses"],
  ["ts_mark_audio", "mimo-v2.5-tts", { text: "offline" }, "chat/completions"],
  ["ts_mark_audio", "mimo-v2.5-tts-voicedesign", { text: "offline", voice: "Warm narrator" }, "chat/completions"],
]
const models = Object.fromEntries(cases.map(([, model]) => [model, {
  status: "active", api: { url: `https://fixture.test/${model}/v1`, id: "DO-NOT-RENAME", npm: "DO-NOT-SWITCH" },
}]))

test("media: registration without legacy address executes each normalized model's own URL", async (t) => {
  let configReads = 0
  const client = { config: {
    providers: async () => ({ data: { providers: [{ id: "tsgw", models }] } }),
    get: async () => { configReads++; throw new Error("Unexpected config.get") },
  } }
  const hooks = await tsMark({ client, directory })
  assert.deepEqual(Object.keys(hooks.tool), ["ts_mark_image", "ts_mark_audio"])
  await hooks.auth.loader(async () => ({ type: "api", key: "fixture-key" }))
  const calls = []
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) })
    throw new Error("Intentional offline stop before generated artifact")
  })
  for (const [tool, model, args, endpoint] of cases) {
    const result = await hooks.tool[tool].execute({ ...args, model }, context())
    assert.equal(result.metadata.phase, "HTTP")
    assert.equal(result.output, "[HTTP] The TSGW request failed. No retry was attempted.")
    const request = calls.at(-1)
    assert.equal(request.url, `https://fixture.test/${model}/v1/${endpoint}`)
    assert.equal(request.body.model, model)
    assert.equal(request.headers.get("authorization"), "Bearer fixture-key")
    assert.equal(result.metadata.filepath, undefined)
  }
  // Omitted model parameters must resolve the unchanged default model addresses too.
  for (const [tool, model, args, endpoint] of [cases[0], cases[2]]) {
    const result = await hooks.tool[tool].execute(args, context())
    assert.equal(result.metadata.phase, "HTTP")
    assert.equal(calls.at(-1).url, `https://fixture.test/${model}/v1/${endpoint}`)
    assert.equal(calls.at(-1).body.model, model)
  }
  assert.equal(calls.length, cases.length + 2)
  assert.equal(configReads, 0)
})

test("media: missing selected model can request explicit provider default without borrowing", async (t) => {
  const calls = []
  const configCalls = []
  const client = { config: {
    providers: async () => ({ data: { providers: [{ id: "tsgw", models: { "gpt-image-2": models["gpt-image-2"], "mimo-v2.5-tts": models["mimo-v2.5-tts"] } }] } }),
    get: async (args) => { configCalls.push(args); return { data: { provider: { tsgw: { api: "https://fixture.test/default" } } } } },
  } }
  const hooks = await tsMark({ client, directory })
  await hooks.auth.loader(async () => ({ type: "api", key: "fixture-key" }))
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    throw new Error("Intentional offline stop")
  })
  for (const [tool, model, args, endpoint] of [cases[1], cases[3]]) {
    const result = await hooks.tool[tool].execute({ ...args, model }, context())
    assert.equal(result.metadata.phase, "HTTP")
    assert.equal(calls.at(-1).url, `https://fixture.test/default/${endpoint}`)
    assert.equal(calls.at(-1).body.model, model)
  }
  assert.equal(calls.length, 2)
  assert.deepEqual(configCalls, [{ query: { directory } }, { query: { directory } }])
})

test("media: address-free inactive models do not register; provider failures stay unavailable", async () => {
  const noActive = await tsMark({ client: { config: { providers: async () => ({ data: { providers: [{ id: "tsgw", models: {} }] } }) } }, directory })
  assert.deepEqual(noActive.tool, {})
  for (const response of [{ data: { providers: [] } }, {}, { error: "fixture" }, new Error("fixture")]) {
    let reads = 0
    const hooks = await tsMark({ client: { config: { providers: async () => {
      reads++
      if (reads > 1) return { data: { providers: [{ id: "tsgw", models }] } }
      if (response instanceof Error) throw response
      return response
    } } }, directory })
    assert.deepEqual(Object.keys(hooks.tool), ["ts_mark_image", "ts_mark_audio"])
    for (const [tool, model, args] of [cases[0], cases[2]]) {
      assert.deepEqual(await hooks.tool[tool].execute({ ...args, model }, context()), {
        title: tool,
        output: "[TSGW_CONFIG] TSGW runtime provider configuration is unavailable.",
        metadata: { provider: "tsgw", phase: "TSGW_CONFIG" },
      })
    }
    assert.equal(reads, 1)
  }
})
