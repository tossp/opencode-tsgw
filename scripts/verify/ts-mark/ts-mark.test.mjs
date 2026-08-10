// 冻结于 2026-08-10（v0.2 行为契约）。
// 黄金值从本地 ts-mark 插件迁移前源码逐字提取并人工复核；修改实现时不得以放宽断言替代行为审查。
import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import test from "node:test"

import { ARTIFACT_DIRECTORY, writeArtifact } from "../../../dist/ts-mark/artifact.js"
import { createAudioTool, normalizeAudioArgs } from "../../../dist/ts-mark/audio.js"
import { AUDIO_MODELS, IMAGE_MODELS } from "../../../dist/ts-mark/constants.js"
import { TsgwMediaError, toolFailure } from "../../../dist/ts-mark/error.js"
import { createImageTool, normalizeImageArgs } from "../../../dist/ts-mark/image.js"
import { tsMark } from "../../../dist/ts-mark/index.js"
import {
  decodeBase64,
  trimRequired,
  validateAudioText,
  validateGptImageSize,
  validateLunaImageSize,
  validateStandardVoice,
  withSharedTimeout,
} from "../../../dist/ts-mark/validation.js"

const TSGW_CONFIG_UNAVAILABLE = "TSGW runtime provider configuration is unavailable."

function toolContext(metadataCalls = []) {
  return {
    abort: new AbortController().signal,
    directory: "/fixture",
    metadata(value) {
      metadataCalls.push(value)
    },
  }
}

function providerResponse(models) {
  return {
    data: {
      providers: [{
        id: "tsgw",
        options: { baseURL: "https://gateway.example.test/v1" },
        models,
      }],
    },
  }
}

function providerClient(models) {
  return { config: { providers: async () => providerResponse(models) } }
}

function assertMediaError(error, phase, message) {
  assert.ok(error instanceof TsgwMediaError)
  assert.equal(error.phase, phase)
  assert.equal(error.message, message)
}

async function rejected(operation) {
  try {
    await operation()
  } catch (error) {
    return error
  }
  assert.fail("Expected operation to reject.")
}

function failureResult(title, phase, message) {
  return {
    title,
    output: `[${phase}] ${message}`,
    metadata: { provider: "tsgw", phase },
  }
}

test("image: 参数默认值、模型与 size 校验矩阵冻结", async (t) => {
  assert.deepEqual(normalizeImageArgs({ prompt: "diagram" }), {
    prompt: "diagram",
    model: "gpt-image-2",
    quality: "auto",
    timeout: 300,
  })
  assert.equal(validateGptImageSize("1024x1024"), "1024x1024")
  assert.equal(validateGptImageSize("auto"), "auto")
  assert.equal(validateLunaImageSize("1024x1536"), "1024x1536")

  const definition = createImageTool({
    client: providerClient({ "gpt-image-2": { status: "active" } }),
    directory: "/fixture",
    getApiKey: async () => "fixture-key",
    availability: "ok",
  })
  for (const model of IMAGE_MODELS) assert.equal(definition.args.model.safeParse(model).success, true)
  assert.equal(definition.args.model.safeParse("image-unknown").success, false)
  assert.equal(definition.args.quality.safeParse("high").success, true)
  assert.equal(definition.args.quality.safeParse("ultra").success, false)
  assert.equal(definition.args.timeout.safeParse(1).success, true)
  assert.equal(definition.args.timeout.safeParse(0).success, false)

  await t.test("空 prompt 以 INPUT_VALIDATION ToolResult 返回", async () => {
    const result = await definition.execute({ model: "gpt-image-2", prompt: " ", quality: "auto", timeout: 300 }, toolContext())
    assert.deepEqual(result, failureResult("ts_mark_image", "INPUT_VALIDATION", "prompt must be a non-empty string."))
  })
  await t.test("无效 gpt-image-2 size 保持原错误文案", () => {
    assert.throws(
      () => validateGptImageSize("1025x1024"),
      (error) => {
        assertMediaError(error, "INPUT_VALIDATION", "gpt-image-2 size dimensions must be multiples of 16.")
        return true
      },
    )
  })
  await t.test("无效 Luna size 保持原错误文案", () => {
    assert.throws(
      () => validateLunaImageSize("512x512"),
      (error) => {
        assertMediaError(error, "INPUT_VALIDATION", "gpt-5.6-luna size must be 1024x1024, 1024x1536, 1536x1024, or auto.")
        return true
      },
    )
  })
})

test("audio: 参数默认值、模型、voice、format 与 text 校验矩阵冻结", async (t) => {
  assert.deepEqual(normalizeAudioArgs({ text: "hello" }), {
    text: "hello",
    model: "mimo-v2.5-tts",
    voice: "mimo_default",
    format: "wav",
    timeout: 300,
  })
  assert.deepEqual(normalizeAudioArgs({ model: "mimo-v2.5-tts-voicedesign", text: "hello" }), {
    model: "mimo-v2.5-tts-voicedesign",
    text: "hello",
    voice: undefined,
    format: "wav",
    timeout: 300,
  })
  assert.equal(validateStandardVoice("Mia"), "Mia")
  assert.equal(validateAudioText("mimo-v2.5-tts", "(唱歌) hello"), "(唱歌) hello")

  const definition = createAudioTool({
    client: providerClient({ "mimo-v2.5-tts": { status: "active" } }),
    directory: "/fixture",
    getApiKey: async () => "fixture-key",
    availability: "ok",
  })
  for (const model of AUDIO_MODELS) assert.equal(definition.args.model.safeParse(model).success, true)
  assert.equal(definition.args.model.safeParse("mimo-unknown").success, false)
  assert.equal(definition.args.format.safeParse("pcm16").success, true)
  assert.equal(definition.args.format.safeParse("ogg").success, false)

  await t.test("空 text 以 INPUT_VALIDATION ToolResult 返回", async () => {
    const result = await definition.execute({ model: "mimo-v2.5-tts", text: " ", voice: "mimo_default", format: "wav", timeout: 300 }, toolContext())
    assert.deepEqual(result, failureResult("ts_mark_audio", "INPUT_VALIDATION", "text must be a non-empty string."))
  })
  await t.test("标准 voice 与演唱标签保持原错误文案", () => {
    assert.throws(
      () => validateStandardVoice("unknown"),
      (error) => {
        assertMediaError(error, "INPUT_VALIDATION", "mimo-v2.5-tts voice must be one of the documented standard voices.")
        return true
      },
    )
    assert.throws(
      () => validateAudioText("mimo-v2.5-tts", "hello (唱歌)"),
      (error) => {
        assertMediaError(error, "INPUT_VALIDATION", "For mimo-v2.5-tts, the (唱歌) tag must start text.")
        return true
      },
    )
  })
})

test("error: 八个 phase、英文文案与 ToolResult 格式冻结", async (t) => {
  const timeoutAbort = new AbortController()
  timeoutAbort.abort()
  const cases = [
    ["INPUT_VALIDATION", () => Promise.resolve().then(() => trimRequired(" ", "prompt")), "prompt must be a non-empty string."],
    ["TSGW_CONFIG", async () => {
      const definition = createImageTool({
        client: { config: { providers: async () => { throw new Error("fixture provider failure") } } },
        directory: "/fixture",
        getApiKey: async () => "fixture-key",
        availability: "ok",
      })
      const result = await definition.execute({ model: "gpt-image-2", prompt: "diagram", quality: "auto", timeout: 300 }, toolContext())
      assert.deepEqual(result, failureResult("ts_mark_image", "TSGW_CONFIG", "TSGW runtime provider configuration could not be read."))
      throw new TsgwMediaError("TSGW_CONFIG", "TSGW runtime provider configuration could not be read.")
    }, "TSGW runtime provider configuration could not be read."],
    ["AUTH", async () => {
      const definition = createImageTool({
        client: providerClient({ "gpt-image-2": { status: "active" } }),
        directory: "/fixture",
        getApiKey: async () => { throw new TsgwMediaError("AUTH", "TSGW API authentication is not available.") },
        availability: "ok",
      })
      const result = await definition.execute({ model: "gpt-image-2", prompt: "diagram", quality: "auto", timeout: 300 }, toolContext())
      assert.deepEqual(result, failureResult("ts_mark_image", "AUTH", "TSGW API authentication is not available."))
      throw new TsgwMediaError("AUTH", "TSGW API authentication is not available.")
    }, "TSGW API authentication is not available."],
    ["HTTP", () => withSharedTimeout(new AbortController().signal, 1, async () => { throw new Error("network") }), "The TSGW request failed. No retry was attempted."],
    ["PROTOCOL", () => Promise.resolve().then(() => decodeBase64("?", "PNG")), "TSGW returned invalid PNG Base64 data."],
    ["ARTIFACT_WRITE", () => writeArtifact("image", "png", new Uint8Array([1]), {
      mkdir: async () => undefined,
      writeFile: async () => { throw new Error("fixture write failure") },
    }), "The generated artifact could not be written."],
    ["TIMEOUT", () => withSharedTimeout(new AbortController().signal, 0.01, async () => new Promise(() => {})), "The TSGW request timed out; the result may already have been billed."],
    ["CANCEL", () => withSharedTimeout(timeoutAbort.signal, 1, async () => "unused"), "The operation was cancelled before the TSGW request started."],
  ]

  for (const [phase, operation, message] of cases) {
    await t.test(phase, async () => {
      const error = await rejected(operation)
      assertMediaError(error, phase, message)
      assert.deepEqual(toolFailure("ts_mark_image", error), failureResult("ts_mark_image", phase, message))
    })
  }
})

test("artifact: 0700 目录、0600 wx UUID 文件与写入失败冻结", async () => {
  const data = new Uint8Array([1, 2, 3, 4])
  const artifact = await writeArtifact("image", "png", data)
  const file = await stat(artifact.filepath)
  const directory = await stat(ARTIFACT_DIRECTORY)

  assert.match(artifact.filepath, /^\/tmp\/ts-mark\/image-[0-9a-f-]{36}\.png$/u)
  assert.equal(file.mode & 0o777, 0o600)
  assert.equal(directory.mode & 0o777, 0o700)
  assert.deepEqual(await readFile(artifact.filepath), Buffer.from(data))
  assert.deepEqual(artifact, {
    filepath: artifact.filepath,
    bytes: 4,
    sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
  })
})

test("plugin: image/audio 按模型三层注册与 unavailable 结果冻结", async (t) => {
  await t.test("目标活跃模型各自注册对应工具", async () => {
    const imageHooks = await tsMark({ client: providerClient({ "gpt-image-2": { status: "active" } }), directory: "/fixture" })
    const audioHooks = await tsMark({ client: providerClient({ "mimo-v2.5-tts": { status: "active" } }), directory: "/fixture" })
    assert.equal(imageHooks.auth.provider, "tsgw")
    assert.deepEqual(Object.keys(imageHooks.tool), ["ts_mark_image"])
    assert.deepEqual(Object.keys(audioHooks.tool), ["ts_mark_audio"])
  })
  await t.test("探测成功但无目标活跃模型时不注册工具", async () => {
    const hooks = await tsMark({ client: providerClient({ "gpt-image-2": { status: "inactive" } }), directory: "/fixture" })
    assert.deepEqual(Object.keys(hooks.tool), [])
  })
  await t.test("探测失败时保留两个工具并返回同形 unavailable 结果", async () => {
    const hooks = await tsMark({
      client: { config: { providers: async () => { throw new Error("fixture probe failure") } } },
      directory: "/fixture",
    })
    assert.deepEqual(Object.keys(hooks.tool), ["ts_mark_image", "ts_mark_audio"])
    const imageResult = await hooks.tool.ts_mark_image.execute({ model: "gpt-image-2", prompt: "diagram", quality: "auto", timeout: 300 }, toolContext())
    const audioResult = await hooks.tool.ts_mark_audio.execute({ model: "mimo-v2.5-tts", text: "hello", voice: "mimo_default", format: "wav", timeout: 300 }, toolContext())
    assert.deepEqual(imageResult, failureResult("ts_mark_image", "TSGW_CONFIG", TSGW_CONFIG_UNAVAILABLE))
    assert.deepEqual(audioResult, failureResult("ts_mark_audio", "TSGW_CONFIG", TSGW_CONFIG_UNAVAILABLE))
  })
})
