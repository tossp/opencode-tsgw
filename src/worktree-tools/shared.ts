import { basename } from "node:path"

import type { ToolContext } from "@opencode-ai/plugin"

export function normalizeOptionalString(value: string | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function getRepoNameHint(paths: Array<string | undefined>) {
  for (const path of paths) {
    const normalized = normalizeOptionalString(path)
    if (!normalized) continue

    const name = normalizeOptionalString(basename(normalized))
    if (name) return name
  }

  return undefined
}

export function getStatus(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  if ("status" in value && typeof value.status === "number") return value.status

  const response = "response" in value ? value.response : undefined
  if (response && typeof response === "object" && "status" in response && typeof response.status === "number") {
    return response.status
  }

  return undefined
}

export function formatError(error: unknown) {
  if (typeof error === "string" && error.trim()) return error

  if (error && typeof error === "object") {
    const status = getStatus(error)
    const summary = {
      ...("message" in error && typeof error.message === "string" && error.message ? { message: error.message } : {}),
      ...("name" in error && typeof error.name === "string" && error.name ? { name: error.name } : {}),
      ...(typeof status === "number" ? { status } : {}),
    }

    if (Object.keys(summary).length > 0) return JSON.stringify(summary)
  }

  return String(error)
}

export function getExecutionDirectory(context: Pick<ToolContext, "directory" | "worktree">) {
  return context.worktree || context.directory
}

export function getCurrentWorktreeName(context: Pick<ToolContext, "worktree">) {
  const currentWorktree = normalizeOptionalString(context.worktree)
  return currentWorktree ? normalizeOptionalString(basename(currentWorktree)) : undefined
}

export function isValidWorktreeName(name: string) {
  return !name.includes("/") && !name.includes("\\") && !name.includes("..") && basename(name) === name
}
