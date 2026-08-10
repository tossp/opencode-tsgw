import { basename } from "node:path"

import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import { formatError, getStatus } from "./shared.js"

export async function resolveNamedWorktreeDirectory(input: {
  client: ReturnType<typeof createOpencodeClient>
  executionDirectory: string
  name: string
}) {
  const listResponse = await input.client.worktree.list({ directory: input.executionDirectory })
  const listStatus = getStatus(listResponse)

  if (listResponse.error) {
    return {
      ok: false as const,
      error: `worktree 列表查询失败: ${formatError(listResponse.error)}`,
      status: listStatus,
    }
  }

  const directories = Array.isArray(listResponse.data)
    ? listResponse.data.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : []
  const matches = directories.filter((value) => basename(value) === input.name)

  if (matches.length !== 1) {
    return {
      ok: false as const,
      refused: true,
      matchCount: matches.length,
      error:
        matches.length === 0
          ? `未找到匹配名称 "${input.name}" 的 worktree。`
          : `找到多个匹配名称 "${input.name}" 的 worktree。`,
    }
  }

  return {
    ok: true as const,
    targetDirectory: matches[0],
  }
}
