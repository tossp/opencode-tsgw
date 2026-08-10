import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { APICallError, generateText, type ModelMessage } from "ai"

import {
  type SearchRoute,
  SEARCH_PROMPT_TEMPLATE,
} from "./constants.js"
import { TSGW_PROVIDER_ID } from "../shared/tsgw/constants.js"
import { collectUrls, extractAnswer } from "./response.js"

export type SearchRouteResult = SearchRoute & {
  ok: boolean
  answer: string
  urls: string[]
  requestId: string
  error: string
}

export type SearchFetch = typeof fetch

export type SearchRouteRequest = {
  route: SearchRoute
  query: string
  apiKey: string
  baseURL: string
  signal: AbortSignal
  fetchImpl?: SearchFetch
}

function buildMessages(query: string): ModelMessage[] {
  return [{ role: "user", content: query }]
}

function transformGptSearchRequest(body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, tools: [{ type: "web_search" }] }
}

export function failedSearchRoute(route: SearchRoute, error: string): SearchRouteResult {
  return { ok: false, ...route, answer: "", urls: [], requestId: "", error }
}

function successfulSearchRoute(
  route: SearchRoute,
  answer: string,
  urls: string[],
  requestId: string,
): SearchRouteResult {
  return { ok: true, ...route, answer, urls, requestId, error: "" }
}

function getResponseHeader(headers: Record<string, string> | undefined, name: string): string {
  const normalizedName = name.toLowerCase()
  for (const [headerName, value] of Object.entries(headers ?? {})) {
    if (headerName.toLowerCase() === normalizedName) return value
  }

  return ""
}

function stringifyResponseBody(body: unknown): string {
  try {
    return JSON.stringify(body) ?? ""
  } catch {
    return ""
  }
}

function formatSdkRouteFailure(error: unknown, signal: AbortSignal): string {
  const errorName = error instanceof Error ? error.name : ""
  if (errorName === "TimeoutError") {
    return "[REQUEST] AIH request timed out."
  }
  if (signal.aborted || errorName === "AbortError") {
    return "[REQUEST] AIH request was cancelled."
  }
  if (APICallError.isInstance(error)) {
    if (typeof error.statusCode === "number" && error.statusCode >= 200 && error.statusCode < 300) {
      return "[PROTOCOL] AIH response did not match the expected JSON format."
    }
    if (typeof error.statusCode === "number") {
      return `[HTTP] AIH request failed: HTTP ${error.statusCode}`
    }
  }

  return "[REQUEST] AIH request failed before response."
}

export async function executeSearchRoute(input: SearchRouteRequest): Promise<SearchRouteResult> {
  const { route, query, apiKey, baseURL, signal, fetchImpl } = input
  const tsgw = createOpenAICompatible({
    name: TSGW_PROVIDER_ID,
    baseURL,
    apiKey,
    fetch: fetchImpl,
    ...(route.family === "gpt" ? { transformRequestBody: transformGptSearchRequest } : {}),
  })

  try {
    const result = await generateText({
      model: tsgw.chatModel(route.model),
      system: SEARCH_PROMPT_TEMPLATE,
      messages: buildMessages(query),
      ...(route.family === "grok"
        ? { providerOptions: { [TSGW_PROVIDER_ID]: { search_parameters: { mode: "on" } } } }
        : {}),
      maxRetries: 0,
      abortSignal: signal,
      include: { responseBody: true },
    })
    const responseBody = result.response.body
    const answer = extractAnswer(responseBody) || result.text || stringifyResponseBody(responseBody)
    return successfulSearchRoute(
      route,
      answer,
      Array.from(collectUrls(responseBody ?? result.text)),
      getResponseHeader(result.response.headers, "ah-request-id"),
    )
  } catch (error) {
    return failedSearchRoute(route, formatSdkRouteFailure(error, signal))
  }
}
