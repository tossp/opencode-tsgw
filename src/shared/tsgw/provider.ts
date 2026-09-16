// 来源: ts_search/client.ts 与 ts-mark/client.ts 的共同 provider 探测逻辑（2026-08-10 抽取）。
// 约束: 注册不依赖地址；仅解析目标模型及明确默认地址，不读取或透传认证/headers。
import type { PluginInput } from "@opencode-ai/plugin"

import type { CreateError } from "./auth.js"
import { TSGW_PROVIDER_ID, TSGW_PROVIDER_LABEL } from "./constants.js"
import { getActiveModelIds } from "./model-availability.js"

export type TsgwAvailability = {
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
  if (!provider) {
    throw createError("TSGW_CONFIG", `${TSGW_PROVIDER_LABEL} runtime provider baseURL is unavailable.`)
  }

  return provider
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

export async function resolveTsgwBaseURL(
  client: PluginInput["client"],
  directory: string,
  createError: CreateError,
  modelID: string,
): Promise<string> {
  const provider = await resolveTsgwProvider(client, directory, createError)
  const runtimeURL = nonEmptyString(provider.options?.baseURL)
    ?? nonEmptyString(provider.models[modelID]?.api?.url)
  if (runtimeURL) return runtimeURL

  let result: Awaited<ReturnType<PluginInput["client"]["config"]["get"]>>
  try {
    result = await client.config.get({ query: { directory } })
  } catch {
    throw createError("TSGW_CONFIG", `${TSGW_PROVIDER_LABEL} runtime provider configuration could not be read.`)
  }
  if (("error" in result && result.error) || !result.data) {
    throw createError("TSGW_CONFIG", `${TSGW_PROVIDER_LABEL} runtime provider configuration is unavailable.`)
  }
  const configured = result.data.provider?.[TSGW_PROVIDER_ID]
  const baseURL = nonEmptyString(configured?.options?.baseURL) ?? nonEmptyString(configured?.api)
  if (!baseURL) {
    throw createError("TSGW_CONFIG", `${TSGW_PROVIDER_LABEL} runtime provider baseURL is unavailable.`)
  }
  return baseURL
}

export async function resolveTsgwAvailability(
  client: PluginInput["client"],
  directory: string,
  createError: CreateError,
): Promise<TsgwAvailability> {
  const provider = await resolveTsgwProvider(client, directory, createError)
  return { activeModelIds: getActiveModelIds(provider) }
}
