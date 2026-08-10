import type { Hooks, Plugin } from "@opencode-ai/plugin"

import { createTsgwAuth, type CreateError } from "../shared/tsgw/auth.js"
import { hasAnyModel } from "../shared/tsgw/model-availability.js"
import { resolveTsgwAvailability } from "../shared/tsgw/provider.js"
import { createAutoSearchParamsHook } from "./chat-params.js"
import { GPT_SEARCH_MODEL, GROK_SEARCH_MODEL } from "./constants.js"
import { TsgwSearchError } from "./error.js"
import { createTsSearchTool, type TsgwAvailabilityStatus } from "./tool.js"

export const tsSearch: Plugin = async ({ client, directory }) => {
  const createError: CreateError = (phase, message) => new TsgwSearchError(phase, message)
  const tsgwAuth = createTsgwAuth(createError)
  let registerTool = true
  let availability: TsgwAvailabilityStatus = "unavailable"

  try {
    const { baseURL, activeModelIds } = await resolveTsgwAvailability(client, directory, createError)
    new URL(baseURL)
    registerTool = hasAnyModel(activeModelIds, [GPT_SEARCH_MODEL, GROK_SEARCH_MODEL])
    availability = "ok"
  } catch {
    registerTool = true
    availability = "unavailable"
  }

  const tools: NonNullable<Hooks["tool"]> = registerTool
    ? { ts_search: createTsSearchTool({ client, directory, getApiKey: tsgwAuth.getApiKey, availability }) }
    : {}

  return {
    auth: tsgwAuth.hook,
    "chat.params": createAutoSearchParamsHook(),
    tool: tools,
  }
}
