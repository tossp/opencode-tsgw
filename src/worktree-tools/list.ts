import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import type { BaseUrlSelection } from "./connection.js"
import { formatError, getExecutionDirectory, getStatus } from "./shared.js"
import { TOOL_LIST_NAME } from "./tool-ids.js"

export function createWorktreeListTool(selection: BaseUrlSelection): ToolDefinition {
  return tool({
    description:
      "列出当前项目的 sandbox worktree，并以 context.worktree || context.directory 作为请求 directory。返回 list、count、directory、baseUrl 与 source，便于只读确认当前项目下已有 worktree，并保留连接定位信息供排障使用。",
    args: {},
    async execute(_args, context) {
      const executionDirectory = getExecutionDirectory(context)

      if (!executionDirectory) {
        return {
          title: TOOL_LIST_NAME,
          output: "无法解析 worktree_list 的项目目录。",
          metadata: { ok: false },
        }
      }

      const client = createOpencodeClient({
        baseUrl: selection.baseUrl,
        directory: executionDirectory,
      })

      context.metadata({
        title: TOOL_LIST_NAME,
        metadata: {
          baseUrl: selection.baseUrl,
          directory: executionDirectory,
        },
      })

      try {
        const response = await client.worktree.list({ directory: executionDirectory })
        const status = getStatus(response)
        const metadata = {
          ok: !response.error,
          baseUrl: selection.baseUrl,
          directory: executionDirectory,
          ...(typeof status === "number" ? { status } : {}),
        }

        if (response.error) {
          return {
            title: TOOL_LIST_NAME,
            output: `worktree 列表查询失败: ${formatError(response.error)}`,
            metadata,
          }
        }

        const list = Array.isArray(response.data) ? response.data : []

        return {
          title: TOOL_LIST_NAME,
          output: JSON.stringify(
            {
              list,
              count: list.length,
              directory: executionDirectory,
              baseUrl: selection.baseUrl,
              source: selection.usesPrimary ? "serverUrlRoot" : "fixedAddress",
            },
            null,
            2,
          ),
          metadata,
        }
      } catch (error) {
        const status = getStatus(error)

        return {
          title: TOOL_LIST_NAME,
          output: `worktree 列表查询失败: ${formatError(error)}`,
          metadata: {
            ok: false,
            baseUrl: selection.baseUrl,
            directory: executionDirectory,
            ...(typeof status === "number" ? { status } : {}),
          },
        }
      }
    },
  })
}
