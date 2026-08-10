import type { PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolContext, type ToolDefinition, type ToolResult } from "@opencode-ai/plugin"

import { resolveTsgwBaseURL } from "../shared/tsgw/provider.js"
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

export type TsgwAvailabilityStatus = "ok" | "unavailable"

export type TsSearchToolInput = {
  client: PluginInput["client"]
  directory: string
  getApiKey: () => Promise<string>
  availability: TsgwAvailabilityStatus
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

async function resolveTsSearchBaseURL(input: TsSearchToolInput): Promise<string> {
  const baseURL = await resolveTsgwBaseURL(input.client, input.directory, createError)

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

  let baseURL: string
  try {
    baseURL = await resolveTsSearchBaseURL(input)
  } catch (error) {
    return buildRouteFailure(formatSearchError(error))
  }

  let apiKey: string
  try {
    apiKey = await input.getApiKey()
  } catch (error) {
    return buildRouteFailure(formatSearchError(error))
  }

  const settled = await Promise.allSettled(
    SEARCH_ROUTES.map((route) => executeSearchRoute({
      route,
      query: input.query,
      apiKey,
      baseURL,
      signal: input.signal,
      fetchImpl: input.fetchImpl,
    })),
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

function unavailableSearchResult(): ToolResult {
  const results = buildRouteFailure("[TSGW_CONFIG] TSGW runtime provider configuration is unavailable.")
  return {
    title: TOOL_TITLE,
    output: renderMergedResult(results),
    metadata: buildSearchResultMetadata(results),
  }
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
      if (input.availability === "unavailable") return unavailableSearchResult()

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
