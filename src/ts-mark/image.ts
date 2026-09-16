import { createOpenAI } from "@ai-sdk/openai"
import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { generateImage } from "ai"

import { TSGW_PROVIDER_ID, TSGW_PROVIDER_LABEL } from "../shared/tsgw/constants.js"
import { resolveTsgwBaseURL } from "../shared/tsgw/provider.js"
import { writeArtifact } from "./artifact.js"
import {
  IMAGE_MODELS,
  IMAGE_QUALITIES,
  IMAGE_TOOL_NAME,
  type ImageModel,
  type ImageQuality,
  type TsgwMediaAvailabilityStatus,
} from "./constants.js"
import { TsgwMediaError, toolFailure, unavailableMediaResult } from "./error.js"
import { validateImageSize } from "./image-capabilities.js"
import { inspectPng } from "./metadata.js"
import {
  DEFAULT_TIMEOUT_SECONDS,
  timeoutSchema,
  trimRequired,
  withSharedTimeout,
} from "./validation.js"

type ImageToolArgs = {
  model?: ImageModel
  prompt: string
  size?: string
  quality?: ImageQuality
  timeout?: number
}

type NormalizedImageToolArgs = Omit<ImageToolArgs, "model" | "quality" | "timeout"> & {
  model: ImageModel
  quality: ImageQuality
  timeout: number
}

export type ImageToolInput = {
  client: PluginInput["client"]
  directory: string
  getApiKey: () => Promise<string>
  availability: TsgwMediaAvailabilityStatus
}

export function normalizeImageArgs(args: ImageToolArgs): NormalizedImageToolArgs {
  const model = args.model === undefined ? "gpt-image-2.5-flare" : args.model
  if (!(IMAGE_MODELS as readonly string[]).includes(model)) {
    throw new TsgwMediaError("INPUT_VALIDATION", "model must be one of the supported image models.")
  }
  return {
    ...args,
    model,
    quality: args.quality === undefined ? "auto" : args.quality,
    timeout: args.timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : args.timeout,
  }
}

function createError(phase: "TSGW_CONFIG" | "AUTH", message: string): TsgwMediaError {
  return new TsgwMediaError(phase, message)
}

export function createImageTool(input: ImageToolInput): ToolDefinition {
  return tool({
    description:
      `通过 ${TSGW_PROVIDER_LABEL} 的 Images API 生成一张 PNG 图片。仅支持三个 GPT Image 2.5 ID，默认 Flare；quality 支持 low/medium/high/xhigh/max/auto。裸 ID gpt-image-2.5 原样透传，上游语义及生成未实测。实际输出尺寸可能不同。`,
    args: {
      model: tool.schema
        .enum(IMAGE_MODELS)
        .default("gpt-image-2.5-flare")
        .describe("GPT Image 2.5 使用 Images API，默认 gpt-image-2.5-flare；gpt-image-2.5 裸 ID 原样透传，生成未实测。"),
      prompt: tool.schema.string().trim().min(1).describe("必填的图像生成提示词。"),
      size: tool.schema
        .string()
        .optional()
        .describe("可选 size：auto 或正安全整数 WIDTHxHEIGHT（16 对齐、宽高比不超过 3:1），其他限制由服务端检查。实际输出尺寸可能不同。"),
      quality: tool.schema
        .enum(IMAGE_QUALITIES)
        .default("auto")
        .describe("渲染 quality：low/medium/high/xhigh/max/auto，默认 auto；裸 ID 的上游接受性未实测。"),
      timeout: timeoutSchema().describe("模型调用最长等待时间（秒）。默认 300。发生超时后，provider 可能已经计费。"),
    },
    async execute(args, context) {
      try {
        if (input.availability === "unavailable") return unavailableMediaResult(IMAGE_TOOL_NAME)

        const normalizedArgs = normalizeImageArgs(args)
        const prompt = trimRequired(normalizedArgs.prompt, "prompt")
        const requestedSize = validateImageSize(normalizedArgs.model, normalizedArgs.size)
        const baseURL = await resolveTsgwBaseURL(input.client, input.directory, createError, normalizedArgs.model)
        const apiKey = await input.getApiKey()
        const tsgwOpenAI = createOpenAI({ name: TSGW_PROVIDER_ID, baseURL, apiKey })

        const image = await withSharedTimeout(context.abort, normalizedArgs.timeout, async (abortSignal) => {
          const result = await generateImage({
            model: tsgwOpenAI.image(normalizedArgs.model),
            prompt,
            ...(requestedSize && requestedSize !== "auto" ? { size: requestedSize as `${number}x${number}` } : {}),
            providerOptions: { openai: { quality: normalizedArgs.quality, outputFormat: "png" } },
            maxRetries: 0,
            abortSignal,
          })
          if (result.image.mediaType !== "image/png") {
            throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} did not return PNG data for ${normalizedArgs.model}.`)
          }
          return result.image.uint8Array
        })

        const inspection = inspectPng(image)
        const artifact = await writeArtifact("image", "png", image)
        const metadata = {
          provider: TSGW_PROVIDER_ID,
          model: normalizedArgs.model,
          filepath: artifact.filepath,
          mime: "image/png",
          bytes: artifact.bytes,
          sha256: artifact.sha256,
          requested_size: requestedSize ?? "model_default",
          actual_size: `${inspection.width}x${inspection.height}`,
          width: inspection.width,
          height: inspection.height,
          metadata_scan: inspection.metadataScan,
          cleanup_hint: "Generated artifacts are retained; delete this file manually when it is no longer needed.",
        }
        context.metadata({ title: IMAGE_TOOL_NAME, metadata })
        return { title: IMAGE_TOOL_NAME, output: artifact.filepath, metadata }
      } catch (error) {
        return toolFailure(IMAGE_TOOL_NAME, error)
      }
    },
  })
}
