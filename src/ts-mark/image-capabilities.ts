import { GPT_IMAGE_MODELS, type ImageModel, type ImageQuality } from "./constants.js"
import { TsgwMediaError } from "./error.js"
import { trimRequired, validateGptImageSize, validateLunaImageSize } from "./validation.js"

export function isGptImageModel(model: ImageModel): model is (typeof GPT_IMAGE_MODELS)[number] {
  return (GPT_IMAGE_MODELS as readonly string[]).includes(model)
}

export function validateLegacyImageQuality(model: ImageModel, quality: ImageQuality) {
  if (quality === "xhigh" || quality === "max") {
    throw new TsgwMediaError("INPUT_VALIDATION", `${model} quality must be low, medium, high, or auto.`)
  }
  return quality
}

export function validateImageSize(model: ImageModel, value: string | undefined): string | undefined {
  if (model === "gpt-image-2") return validateGptImageSize(value)
  if (model === "gpt-5.6-luna") return validateLunaImageSize(value)
  if (value === undefined) return undefined

  const size = trimRequired(value, "size")
  if (size === "auto") return size
  const match = /^(\d+)x(\d+)$/u.exec(size)
  if (!match) {
    throw new TsgwMediaError("INPUT_VALIDATION", `${model} size must be auto or WIDTHxHEIGHT.`)
  }
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new TsgwMediaError("INPUT_VALIDATION", `${model} size dimensions must be positive safe integers.`)
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new TsgwMediaError("INPUT_VALIDATION", `${model} size dimensions must be multiples of 16.`)
  }
  if (Math.max(width, height) / Math.min(width, height) > 3) {
    throw new TsgwMediaError("INPUT_VALIDATION", `${model} size cannot exceed a 3:1 aspect ratio.`)
  }
  return size
}
