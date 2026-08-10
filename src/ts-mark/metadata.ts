import { TSGW_PROVIDER_LABEL } from "../shared/tsgw/constants.js"

import { TsgwMediaError } from "./error.js"

export type MetadataScan = {
  container: "png" | "wav" | "mp3" | "raw-pcm"
  known_blocks: string[]
  note: string
}

export type PngInspection = {
  width: number
  height: number
  metadataScan: MetadataScan
}

const SCAN_NOTE = "Container metadata scan only; it does not detect or rule out content steganography."

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)]
}

export function inspectPng(value: Uint8Array): PngInspection {
  const data = Buffer.from(value)
  const signature = "89504e470d0a1a0a"
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== signature) {
    throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} did not return a valid PNG image.`)
  }

  let width: number | undefined
  let height: number | undefined
  const knownBlocks: string[] = []
  let offset = 8
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.subarray(offset + 4, offset + 8).toString("ascii")
    const dataStart = offset + 8
    const next = dataStart + length + 4
    if (next > data.length) {
      throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} returned a truncated PNG image.`)
    }

    if (type === "IHDR") {
      if (length !== 13 || width !== undefined) {
        throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} returned an invalid PNG header.`)
      }
      width = data.readUInt32BE(dataStart)
      height = data.readUInt32BE(dataStart + 4)
    }
    if (["tEXt", "zTXt", "iTXt"].includes(type)) knownBlocks.push(`png:${type}`)
    if (["eXIf", "iCCP"].includes(type)) knownBlocks.push(`png:${type}`)
    if (["caBX", "c2pa", "JUMF", "juMb"].includes(type)) knownBlocks.push(`png:${type}`)
    if (type === "IEND") break
    offset = next
  }

  if (!width || !height) {
    throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} returned a PNG without valid dimensions.`)
  }

  return {
    width,
    height,
    metadataScan: {
      container: "png",
      known_blocks: unique(knownBlocks),
      note: SCAN_NOTE,
    },
  }
}

function inspectWav(data: Buffer): MetadataScan {
  if (data.length < 12 || data.subarray(0, 4).toString("ascii") !== "RIFF" || data.subarray(8, 12).toString("ascii") !== "WAVE") {
    throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} did not return a valid WAV file.`)
  }

  const knownBlocks: string[] = []
  let offset = 12
  while (offset + 8 <= data.length) {
    const type = data.subarray(offset, offset + 4).toString("ascii")
    const length = data.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    const next = dataStart + length + (length % 2)
    if (next > data.length) {
      throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} returned a truncated WAV file.`)
    }

    if (["bext", "iXML", "axml", "cue ", "smpl", "id3 "].includes(type)) knownBlocks.push(`wav:${type.trim()}`)
    if (type === "LIST") {
      const listKind = length >= 4 ? data.subarray(dataStart, dataStart + 4).toString("ascii") : ""
      knownBlocks.push(listKind === "INFO" ? "wav:LIST/INFO" : "wav:LIST")
    }
    offset = next
  }

  return { container: "wav", known_blocks: unique(knownBlocks), note: SCAN_NOTE }
}

function inspectMp3(data: Buffer): MetadataScan {
  const hasId3v2 = data.subarray(0, 3).toString("ascii") === "ID3"
  const hasFrame = data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0
  if (!hasId3v2 && !hasFrame) {
    throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} did not return a valid MP3 file.`)
  }

  const knownBlocks: string[] = []
  if (hasId3v2) knownBlocks.push("mp3:ID3v2")
  if (data.length >= 128 && data.subarray(-128, -125).toString("ascii") === "TAG") knownBlocks.push("mp3:ID3v1")
  return { container: "mp3", known_blocks: knownBlocks, note: SCAN_NOTE }
}

export function inspectAudio(format: "wav" | "mp3" | "pcm" | "pcm16", value: Uint8Array): MetadataScan {
  const data = Buffer.from(value)
  if (!data.length) {
    throw new TsgwMediaError("PROTOCOL", `${TSGW_PROVIDER_LABEL} returned empty audio data.`)
  }
  if (format === "wav") return inspectWav(data)
  if (format === "mp3") return inspectMp3(data)
  return {
    container: "raw-pcm",
    known_blocks: [],
    note: "Raw PCM has no container metadata to scan. Container metadata scan only; it does not detect or rule out content steganography.",
  }
}
