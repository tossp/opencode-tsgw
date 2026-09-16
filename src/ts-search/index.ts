import type { Hooks, Plugin } from "@opencode-ai/plugin"

import { createTsgwAuth, type CreateError } from "../shared/tsgw/auth.js"
import { createTsgwProviderReader } from "../shared/tsgw/provider.js"
import { createAutoSearchParamsHook } from "./chat-params.js"
import { TsgwSearchError } from "./error.js"
import { createTsSearchTool } from "./tool.js"

export const tsSearch: Plugin = async ({ client, directory }) => {
  const createError: CreateError = (phase, message) => new TsgwSearchError(phase, message)
  const tsgwAuth = createTsgwAuth(createError)
  const readProvider = createTsgwProviderReader(client, directory, createError)
  void readProvider().catch(() => undefined)
  const tools: NonNullable<Hooks["tool"]> = { ts_search: createTsSearchTool({ client, directory, getApiKey: tsgwAuth.getApiKey, readProvider }) }

  return {
    auth: tsgwAuth.hook,
    "chat.params": createAutoSearchParamsHook(),
    tool: tools,
  }
}
