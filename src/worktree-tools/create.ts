import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import type { BaseUrlSelection } from "./connection.js"
import { formatError, getExecutionDirectory, getStatus, normalizeOptionalString } from "./shared.js"
import { TOOL_CREATE_NAME } from "./tool-ids.js"

export function createWorktreeTool(selection: BaseUrlSelection): ToolDefinition {
  return tool({
    description:
      "请求 OpenCode server 为当前项目创建新的 sandbox worktree，并在其管理的 worktree 目录中按预期模式 [worktree]/[project.id]/[name] 创建，而不是在当前仓库内部创建。多仓库项目可使用 name=<repo>-<task>。请通过此工具的返回 payload 或 TUI/OpenCode 内部状态确认实际路径；可使用 worktree_info 查看 project.id、连接信息与路径指引。",
    args: {
      name: tool.schema.string().min(1).optional().describe("可选的 worktree 名称，会透传为 WorktreeCreateInput.name。"),
      startCommand: tool.schema
        .string()
        .optional()
        .describe(
          "可选的额外启动命令，会透传为 WorktreeCreateInput.startCommand。它会在项目配置的 start command 之后执行；空字符串或仅包含空白字符的输入不会写入请求。",
        ),
    },
    async execute(args, context) {
      const executionDirectory = getExecutionDirectory(context)

      if (!executionDirectory) {
        return {
          title: TOOL_CREATE_NAME,
          output: "无法解析 worktree_create 的项目目录。",
          metadata: { ok: false },
        }
      }

      const name = normalizeOptionalString(args.name)
      const startCommand = normalizeOptionalString(args.startCommand)
      const client = createOpencodeClient({
        baseUrl: selection.baseUrl,
        directory: executionDirectory,
      })
      const worktreeCreateInput = {
        ...(name ? { name } : {}),
        ...(startCommand ? { startCommand } : {}),
      }
      const request = {
        directory: executionDirectory,
        ...(Object.keys(worktreeCreateInput).length > 0 ? { worktreeCreateInput } : {}),
      }

      context.metadata({
        title: TOOL_CREATE_NAME,
        metadata: {
          baseUrl: selection.baseUrl,
          directory: executionDirectory,
        },
      })

      try {
        const response = await client.worktree.create(request)
        const status = getStatus(response)
        const metadata = {
          ok: !response.error,
          baseUrl: selection.baseUrl,
          directory: executionDirectory,
          ...(typeof status === "number" ? { status } : {}),
        }

        if (response.error) {
          return {
            title: TOOL_CREATE_NAME,
            output: `worktree 创建失败: ${formatError(response.error)}`,
            metadata,
          }
        }

        return {
          title: TOOL_CREATE_NAME,
          output: JSON.stringify(response.data ?? null, null, 2),
          metadata,
        }
      } catch (error) {
        const status = getStatus(error)

        return {
          title: TOOL_CREATE_NAME,
          output: `worktree 创建失败: ${formatError(error)}`,
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
