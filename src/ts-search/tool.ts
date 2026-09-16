import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolContext, type ToolDefinition, type ToolResult } from "@opencode-ai/plugin"

import { resolveTsgwBaseURL, type TsgwProviderReader } from "../shared/tsgw/provider.js"
import {
  BACKEND,
  GPT_SEARCH_MODEL,
  GROK_SEARCH_MODEL,
  PLUGIN_NAME,
  SEARCH_ROUTES,
  TOOL_TITLE,
  type SearchRoute,
} from "./constants.js"
import { formatSearchError, TsgwSearchError, type SearchFailurePhase } from "./error.js"
import { executeSearchRoute, failedSearchRoute, type SearchFetch, type SearchRouteResult } from "./request.js"
import { buildSearchResultMetadata, renderMergedResult } from "./render.js"
import { trimLine } from "./response.js"

export type TsSearchToolInput = {
  client: PluginInput["client"]
  directory: string
  getApiKey: () => Promise<string>
  readProvider?: TsgwProviderReader
}

export type UnifiedSearchInput = TsSearchToolInput & {
  query: string
  signal: AbortSignal
  fetchImpl?: SearchFetch
}

function buildRouteFailure(error: string): SearchRouteResult[] {
  return SEARCH_ROUTES.map((route) => failedSearchRoute(route, error))
}

function rejectedRouteFailure(route: SearchRoute, error: unknown): SearchRouteResult {
  return failedSearchRoute(route, formatSearchError(error))
}

function createError(phase: SearchFailurePhase, message: string): TsgwSearchError {
  return new TsgwSearchError(phase, message)
}

async function resolveTsSearchBaseURL(input: TsSearchToolInput, modelID: string): Promise<string> {
  const baseURL = await resolveTsgwBaseURL(input.client, input.directory, createError, modelID, input.readProvider)

  try {
    new URL(baseURL)
  } catch {
    throw createError("TSGW_CONFIG", "TSGW runtime provider baseURL is invalid.")
  }

  return baseURL
}

export async function executeUnifiedSearch(input: UnifiedSearchInput): Promise<SearchRouteResult[]> {
  if (!input.query) {
    return buildRouteFailure("[INPUT_VALIDATION] Missing query.")
  }

  const addresses = await Promise.allSettled(
    SEARCH_ROUTES.map((route) => resolveTsSearchBaseURL(input, route.model)),
  )
  if (addresses.every((item) => item.status === "rejected")) {
    return addresses.map((item, index) => rejectedRouteFailure(SEARCH_ROUTES[index], item.reason))
  }

  let apiKey: string
  try {
    apiKey = await input.getApiKey()
  } catch (error) {
    return addresses.map((address, index) => rejectedRouteFailure(
      SEARCH_ROUTES[index], address.status === "rejected" ? address.reason : error,
    ))
  }

  const settled = await Promise.allSettled(
    SEARCH_ROUTES.map((route, index) => {
      const address = addresses[index]
      if (address.status === "rejected") return rejectedRouteFailure(route, address.reason)
      return executeSearchRoute({
        route,
        query: input.query,
        apiKey,
        baseURL: address.value,
        signal: input.signal,
        fetchImpl: input.fetchImpl,
      })
    }),
  )

  return settled.map((item, index) => {
    if (item.status === "fulfilled") return item.value
    return rejectedRouteFailure(SEARCH_ROUTES[index], item.reason)
  })
}

function writeSearchMetadata(context: ToolContext): void {
  context.metadata({
    title: TOOL_TITLE,
    metadata: {
      backend: BACKEND,
      models: SEARCH_ROUTES.map((route) => route.model),
    },
  })
}

export function createTsSearchTool(input: TsSearchToolInput): ToolDefinition {
  return tool({
    description: "在固定的 GPT 与 Grok chat/completions 路由上使用统一 TS Search。",
    args: {
      query: tool.schema.string().min(1).describe("发送到 TSGW 的搜索查询。"),
    },
    async execute(args, context): Promise<ToolResult> {
      const query = trimLine(args.query)
      writeSearchMetadata(context)

      const results = await executeUnifiedSearch({
        ...input,
        query,
        signal: context.abort,
      })

      return {
        title: TOOL_TITLE,
        output: renderMergedResult(results),
        metadata: buildSearchResultMetadata(results),
      }
    },
  })
}
