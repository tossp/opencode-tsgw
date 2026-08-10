import { createOpenAICompatible, type MetadataExtractor } from "@ai-sdk/openai-compatible"
import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { generateText, type ModelMessage } from "ai"

import { TSGW_PROVIDER_ID, TSGW_PROVIDER_LABEL } from "../shared/tsgw/constants.js"
import { resolveTsgwBaseURL } from "../shared/tsgw/provider.js"
import { writeArtifact } from "./artifact.js"
import {
  AUDIO_FORMATS,
  AUDIO_MODELS,
  AUDIO_TOOL_NAME,
  type AudioFormat,
  type AudioModel,
  type TsgwMediaAvailabilityStatus,
} from "./constants.js"
import { TsgwMediaError, toolFailure, unavailableMediaResult } from "./error.js"
import { inspectAudio } from "./metadata.js"
import {
  DEFAULT_TIMEOUT_SECONDS,
  decodeBase64,
  loadCloneVoice,
  timeoutSchema,
  trimRequired,
  validateAudioText,
  validateStandardVoice,
  withSharedTimeout,
} from "./validation.js"

type AudioToolArgs = {
  model?: AudioModel
  text: string
  voice?: string
  format?: AudioFormat
  timeout?: number
}

type NormalizedAudioToolArgs = Omit<AudioToolArgs, "model" | "format" | "timeout"> & {
  model: AudioModel
  format: AudioFormat
  timeout: number
}

export type AudioToolInput = {
  client: PluginInput["client"]
  directory: string
  getApiKey: () => Promise<string>
  availability: TsgwMediaAvailabilityStatus
}

export function normalizeAudioArgs(args: AudioToolArgs): NormalizedAudioToolArgs {
  const model = args.model === undefined ? "mimo-v2.5-tts" : args.model
  return {
    ...args,
    model,
    voice: model === "mimo-v2.5-tts" && args.voice === undefined ? "mimo_default" : args.voice,
    format: args.format === undefined ? "wav" : args.format,
    timeout: args.timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : args.timeout,
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function extractAudioMetadata(parsedBody: unknown) {
  const response = asRecord(parsedBody)
  const choices = response && Array.isArray(response.choices) ? response.choices : []
  const choice = asRecord(choices[0])
  const message = choice && asRecord(choice.message)
  const audio = message && asRecord(message.audio)
  const data = audio?.data
  return typeof data === "string" && data.trim()
    ? { [TSGW_PROVIDER_ID]: { audio: { data } } }
    : undefined
}

export const tsgwAudioMetadataExtractor: MetadataExtractor = {
  async extractMetadata({ parsedBody }) {
    return extractAudioMetadata(parsedBody)
  },
  createStreamExtractor() {
    let metadata: ReturnType<typeof extractAudioMetadata>
    return {
      processChunk(parsedChunk) {
        metadata = extractAudioMetadata(parsedChunk) ?? metadata
      },
      buildMetadata() {
        return metadata
      },
    }
  },
}

function getAudioBase64(providerMetadata: unknown): string | undefined {
  const metadata = asRecord(providerMetadata)
  const tsgw = metadata && asRecord(metadata[TSGW_PROVIDER_ID])
  const audio = tsgw && asRecord(tsgw.audio)
  return typeof audio?.data === "string" ? audio.data : undefined
}

function getMime(format: AudioFormat): string {
  if (format === "wav") return "audio/wav"
  if (format === "mp3") return "audio/mpeg"
  if (format === "pcm16") return "audio/L16"
  return "audio/pcm"
}

function createError(phase: "TSGW_CONFIG" | "AUTH", message: string): TsgwMediaError {
  return new TsgwMediaError(phase, message)
}

export function createAudioTool(input: AudioToolInput): ToolDefinition {
  return tool({
    description:
      `通过 ${TSGW_PROVIDER_LABEL} 生成音频。使用官方文本标签指定演绎风格、语气、语速和情绪。标准 TTS 使用文档列出的 voice，且演唱文本必须以 (唱歌) 开头；voice design 需要非空的声音描述；voice clone 需要可读取的本地 WAV 或 MP3 路径。输出按所选格式保存，不进行转码。`,
    args: {
      model: tool.schema
        .enum(AUDIO_MODELS)
        .default("mimo-v2.5-tts")
        .describe("选择标准 TTS、voice design 或 voice clone。"),
      text: tool.schema.string().trim().min(1).describe("必填的语音文本。请使用官方文本标签指定演绎风格、语气、语速和情绪。"),
      voice: tool.schema
        .string()
        .optional()
        .describe("标准 TTS：mimo_default 或文档列出的 voice。voice design：非空的声音描述。voice clone：本地 WAV 或 MP3 路径。"),
      format: tool.schema
        .enum(AUDIO_FORMATS)
        .default("wav")
        .describe("保存的 provider 格式：wav、mp3、pcm 或 pcm16。插件不进行转码。"),
      timeout: timeoutSchema().describe("模型调用最长等待时间（秒）。默认 300。发生超时后，provider 可能已经计费。"),
    },
    async execute(args, context) {
      try {
        if (input.availability === "unavailable") return unavailableMediaResult(AUDIO_TOOL_NAME)

        const normalizedArgs = normalizeAudioArgs(args)
        const text = validateAudioText(normalizedArgs.model, normalizedArgs.text)
        let messages: ModelMessage[]
        let voice: string | undefined
        if (normalizedArgs.model === "mimo-v2.5-tts") {
          voice = validateStandardVoice(normalizedArgs.voice)
          messages = [{ role: "assistant", content: text }]
        } else if (normalizedArgs.model === "mimo-v2.5-tts-voicedesign") {
          voice = trimRequired(normalizedArgs.voice ?? "", "voice")
          messages = [{ role: "user", content: voice }, { role: "assistant", content: text }]
          voice = undefined
        } else {
          voice = await loadCloneVoice(normalizedArgs.voice, context.directory)
          messages = [{ role: "assistant", content: text }]
        }

        const baseURL = await resolveTsgwBaseURL(input.client, input.directory, createError)
        const apiKey = await input.getApiKey()
        const tsgw = createOpenAICompatible({ name: TSGW_PROVIDER_ID, baseURL, apiKey, metadataExtractor: tsgwAudioMetadataExtractor })

        const base64 = await withSharedTimeout(context.abort, normalizedArgs.timeout, async (abortSignal) => {
          const result = await generateText({
            model: tsgw.chatModel(normalizedArgs.model),
            messages,
            providerOptions: {
              [TSGW_PROVIDER_ID]: {
                audio: {
                  format: normalizedArgs.format,
                  ...(voice ? { voice } : {}),
                },
              },
            },
            maxRetries: 0,
            abortSignal,
          })
          return getAudioBase64(result.providerMetadata)
        })
        if (!base64) {
          throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} did not return audio data in the expected response metadata.`)
        }

        const audio = decodeBase64(base64, normalizedArgs.format)
        const metadataScan = inspectAudio(normalizedArgs.format, audio)
        const artifact = await writeArtifact("audio", normalizedArgs.format, audio)
        const metadata = {
          provider: TSGW_PROVIDER_ID,
          model: normalizedArgs.model,
          filepath: artifact.filepath,
          mime: getMime(normalizedArgs.format),
          bytes: artifact.bytes,
          sha256: artifact.sha256,
          format: normalizedArgs.format,
          metadata_scan: metadataScan,
          cleanup_hint: "Generated artifacts are retained; delete this file manually when it is no longer needed.",
        }
        context.metadata({ title: AUDIO_TOOL_NAME, metadata })
        return { title: AUDIO_TOOL_NAME, output: artifact.filepath, metadata }
      } catch (error) {
        return toolFailure(AUDIO_TOOL_NAME, error)
      }
    },
  })
}
