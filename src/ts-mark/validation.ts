import { constants } from "node:fs"
import { access, readFile, stat } from "node:fs/promises"
import { extname, resolve } from "node:path"

import { tool } from "@opencode-ai/plugin"

import { TSGW_PROVIDER_LABEL } from "../shared/tsgw/constants.js"

import { TsgwMediaError } from "./error.js"

export const DEFAULT_TIMEOUT_SECONDS = 300
export const STANDARD_AUDIO_VOICES = ["mimo_default", "冰糖", "茉莉", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean"] as const

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_CLONE_DATA_URL_BYTES = 10_000_000
const GPT_IMAGE_MIN_PIXELS = 655_360
const GPT_IMAGE_MAX_PIXELS = 8_294_400
const GPT_IMAGE_MAX_EDGE = 3_840

type TimeoutSchema = ReturnType<
  ReturnType<
    ReturnType<
      ReturnType<typeof tool.schema.number>["finite"]
    >["positive"]
  >["default"]
>

export function timeoutSchema(): TimeoutSchema {
  return tool.schema
    .number()
    .finite()
    .positive()
    .default(DEFAULT_TIMEOUT_SECONDS)
    .describe("模型调用最长时长（秒）。默认 300。请求可能在 provider 已计费后才超时。")
}

export function trimRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new TsgwMediaError("INPUT_VALIDATION", `${field} must be a non-empty string.`)
  }
  return trimmed
}

export function validateGptImageSize(value: string | undefined): string | undefined {
  if (value === undefined) return undefined

  const size = trimRequired(value, "size")
  if (size === "auto") return size

  const match = /^(\d+)x(\d+)$/u.exec(size)
  if (!match) {
    throw new TsgwMediaError("INPUT_VALIDATION", "gpt-image-2 size must be auto or WIDTHxHEIGHT.")
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new TsgwMediaError("INPUT_VALIDATION", "gpt-image-2 size dimensions must be positive integers.")
  }

  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  const pixels = width * height
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new TsgwMediaError("INPUT_VALIDATION", "gpt-image-2 size dimensions must be multiples of 16.")
  }
  if (longEdge > GPT_IMAGE_MAX_EDGE) {
    throw new TsgwMediaError("INPUT_VALIDATION", "gpt-image-2 size cannot exceed 3840 pixels on either edge.")
  }
  if (longEdge / shortEdge > 3) {
    throw new TsgwMediaError("INPUT_VALIDATION", "gpt-image-2 size cannot exceed a 3:1 aspect ratio.")
  }
  if (pixels < GPT_IMAGE_MIN_PIXELS || pixels > GPT_IMAGE_MAX_PIXELS) {
    throw new TsgwMediaError("INPUT_VALIDATION", "gpt-image-2 size must contain 655360 to 8294400 pixels.")
  }

  return size
}

const LUNA_SIZES = ["1024x1024", "1024x1536", "1536x1024", "auto"] as const
export type LunaImageSize = (typeof LUNA_SIZES)[number]

export function validateLunaImageSize(value: string | undefined): LunaImageSize | undefined {
  if (value === undefined) return undefined

  const size = trimRequired(value, "size")
  if ((LUNA_SIZES as readonly string[]).includes(size)) return size as LunaImageSize

  throw new TsgwMediaError("INPUT_VALIDATION", "gpt-5.6-luna size must be 1024x1024, 1024x1536, 1536x1024, or auto.")
}

export function validateStandardVoice(value: string | undefined): string {
  if (value === undefined) return "mimo_default"

  const voice = trimRequired(value, "voice")
  if (!(STANDARD_AUDIO_VOICES as readonly string[]).includes(voice)) {
    throw new TsgwMediaError("INPUT_VALIDATION", "mimo-v2.5-tts voice must be one of the documented standard voices.")
  }
  return voice
}

function hasSingingTag(text: string): boolean {
  return text.includes("(唱歌)")
}

export function validateAudioText(model: string, value: string): string {
  const text = trimRequired(value, "text")
  if (model === "mimo-v2.5-tts" && hasSingingTag(text) && !text.startsWith("(唱歌)")) {
    throw new TsgwMediaError("INPUT_VALIDATION", "For mimo-v2.5-tts, the (唱歌) tag must start text.")
  }
  if (model !== "mimo-v2.5-tts" && hasSingingTag(text)) {
    throw new TsgwMediaError("INPUT_VALIDATION", "Voice design and voice clone requests do not support the (唱歌) tag.")
  }
  return text
}

function isWav(data: Buffer): boolean {
  return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WAVE"
}

function isMp3(data: Buffer): boolean {
  return data.subarray(0, 3).toString("ascii") === "ID3" || (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0)
}

export async function loadCloneVoice(value: string | undefined, directory: string): Promise<string> {
  const voice = trimRequired(value ?? "", "voice")
  const filepath = resolve(directory, voice)

  let data: Buffer
  try {
    const file = await stat(filepath)
    if (!file.isFile()) {
      throw new Error("not a regular file")
    }
    await access(filepath, constants.R_OK)
    data = await readFile(filepath)
  } catch {
    throw new TsgwMediaError("INPUT_VALIDATION", "voiceclone voice must name an existing, readable regular WAV or MP3 file.")
  }

  const extension = extname(filepath).toLowerCase()
  const mime = extension === ".wav" && isWav(data)
    ? "audio/wav"
    : extension === ".mp3" && isMp3(data)
      ? "audio/mpeg"
      : undefined
  if (!mime) {
    throw new TsgwMediaError("INPUT_VALIDATION", "voiceclone voice must be a valid local WAV or MP3 file matching its extension.")
  }

  const dataURL = `data:${mime};base64,${data.toString("base64")}`
  if (Buffer.byteLength(dataURL, "utf8") > MAX_CLONE_DATA_URL_BYTES) {
    throw new TsgwMediaError("INPUT_VALIDATION", "voiceclone voice data URL exceeds the 10MB provider limit.")
  }

  return dataURL
}

export async function withSharedTimeout<T>(
  contextAbort: AbortSignal,
  timeoutSeconds: number,
  operation: (abortSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new TsgwMediaError("INPUT_VALIDATION", "timeout must be a finite number greater than zero.")
  }
  if (contextAbort.aborted) {
    throw new TsgwMediaError("CANCEL", `The operation was cancelled before the ${TSGW_PROVIDER_LABEL} request started.`)
  }

  const controller = new AbortController()
  let timedOut = false
  let cancelled = false
  let remainingMs = timeoutSeconds * 1_000
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectAbort: (() => void) | undefined

  const abortFromContext = () => {
    cancelled = true
    controller.abort()
    rejectAbort?.()
  }
  const armTimeout = () => {
    const delay = Math.min(remainingMs, MAX_TIMER_DELAY_MS)
    timer = setTimeout(() => {
      if (remainingMs <= MAX_TIMER_DELAY_MS) {
        timedOut = true
        controller.abort()
        rejectAbort?.()
        return
      }
      remainingMs -= MAX_TIMER_DELAY_MS
      armTimeout()
    }, delay)
  }

  contextAbort.addEventListener("abort", abortFromContext, { once: true })
  armTimeout()
  try {
    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new Error("aborted"))
    })
    return await Promise.race([operation(controller.signal), abortPromise])
  } catch (error) {
    if (timedOut) {
      throw new TsgwMediaError("TIMEOUT", `The ${TSGW_PROVIDER_LABEL} request timed out; the result may already have been billed.`)
    }
    if (cancelled || contextAbort.aborted) {
      throw new TsgwMediaError("CANCEL", `The ${TSGW_PROVIDER_LABEL} request was cancelled.`)
    }
    if (error instanceof TsgwMediaError) throw error
    throw new TsgwMediaError("HTTP", `The ${TSGW_PROVIDER_LABEL} request failed. No retry was attempted.`)
  } finally {
    if (timer) clearTimeout(timer)
    contextAbort.removeEventListener("abort", abortFromContext)
  }
}

export function decodeBase64(value: string, format: string): Buffer {
  const base64 = value.trim()
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(base64) || base64.length % 4 !== 0) {
    throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} returned invalid ${format} Base64 data.`)
  }

  const data = Buffer.from(base64, "base64")
  if (!data.length) {
    throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} returned empty ${format} data.`)
  }
  return data
}
