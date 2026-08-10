import { tmpdir } from "node:os"
import { join } from "node:path"

export const IMAGE_TOOL_NAME = "ts_mark_image" as const
export const AUDIO_TOOL_NAME = "ts_mark_audio" as const

export const IMAGE_MODELS = ["gpt-image-2", "gpt-5.6-luna"] as const
export const IMAGE_QUALITIES = ["low", "medium", "high", "auto"] as const
export const AUDIO_MODELS = ["mimo-v2.5-tts", "mimo-v2.5-tts-voicedesign", "mimo-v2.5-tts-voiceclone"] as const
export const AUDIO_FORMATS = ["wav", "mp3", "pcm", "pcm16"] as const

export type ImageModel = (typeof IMAGE_MODELS)[number]
export type ImageQuality = (typeof IMAGE_QUALITIES)[number]
export type AudioModel = (typeof AUDIO_MODELS)[number]
export type AudioFormat = (typeof AUDIO_FORMATS)[number]

export type TsgwMediaAvailabilityStatus = "ok" | "unavailable"

export const ARTIFACT_DIRECTORY = join(tmpdir(), "ts-mark")
