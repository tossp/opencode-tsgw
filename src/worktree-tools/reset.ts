import { tool, type ToolDefinition } from "@opencode-ai/plugin"

import type { BaseUrlSelection } from "./connection.js"
import { executeNamedDangerousWorktreeAction, resetWorktreeAction } from "./dangerous-action.js"

export function createWorktreeResetTool(selection: BaseUrlSelection): ToolDefinition {
  return tool({
    description:
      "高风险操作：将指定 sandbox worktree 的分支 reset 到 primary default branch。name 只接受 worktree 名称，不要传路径，也不要传当前 context.worktree 指向的工作区。工具会先用 context.worktree || context.directory 列出 worktree，再按 basename(directory) === name 精确匹配唯一目标；未匹配或匹配到多个目录时不会执行 reset。",
    args: {
      name: tool.schema.string().min(1).describe("要 reset 的 worktree 名称，只接受名称本身，不要传路径。"),
    },
    execute(args, context) {
      return executeNamedDangerousWorktreeAction({ action: resetWorktreeAction, args, context, selection })
    },
  })
}
