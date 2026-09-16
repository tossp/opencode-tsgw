import type { ImageModel } from "./constants.js"
import { TsgwMediaError } from "./error.js"
import { trimRequired } from "./validation.js"

export function validateImageSize(model: ImageModel, value: string | undefined): string | undefined {
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
