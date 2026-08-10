import {
  BACKEND,
  GPT_SEARCH_MODEL,
  GROK_SEARCH_MODEL,
  type SearchFamily,
} from "./constants.js"
import type { SearchRouteResult } from "./request.js"

export type SearchOverallStatus = "success" | "partial-success" | "failed"

export type SearchResultMetadata = {
  backend: string
  status: SearchOverallStatus
  models: string[]
  routes: Array<{
    family: SearchFamily
    model: string
    status: "success" | "failed"
    requestId: string
    sourceUrls: string[]
  }>
}

function normalizeAnswerForCompare(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/gu, " ")
}

function getFamilyResult(results: readonly SearchRouteResult[], family: SearchFamily): SearchRouteResult | undefined {
  return results.find((item) => item.family === family)
}

function answersDiffer(results: readonly SearchRouteResult[]): boolean {
  const gpt = getFamilyResult(results, "gpt")
  const grok = getFamilyResult(results, "grok")
  if (!gpt?.ok || !grok?.ok) return false

  const left = normalizeAnswerForCompare(gpt.answer)
  const right = normalizeAnswerForCompare(grok.answer)
  return Boolean(left && right && left !== right)
}

export function getSearchOverallStatus(results: readonly SearchRouteResult[]): SearchOverallStatus {
  const succeeded = results.filter((item) => item.ok).length
  if (succeeded === 0) return "failed"
  return succeeded === results.length ? "success" : "partial-success"
}

export function buildSearchResultMetadata(results: readonly SearchRouteResult[]): SearchResultMetadata {
  return {
    backend: BACKEND,
    status: getSearchOverallStatus(results),
    models: [GPT_SEARCH_MODEL, GROK_SEARCH_MODEL],
    routes: results.map((item) => ({
      family: item.family,
      model: item.model,
      status: item.ok ? "success" : "failed",
      requestId: item.requestId,
      sourceUrls: [...item.urls],
    })),
  }
}

export function renderMergedResult(results: readonly SearchRouteResult[]): string {
  const gpt = getFamilyResult(results, "gpt")
  const grok = getFamilyResult(results, "grok")
  const mergedUrls = Array.from(new Set(results.flatMap((item) => item.urls)))
  const status = getSearchOverallStatus(results)
  const allFailed = status === "failed"
  const lines = [
    `backend: ${BACKEND}`,
    `result: ${status}`,
    "searched models:",
    `- gpt: ${GPT_SEARCH_MODEL}`,
    `- grok: ${GROK_SEARCH_MODEL}`,
    "gpt answer:",
    gpt?.ok ? (gpt.answer || "No answer returned.") : `[failed] ${gpt?.error || "Unknown error."}`,
    "grok answer:",
    grok?.ok ? (grok.answer || "No answer returned.") : `[failed] ${grok?.error || "Unknown error."}`,
    "merged source URLs:",
  ]

  if (mergedUrls.length) {
    for (const url of mergedUrls) lines.push(`- ${url}`)
  } else {
    lines.push("- none")
  }

  lines.push("ah-request-ids:")
  lines.push(`- gpt: ${gpt?.requestId || "n/a"}`)
  lines.push(`- grok: ${grok?.requestId || "n/a"}`)

  if (allFailed) {
    lines.push("failure summary: GPT and Grok routes both failed.")
  }

  if (answersDiffer(results)) {
    lines.push("note: results differ across model families")
  }

  return lines.join("\n")
}
