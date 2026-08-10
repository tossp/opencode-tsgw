import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import { PROBE_TIMEOUT_MS } from "./tool-ids.js"

const SERVE_ENV_PATH = join(homedir(), ".config", "opencode", "serve.env")

export type BaseUrlSelection = {
  baseUrl: string
  candidatePrimary: string
  candidateFixed: string
  probeDirectory: string
  usesPrimary: boolean
}

function parseServeEnvValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim() || undefined
  }

  return trimmed
}

export function readServeEnv() {
  const values: Record<string, string | undefined> = {}

  try {
    const content = readFileSync(SERVE_ENV_PATH, "utf8")

    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue

      const separatorIndex = line.indexOf("=")
      if (separatorIndex < 0) continue

      const name = line.slice(0, separatorIndex).trim()
      values[name] = parseServeEnvValue(line.slice(separatorIndex + 1))
    }
  } catch {
    return values
  }

  return values
}

async function canUseBaseUrl(baseUrl: string, directory: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const client = createOpencodeClient({ baseUrl, directory })
    await client.project.current({ directory }, { signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export async function resolveBaseUrlSelection(
  input: Pick<PluginInput, "serverUrl" | "directory" | "worktree">,
  fixedAddress: string,
): Promise<BaseUrlSelection> {
  const probeDirectory = input.worktree || input.directory

  try {
    const candidatePrimary = new URL("/", input.serverUrl).href
    const usesPrimary = await canUseBaseUrl(candidatePrimary, probeDirectory)

    return {
      baseUrl: usesPrimary ? candidatePrimary : fixedAddress,
      candidatePrimary,
      candidateFixed: fixedAddress,
      probeDirectory,
      usesPrimary,
    }
  } catch {
    return {
      baseUrl: fixedAddress,
      candidatePrimary: fixedAddress,
      candidateFixed: fixedAddress,
      probeDirectory,
      usesPrimary: false,
    }
  }
}
