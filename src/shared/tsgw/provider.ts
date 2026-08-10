// 来源: ts_search/client.ts 与 ts-mark/client.ts 的共同 provider 探测逻辑（2026-08-10 抽取）。
// 约束: 仅提取返回所需的 options.baseURL，不读取或透传 headers；URL 有效性校验留给 ts_search。
import type { PluginInput } from "@opencode-ai/plugin"

import type { CreateError } from "./auth.js"
import { TSGW_PROVIDER_ID, TSGW_PROVIDER_LABEL } from "./constants.js"
import { getActiveModelIds } from "./model-availability.js"

export type TsgwAvailability = {
  baseURL: string
  activeModelIds: string[]
}

async function resolveTsgwProvider(
  client: PluginInput["client"],
  directory: string,
  createError: CreateError,
) {
  let result: Awaited<ReturnType<PluginInput["client"]["config"]["providers"]>>

  try {
    result = await client.config.providers({ query: { directory } })
  } catch {
    throw createError("TSGW_CONFIG", `${TSGW_PROVIDER_LABEL} runtime provider configuration could not be read.`)
  }

  if (("error" in result && result.error) || !result.data) {
    throw createError("TSGW_CONFIG", `${TSGW_PROVIDER_LABEL} runtime provider configuration is unavailable.`)
  }

  const provider = result.data.providers.find((item) => item.id === TSGW_PROVIDER_ID)
  const baseURL = typeof provider?.options.baseURL === "string" && provider.options.baseURL.trim()
    ? provider.options.baseURL
    : undefined

  if (!baseURL) {
    throw createError("TSGW_CONFIG", `${TSGW_PROVIDER_LABEL} runtime provider baseURL is unavailable.`)
  }

  return { baseURL, provider }
}

export async function resolveTsgwBaseURL(
  client: PluginInput["client"],
  directory: string,
  createError: CreateError,
): Promise<string> {
  const { baseURL } = await resolveTsgwProvider(client, directory, createError)
  return baseURL
}

export async function resolveTsgwAvailability(
  client: PluginInput["client"],
  directory: string,
  createError: CreateError,
): Promise<TsgwAvailability> {
  const { baseURL, provider } = await resolveTsgwProvider(client, directory, createError)
  return { baseURL, activeModelIds: getActiveModelIds(provider) }
}
