import assert from "node:assert/strict"
import test from "node:test"

import { resolveTsgwAvailability, resolveTsgwBaseURL } from "../../../dist/shared/tsgw/provider.js"
import { tsSearch } from "../../../dist/ts-search/index.js"
import { TsgwSearchError } from "../../../dist/ts-search/error.js"
import { SEARCH_ROUTES } from "../../../dist/ts-search/constants.js"
import { failedSearchRoute } from "../../../dist/ts-search/request.js"
import { executeUnifiedSearch } from "../../../dist/ts-search/tool.js"

// No mock delegates to the real network, including unexpected requests.
globalThis.fetch = async () => { throw new Error("Unexpected fetch: offline fixture") }
const directory = "/fixture/address directory"
const createError = (phase, message) => new TsgwSearchError(phase, message)
const model = (url) => ({ status: "active", api: { url, id: "DO-NOT-RENAME", npm: "DO-NOT-SWITCH" } })
const models = { "gpt-5.4": model("https://fixture.test/gpt/v1"), "grok-4.20-fast": model("https://fixture.test/grok/v2") }

function clientFor(provider, configResult = { data: {} }) {
  const calls = { providers: [], get: [] }
  return {
    calls,
    client: { config: {
      providers: async (args) => {
        calls.providers.push(args)
        return { data: { providers: [provider] } }
      },
      get: async (args) => {
        calls.get.push(args)
        if (configResult instanceof Error) throw configResult
        return configResult
      },
    } },
  }
}

function searchInput(client, fetchImpl) {
  return { client, directory, query: "offline query", availability: "ok", getApiKey: async () => "fixture-key", signal: new AbortController().signal, fetchImpl }
}

function captureFetch(calls, expectedURLs) {
  return async (url, init) => {
    assert.ok(expectedURLs.includes(String(url)), `Unexpected URL: ${url}`)
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), body, headers: new Headers(init.headers) })
    return Response.json({
      id: "fixture", object: "chat.completion", created: 1, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: `answer ${body.model}` }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }, { headers: { "ah-request-id": `req-${body.model}` } })
  }
}

test("address: runtime legacy wins conflicting model URLs without config.get", async () => {
  const fixture = clientFor({ id: "tsgw", options: { baseURL: "https://fixture.test/legacy" }, models })
  const calls = []
  const results = await executeUnifiedSearch(searchInput(fixture.client, captureFetch(calls, ["https://fixture.test/legacy/chat/completions"])))
  assert.deepEqual(results.map((r) => r.ok), [true, true])
  assert.equal(calls.length, 2)
  assert.deepEqual(fixture.calls.get, [])
  assert.ok(fixture.calls.providers.every((args) => args.query.directory === directory))
  const untrimmed = " https://fixture.test/preserved/ "
  const raw = clientFor({ id: "tsgw", options: { baseURL: untrimmed }, models })
  assert.equal(await resolveTsgwBaseURL(raw.client, directory, createError, "missing"), untrimmed)
  assert.deepEqual(raw.calls.get, [])
})

test("search: model-only addresses register and execute distinct paths with frozen bodies", async (t) => {
  const provider = { id: "tsgw", models, headers: { "x-unwanted": "secret-fixture" } }
  Object.defineProperty(provider, "key", { get() { assert.fail("Provider.key must not be read") } })
  const fixture = clientFor(provider)
  const hooks = await tsSearch({ client: fixture.client, directory })
  assert.deepEqual(Object.keys(hooks.tool), ["ts_search"])
  assert.deepEqual(fixture.calls.get, [])
  await hooks.auth.loader(async () => ({ type: "api", key: "fixture-key" }))
  const calls = []
  t.mock.method(globalThis, "fetch", captureFetch(calls, ["https://fixture.test/gpt/v1/chat/completions", "https://fixture.test/grok/v2/chat/completions"]))
  const result = await hooks.tool.ts_search.execute({ query: "offline query" }, { abort: new AbortController().signal, metadata() {} })
  assert.equal(result.metadata.status, "success")
  assert.equal(calls.length, 2)
  for (const [index, route] of SEARCH_ROUTES.entries()) {
    const request = calls.find((call) => call.body.model === route.model)
    assert.equal(request.url, `${models[route.model].api.url}/chat/completions`)
    assert.equal(request.headers.get("authorization"), "Bearer fixture-key")
    assert.equal(request.headers.has("x-unwanted"), false)
    assert.equal(request.body.messages.at(-1).content, "offline query")
    assert.equal(request.body.messages[0].role, "system")
    assert.equal(result.metadata.routes[index].requestId, `req-${route.model}`)
  }
  assert.deepEqual(calls.find((r) => r.body.model === "gpt-5.4").body.tools, [{ type: "web_search" }])
  assert.deepEqual(calls.find((r) => r.body.model === "grok-4.20-fast").body.search_parameters, { mode: "on" })
  assert.deepEqual(fixture.calls.get, [])
})

test("address: missing target uses explicit provider defaults and still requests", async () => {
  for (const configured of [
    { api: "https://fixture.test/default" },
    { options: { baseURL: "https://fixture.test/default" }, api: "https://fixture.test/conflict" },
    { options: { baseURL: " " }, api: "https://fixture.test/default" },
  ]) {
    const fixture = clientFor({ id: "tsgw", options: { baseURL: " " }, models: { other: model("https://fixture.test/other") } }, { data: { provider: { tsgw: configured } } })
    const calls = []
    const result = await executeUnifiedSearch(searchInput(fixture.client, captureFetch(calls, ["https://fixture.test/default/chat/completions"])))
    assert.deepEqual(result.map((r) => r.ok), [true, true])
    assert.deepEqual(calls.map((r) => r.body.model).sort(), ["gpt-5.4", "grok-4.20-fast"])
    assert.deepEqual(fixture.calls.get, [{ query: { directory } }, { query: { directory } }])
  }
})

test("search: one missing or invalid route address never discards the other result", async () => {
  for (const gpt of [undefined, model("not a URL")]) {
    const fixture = clientFor({ id: "tsgw", models: { ...(gpt ? { "gpt-5.4": gpt } : {}), "grok-4.20-fast": models["grok-4.20-fast"] } })
    const calls = []
    const result = await executeUnifiedSearch(searchInput(fixture.client, captureFetch(calls, ["https://fixture.test/grok/v2/chat/completions"])))
    assert.deepEqual(result[0], failedSearchRoute(SEARCH_ROUTES[0], `[TSGW_CONFIG] TSGW runtime provider baseURL is ${gpt ? "invalid" : "unavailable"}.`))
    assert.deepEqual(result[1], { ...SEARCH_ROUTES[1], ok: true, answer: "answer grok-4.20-fast", urls: [], requestId: "req-grok-4.20-fast", error: "" })
    assert.equal(calls.length, 1)
    assert.equal(fixture.calls.get.length, gpt ? 0 : 1)
  }
})

test("address: empty/error/missing config fails closed; never borrow another model URL", async () => {
  for (const [config, message] of [
    [{ data: {} }, "baseURL is unavailable."],
    [{ data: { provider: {} } }, "baseURL is unavailable."],
    [{ data: { provider: { tsgw: {} } } }, "baseURL is unavailable."],
    [{ data: { provider: { tsgw: { options: { baseURL: 42 }, api: " " } } } }, "baseURL is unavailable."],
    [{}, "configuration is unavailable."],
    [{ error: "fixture", data: {} }, "configuration is unavailable."],
    [new Error("fixture"), "configuration could not be read."],
  ]) {
    const fixture = clientFor({ id: "tsgw", models: { other: model("https://fixture.test/other") } }, config)
    let fetchCalls = 0
    const result = await executeUnifiedSearch(searchInput(fixture.client, async () => { fetchCalls++; throw new Error("Forbidden fetch") }))
    assert.deepEqual(result, SEARCH_ROUTES.map((route) => failedSearchRoute(route, `[TSGW_CONFIG] TSGW runtime provider ${message}`)))
    assert.equal(fetchCalls, 0)
    assert.deepEqual(fixture.calls.get, [{ query: { directory } }, { query: { directory } }])
  }
})

test("search: auth failure preserves the other route's configuration error", async () => {
  const fixture = clientFor({ id: "tsgw", models: { "grok-4.20-fast": models["grok-4.20-fast"] } })
  let authCalls = 0
  let fetchCalls = 0
  const result = await executeUnifiedSearch({
    ...searchInput(fixture.client, async () => { fetchCalls++; throw new Error("Forbidden fetch") }),
    getApiKey: async () => { authCalls++; throw createError("AUTH", "TSGW API authentication is not available.") },
  })
  assert.deepEqual(result, [
    failedSearchRoute(SEARCH_ROUTES[0], "[TSGW_CONFIG] TSGW runtime provider baseURL is unavailable."),
    failedSearchRoute(SEARCH_ROUTES[1], "[AUTH] TSGW API authentication is not available."),
  ])
  assert.equal(authCalls, 1)
  assert.equal(fetchCalls, 0)
})

test("address: provider read failures retain TSGW_CONFIG contracts before config.get", async () => {
  for (const [response, message] of [
    [{ data: { providers: [] } }, "baseURL is unavailable."],
    [{}, "configuration is unavailable."],
    [{ error: "fixture", data: { providers: [] } }, "configuration is unavailable."],
    [new Error("fixture"), "configuration could not be read."],
  ]) {
    const client = { config: {
      providers: async () => { if (response instanceof Error) throw response; return response },
      get: async () => { assert.fail("Unexpected config.get") },
    } }
    const expected = { name: "TsgwSearchError", phase: "TSGW_CONFIG", message: `TSGW runtime provider ${message}` }
    await assert.rejects(resolveTsgwBaseURL(client, directory, createError, "gpt-5.4"), expected)
    await assert.rejects(resolveTsgwAvailability(client, directory, createError), expected)
  }
})

test("registration: successful empty/inactive models need no address, invalid URL waits until execution", async () => {
  for (const activeModels of [{}, { "gpt-5.4": { status: "inactive" } }]) {
    const fixture = clientFor({ id: "tsgw", models: activeModels })
    assert.deepEqual(await resolveTsgwAvailability(fixture.client, directory, createError), { activeModelIds: [] })
    assert.deepEqual((await tsSearch({ client: fixture.client, directory })).tool, {})
    assert.deepEqual(fixture.calls.get, [])
  }
  const fixture = clientFor({ id: "tsgw", options: { baseURL: "invalid" }, models })
  const hooks = await tsSearch({ client: fixture.client, directory })
  const result = await hooks.tool.ts_search.execute({ query: "offline" }, { abort: new AbortController().signal, metadata() {} })
  assert.match(result.output, /baseURL is invalid\./u)
  assert.deepEqual(fixture.calls.get, [])
})

test("registration: missing/failed provider stays fixed unavailable even after provider recovery", async () => {
  for (const response of [{ data: { providers: [] } }, {}, { error: "fixture" }, new Error("fixture")]) {
    let reads = 0
    const client = { config: { providers: async () => {
      reads++
      if (reads > 1) return { data: { providers: [{ id: "tsgw", models }] } }
      if (response instanceof Error) throw response
      return response
    }, get: async () => { assert.fail("Unexpected config.get") } } }
    const hooks = await tsSearch({ client, directory })
    assert.deepEqual(Object.keys(hooks.tool), ["ts_search"])
    const result = await hooks.tool.ts_search.execute({ query: "offline" }, { abort: new AbortController().signal, metadata() {} })
    assert.match(result.output, /\[TSGW_CONFIG\] TSGW runtime provider configuration is unavailable\./u)
    assert.equal(reads, 1)
  }
})
