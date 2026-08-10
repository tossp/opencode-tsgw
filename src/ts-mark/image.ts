import { createOpenAI } from "@ai-sdk/openai"
import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { generateImage, generateText } from "ai"

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
import { inspectPng } from "./metadata.js"
import {
  DEFAULT_TIMEOUT_SECONDS,
  decodeBase64,
  timeoutSchema,
  trimRequired,
  validateGptImageSize,
  validateLunaImageSize,
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
  return {
    ...args,
    model: args.model === undefined ? "gpt-image-2" : args.model,
    quality: args.quality === undefined ? "auto" : args.quality,
    timeout: args.timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : args.timeout,
  }
}

export function extractLunaImageBase64(
  staticToolResults: ReadonlyArray<{ toolName: string; output: { result: string } }>,
): string | undefined {
  return staticToolResults.find((item) => item.toolName === "image_generation")?.output.result
}

function createError(phase: "TSGW_CONFIG" | "AUTH", message: string): TsgwMediaError {
  return new TsgwMediaError(phase, message)
}

export function createImageTool(input: ImageToolInput): ToolDefinition {
  return tool({
    description:
      `通过 ${TSGW_PROVIDER_LABEL} 生成一张 PNG 图片。gpt-image-2 使用 Images API，支持灵活的 16 像素网格尺寸；gpt-5.6-luna 使用 Responses image_generation 工具，仅支持列出的尺寸。size 指定请求尺寸，quality 选择 low/medium/high/auto 渲染质量，实际输出尺寸可能不同。`,
    args: {
      model: tool.schema
        .enum(IMAGE_MODELS)
        .default("gpt-image-2")
        .describe("gpt-image-2 使用 Images API；gpt-5.6-luna 使用 Responses image_generation 工具。"),
      prompt: tool.schema.string().trim().min(1).describe("必填的图像生成提示词。"),
      size: tool.schema
        .string()
        .optional()
        .describe("可选的请求 size。gpt-image-2 接受 auto 或有效的 WIDTHxHEIGHT；Luna 接受 1024x1024、1024x1536、1536x1024 或 auto。实际输出尺寸可能不同。"),
      quality: tool.schema
        .enum(IMAGE_QUALITIES)
        .default("auto")
        .describe("请求的渲染 quality。auto 由模型选择 quality。"),
      timeout: timeoutSchema().describe("模型调用最长等待时间（秒）。默认 300。发生超时后，provider 可能已经计费。"),
    },
    async execute(args, context) {
      try {
        if (input.availability === "unavailable") return unavailableMediaResult(IMAGE_TOOL_NAME)

        const normalizedArgs = normalizeImageArgs(args)
        const prompt = trimRequired(normalizedArgs.prompt, "prompt")
        const requestedSize = normalizedArgs.model === "gpt-image-2"
          ? validateGptImageSize(normalizedArgs.size)
          : validateLunaImageSize(normalizedArgs.size)
        const baseURL = await resolveTsgwBaseURL(input.client, input.directory, createError)
        const apiKey = await input.getApiKey()
        const tsgwOpenAI = createOpenAI({ name: TSGW_PROVIDER_ID, baseURL, apiKey })

        const image = normalizedArgs.model === "gpt-image-2"
          ? await withSharedTimeout(context.abort, normalizedArgs.timeout, async (abortSignal) => {
              const result = await generateImage({
                model: tsgwOpenAI.image("gpt-image-2"),
                prompt,
                ...(requestedSize && requestedSize !== "auto" ? { size: requestedSize as `${number}x${number}` } : {}),
                providerOptions: { [TSGW_PROVIDER_ID]: { quality: normalizedArgs.quality, outputFormat: "png" } },
                maxRetries: 0,
                abortSignal,
              })
              if (result.image.mediaType !== "image/png") {
                throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} did not return PNG data for gpt-image-2.`)
              }
              return result.image.uint8Array
            })
          : await withSharedTimeout(context.abort, normalizedArgs.timeout, async (abortSignal) => {
              const result = await generateText({
                model: tsgwOpenAI.responses("gpt-5.6-luna"),
                prompt,
                tools: {
                  image_generation: tsgwOpenAI.tools.imageGeneration({
                    quality: normalizedArgs.quality,
                    outputFormat: "png",
                    ...(requestedSize ? { size: requestedSize as "1024x1024" | "1024x1536" | "1536x1024" | "auto" } : {}),
                  }),
                },
                toolChoice: { type: "tool", toolName: "image_generation" },
                maxRetries: 0,
                abortSignal,
              })
              const generated = extractLunaImageBase64(result.staticToolResults)
              if (typeof generated !== "string") {
                throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} did not return a Luna image-generation result.`)
              }
              return decodeBase64(generated, "PNG")
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
