import type { ToolContext, ToolResult } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import type { BaseUrlSelection } from "./connection.js"
import { formatError, getCurrentWorktreeName, getExecutionDirectory, getStatus, isValidWorktreeName, normalizeOptionalString } from "./shared.js"
import { resolveNamedWorktreeDirectory } from "./target-resolution.js"

type WorktreeClient = ReturnType<typeof createOpencodeClient>

type DangerousWorktreeAction = {
  toolName: string
  failureVerb: string
  currentWorktreeVerb: string
  resultKey: string
  execute: (client: WorktreeClient, executionDirectory: string, targetDirectory: string) => Promise<{
    data?: unknown
    error?: unknown
  }>
}

export async function executeNamedDangerousWorktreeAction(input: {
  action: DangerousWorktreeAction
  args: { name?: string }
  context: ToolContext
  selection: BaseUrlSelection
}): Promise<ToolResult> {
  const { action, args, context, selection } = input
  const executionDirectory = getExecutionDirectory(context)
  if (!executionDirectory) {
    return { title: action.toolName, output: `无法解析 ${action.toolName} 的项目目录。`, metadata: { ok: false } }
  }

  const name = normalizeOptionalString(args.name)
  if (!name || !isValidWorktreeName(name)) {
    return {
      title: action.toolName,
      output: "拒绝: name 必须是合法的 worktree 名称，不能包含 '/'、'\\' 或 '..'。",
      metadata: { ok: false, refused: true, name },
    }
  }

  const currentWorktreeName = getCurrentWorktreeName(context)
  if (currentWorktreeName && currentWorktreeName === name) {
    return {
      title: action.toolName,
      output: `拒绝: 不允许${action.currentWorktreeVerb}当前 context.worktree。`,
      metadata: { ok: false, refused: true, name, currentWorktree: context.worktree },
    }
  }

  const client = createOpencodeClient({ baseUrl: selection.baseUrl, directory: executionDirectory })
  context.metadata({ title: action.toolName, metadata: { baseUrl: selection.baseUrl, directory: executionDirectory, name } })

  try {
    const resolved = await resolveNamedWorktreeDirectory({ client, executionDirectory, name })
    if (!resolved.ok) {
      return {
        title: action.toolName,
        output: resolved.refused
          ? `worktree ${action.failureVerb}失败: ${resolved.error}`
          : `worktree ${action.failureVerb}失败（列表查询）: ${resolved.error}`,
        metadata: {
          ok: false,
          refused: resolved.refused,
          baseUrl: selection.baseUrl,
          directory: executionDirectory,
          name,
          ...(typeof resolved.matchCount === "number" ? { matchCount: resolved.matchCount } : {}),
          ...(typeof resolved.status === "number" ? { status: resolved.status } : {}),
        },
      }
    }

    const { targetDirectory } = resolved
    if (context.worktree && targetDirectory === context.worktree) {
      return {
        title: action.toolName,
        output: `拒绝: 不允许${action.currentWorktreeVerb}当前 context.worktree 指向的目录。`,
        metadata: { ok: false, refused: true, baseUrl: selection.baseUrl, directory: executionDirectory, name, targetDirectory },
      }
    }

    const response = await action.execute(client, executionDirectory, targetDirectory)
    const status = getStatus(response)
    const metadata = {
      ok: !response.error,
      baseUrl: selection.baseUrl,
      directory: executionDirectory,
      name,
      targetDirectory,
      ...(typeof status === "number" ? { status } : {}),
    }

    if (response.error) {
      return { title: action.toolName, output: `worktree ${action.failureVerb}失败: ${formatError(response.error)}`, metadata }
    }

    return {
      title: action.toolName,
      output: JSON.stringify({ [action.resultKey]: response.data ?? null, name, targetDirectory }, null, 2),
      metadata,
    }
  } catch (error) {
    const status = getStatus(error)
    return {
      title: action.toolName,
      output: `worktree ${action.failureVerb}失败: ${formatError(error)}`,
      metadata: {
        ok: false,
        baseUrl: selection.baseUrl,
        directory: executionDirectory,
        name,
        ...(typeof status === "number" ? { status } : {}),
      },
    }
  }
}

export const removeWorktreeAction: DangerousWorktreeAction = {
  toolName: "worktree_remove",
  failureVerb: "删除",
  currentWorktreeVerb: "删除",
  resultKey: "removed",
  execute(client, executionDirectory, targetDirectory) {
    return client.worktree.remove({
      directory: executionDirectory,
      worktreeRemoveInput: { directory: targetDirectory },
    })
  },
}

export const resetWorktreeAction: DangerousWorktreeAction = {
  toolName: "worktree_reset",
  failureVerb: "重置",
  currentWorktreeVerb: "重置",
  resultKey: "reset",
  execute(client, executionDirectory, targetDirectory) {
    return client.worktree.reset({
      directory: executionDirectory,
      worktreeResetInput: { directory: targetDirectory },
    })
  },
}
