// 2026-09-16: issue #22 最终模型收敛，离线请求及固定PNG机械回归，不代表网关实测。
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, stat, unlink } from "node:fs/promises"
import test from "node:test"

import { createImageTool } from "../../../dist/ts-mark/image.js"
import { IMAGE_MODELS, IMAGE_QUALITIES } from "../../../dist/ts-mark/constants.js"
import { tsMark } from "../../../dist/ts-mark/index.js"
import { validateImageSize } from "../../../dist/ts-mark/image-capabilities.js"

const newModels = ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2.5"]
const qualities = ["low", "medium", "high", "xhigh", "max", "auto"]
const directory = "/fixture/image25"
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
const modelURL = (model) => `https://fixture.test/${model}/v1`
const requestURL = (model) => `${modelURL(model)}/images/generations`
const context = (signal = new AbortController().signal, metadata = () => {}) => ({ directory, abort: signal, metadata })

function clientFor(models = IMAGE_MODELS, useDefault = false) {
  return { config: {
    providers: async () => ({ data: { providers: [{ id: "tsgw", models: Object.fromEntries(models.map((model) => [model, {
      status: "active", api: { url: modelURL(model), id: "never-remap", npm: "never-switch" },
    }])) }] } }),
    get: async () => {
      if (!useDefault) throw new Error("Unexpected config.get")
      return { data: { provider: { tsgw: { api: "https://fixture.test/default" } } } }
    },
  } }
}

function definition(client = clientFor()) {
  return createImageTool({ client, directory, availability: "ok", getApiKey: async () => "fixture-key" })
}

// Per-test mock restored by node:test. Sequential subtests prevent same-process pollution.
// Unexpected calls always reject, and are asserted AFTER execute's catch boundary.
function network(t) {
  const queue = [], calls = [], unexpected = []
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const call = { url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) }
    calls.push(call)
    const expected = queue.shift()
    if (!expected || call.url !== expected.url || call.body.model !== expected.model) {
      unexpected.push(call)
      throw new Error("Fail-closed: unexpected offline request")
    }
    return expected.respond ? expected.respond(init) : Response.json({ error: { message: "fixture rejection", type: "invalid_request_error" } }, { status: 400 })
  })
  t.after(() => {
    assert.deepEqual(unexpected, [])
    assert.equal(queue.length, 0, "Every expected request must occur")
  })
  return { calls, expect(model, respond, url = requestURL(model)) { queue.push({ model, respond, url }) } }
}

function assertFailure(result, phase, message) {
  assert.deepEqual(result, { title: "ts_mark_image", output: `[${phase}] ${message}`, metadata: { provider: "tsgw", phase } })
}

test("image25: authorized model/quality schema additions", () => {
  // Explicit golden array: retired models are no longer accepted.
  assert.deepEqual(IMAGE_MODELS, newModels)
  assert.deepEqual(IMAGE_QUALITIES, qualities)
  const tool = definition()
  assert.equal(tool.args.model.parse(undefined), "gpt-image-2.5-flare")
  for (const model of IMAGE_MODELS) assert.equal(tool.args.model.safeParse(model).success, true)
  for (const quality of qualities) assert.equal(tool.args.quality.safeParse(quality).success, true)
  assert.equal(tool.args.model.safeParse("gpt-image-unknown").success, false)
  assert.equal(tool.args.quality.safeParse("ultra").success, false)
})

test("image25: all three literal IDs and six qualities reach Images JSON unchanged", async (t) => {
  const net = network(t), tool = definition()
  for (const model of newModels) {
    for (const quality of qualities) {
      net.expect(model)
      const result = await tool.execute({ model, quality, prompt: "offline", size: "1024x1024" }, context())
      assertFailure(result, "HTTP", "The TSGW request failed. No retry was attempted.")
      const call = net.calls.at(-1)
      assert.equal(call.url, `${modelURL(model)}/images/generations`)
      assert.deepEqual(call.body, { model, prompt: "offline", n: 1, size: "1024x1024", quality, output_format: "png" })
      assert.equal(Object.hasOwn(call.body, "response_format"), false)
      assert.equal(call.headers.get("authorization"), "Bearer fixture-key")
    }
  }
  assert.equal(net.calls.length, 18)
})

test("image25: Flare explicit high and omitted defaults really send PNG quality", async (t) => {
  const net = network(t), tool = definition()
  for (const args of [{ model: "gpt-image-2.5-flare", quality: "high" }, {}]) {
    net.expect("gpt-image-2.5-flare")
    const result = await tool.execute({ prompt: "offline", ...args }, context())
    assert.equal(result.metadata.phase, "HTTP")
    assert.deepEqual(net.calls.at(-1).body, { model: "gpt-image-2.5-flare", prompt: "offline", n: 1, quality: args.quality ?? "auto", output_format: "png" })
  }
  assert.equal(net.calls.length, 2)
})

test("image25: retired GPT/Luna rejected by schema and execution with zero requests", async (t) => {
  const net = network(t), tool = definition()
  for (const model of ["gpt-image-2", "gpt-5.6-luna"]) {
    assert.equal(tool.args.model.safeParse(model).success, false)
    for (const quality of qualities) {
      const result = await tool.execute({ model, quality, prompt: "offline" }, context())
      assertFailure(result, "INPUT_VALIDATION", "model must be one of the supported image models.")
    }
  }
  assert.equal(net.calls.length, 0)
})

test("image25: retired active image keys do not register an image tool", async () => {
  for (const models of [["gpt-image-2"], ["gpt-5.6-luna"], ["gpt-image-2", "gpt-5.6-luna"]]) {
    assert.deepEqual((await tsMark({ client: clientFor(models), directory })).tool, {})
  }
})

test("image25: size boundaries do not inherit old pixel/edge budgets", async (t) => {
  const net = network(t), tool = definition()
  const valid = [undefined, "auto", "16x16", "48x16", "16x48", "4096x4096", "9007199254740976x9007199254740976"]
  const invalid = ["", "0x16", "-16x16", "16.5x16", "16X16", "17x16", "64x16", "16x64", "9007199254740992x9007199254740992"]
  for (const model of newModels) {
    for (const size of valid) {
      assert.equal(validateImageSize(model, size), size)
      net.expect(model)
      const result = await tool.execute({ model, size, prompt: "offline" }, context())
      assert.equal(result.metadata.phase, "HTTP")
      const body = net.calls.at(-1).body
      assert.equal(body.size, size === "auto" ? undefined : size)
      assert.equal(Object.hasOwn(body, "size"), size !== undefined && size !== "auto")
    }
    for (const size of invalid) {
      const count = net.calls.length
      const result = await tool.execute({ model, size, prompt: "offline" }, context())
      assert.equal(result.metadata.phase, "INPUT_VALIDATION", `${model}: ${size}`)
      assert.equal(net.calls.length, count)
    }
  }
  assert.equal(net.calls.length, newModels.length * valid.length)
})

test("image25: each active key registers; another absent candidate can still request", async (t) => {
  const net = network(t)
  for (const [index, model] of newModels.entries()) {
    const hooks = await tsMark({ client: clientFor([model], true), directory })
    assert.deepEqual(Object.keys(hooks.tool), ["ts_mark_image"])
    await hooks.auth.loader(async () => ({ type: "api", key: "fixture-key" }))
    const selected = newModels[(index + 1) % newModels.length]
    net.expect(selected, undefined, "https://fixture.test/default/images/generations")
    const result = await hooks.tool.ts_mark_image.execute({ model: selected, prompt: "offline" }, context())
    assert.equal(result.metadata.phase, "HTTP")
    assert.equal(net.calls.at(-1).body.model, selected)
  }
  assert.deepEqual((await tsMark({ client: clientFor([]), directory })).tool, {})
  assert.equal(net.calls.length, 3)
})

test("image25: all three models succeed through SDK, PNG inspection and artifact", async (t) => {
  const net = network(t), tool = definition()
  for (const model of newModels) {
    net.expect(model, () => Response.json({ created: 1, data: [{ b64_json: png.toString("base64") }] }))
    const metadataCalls = []
    const result = await tool.execute({ model, prompt: "offline", quality: "high", size: "1024x1024" }, context(undefined, (value) => metadataCalls.push(value)))
    if (result.metadata.filepath) t.after(async () => {
      await unlink(result.metadata.filepath)
      await assert.rejects(stat(result.metadata.filepath), { code: "ENOENT" })
    })
    assert.match(result.output, /^\/tmp\/ts-mark\/image-[0-9a-f-]{36}\.png$/u)
    assert.deepEqual(await readFile(result.output), png)
    assert.equal((await stat(result.output)).mode & 0o777, 0o600)
    assert.deepEqual(result, { title: "ts_mark_image", output: result.output, metadata: {
      provider: "tsgw", model, filepath: result.output, mime: "image/png", bytes: png.length,
      sha256: createHash("sha256").update(png).digest("hex"), requested_size: "1024x1024", actual_size: "1x1", width: 1, height: 1,
      metadata_scan: { container: "png", known_blocks: [], note: "Container metadata scan only; it does not detect or rule out content steganography." },
      cleanup_hint: "Generated artifacts are retained; delete this file manually when it is no longer needed.",
    } })
    assert.deepEqual(metadataCalls, [{ title: "ts_mark_image", metadata: result.metadata }])
    const call = net.calls.at(-1)
    assert.equal(call.url, requestURL(model))
    assert.equal(call.body.model, model)
    assert.equal(call.body.quality, "high")
    assert.equal(call.body.output_format, "png")
    assert.equal(Object.hasOwn(call.body, "response_format"), false)
  }
  assert.equal(net.calls.length, 3)
})

test("image25: HTTP, protocol, timeout and cancellation retain tool failure contracts", async (t) => {
  const tool = definition()
  await t.test("HTTP rejection has no retry", async (t) => {
    const net = network(t)
    net.expect(newModels[0], () => Response.json({ error: { message: "fixture busy", type: "server_error" } }, { status: 503 }))
    assertFailure(await tool.execute({ model: newModels[0], prompt: "offline" }, context()), "HTTP", "The TSGW request failed. No retry was attempted.")
    assert.equal(net.calls.length, 1)
  })
  await t.test("invalid PNG preserves PROTOCOL", async (t) => {
    const net = network(t)
    net.expect(newModels[0], () => Response.json({ created: 1, data: [{ b64_json: Buffer.from("not png").toString("base64") }] }))
    const result = await tool.execute({ model: newModels[0], prompt: "offline" }, context())
    assertFailure(result, "PROTOCOL", "TSGW did not return a valid PNG image.")
    assert.equal(net.calls.length, 1)
  })
  for (const cancel of [false, true]) await t.test(cancel ? "in-flight cancel" : "timeout", async (t) => {
    const net = network(t), controller = new AbortController()
    net.expect(newModels[0], (init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("offline abort", "AbortError")), { once: true })
      if (cancel) controller.abort()
    }))
    const result = await tool.execute({ model: newModels[0], prompt: "offline", timeout: cancel ? 1 : 0.01 }, context(controller.signal))
    assertFailure(result, cancel ? "CANCEL" : "TIMEOUT", cancel ? "The TSGW request was cancelled." : "The TSGW request timed out; the result may already have been billed.")
    assert.equal(net.calls.length, 1)
  })
  await t.test("pre-cancel sends no request", async (t) => {
    const net = network(t), controller = new AbortController()
    controller.abort()
    assertFailure(await tool.execute({ model: newModels[0], prompt: "offline" }, context(controller.signal)), "CANCEL", "The operation was cancelled before the TSGW request started.")
    assert.equal(net.calls.length, 0)
  })
})
