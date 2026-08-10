import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { v7 } from "uuid"

import { ARTIFACT_DIRECTORY } from "./constants.js"
import { TsgwMediaError } from "./error.js"

export { ARTIFACT_DIRECTORY } from "./constants.js"

export type Artifact = {
  filepath: string
  bytes: number
  sha256: string
}

type ArtifactFileOperations = Pick<typeof import("node:fs/promises"), "mkdir" | "writeFile">

const filesystem: ArtifactFileOperations = { mkdir, writeFile }

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code)
}

export async function writeArtifact(
  prefix: "image" | "audio",
  extension: string,
  data: Uint8Array,
  operations: ArtifactFileOperations = filesystem,
): Promise<Artifact> {
  try {
    await operations.mkdir(ARTIFACT_DIRECTORY, { recursive: true, mode: 0o700 })
  } catch {
    throw new TsgwMediaError("ARTIFACT_WRITE", "The ts-mark artifact directory could not be created.")
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const filepath = join(ARTIFACT_DIRECTORY, `${prefix}-${v7()}.${extension}`)
    try {
      await operations.writeFile(filepath, data, { flag: "wx", mode: 0o600 })
      return {
        filepath,
        bytes: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex"),
      }
    } catch (error) {
      if (hasCode(error, "EEXIST")) continue
      throw new TsgwMediaError("ARTIFACT_WRITE", "The generated artifact could not be written.")
    }
  }

  throw new TsgwMediaError("ARTIFACT_WRITE", "A collision-safe artifact filename could not be allocated.")
}
