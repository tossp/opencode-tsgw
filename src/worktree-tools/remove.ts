import { tool, type ToolDefinition } from "@opencode-ai/plugin"

import type { BaseUrlSelection } from "./connection.js"
import { executeNamedDangerousWorktreeAction, removeWorktreeAction } from "./dangerous-action.js"

export function createWorktreeRemoveTool(selection: BaseUrlSelection): ToolDefinition {
  return tool({
    description:
      "危险操作：删除指定 sandbox worktree，并删除其对应分支。name 只接受 worktree 名称，不要传路径，也不要传当前 context.worktree 指向的工作区。工具会先用 context.worktree || context.directory 列出 worktree，再按 basename(directory) === name 精确匹配目标；未匹配或匹配到多个目录时不会执行删除。",
    args: {
      name: tool.schema.string().min(1).describe("要删除的 worktree 名称，只接受名称本身，不要传路径。"),
    },
    execute(args, context) {
      return executeNamedDangerousWorktreeAction({ action: removeWorktreeAction, args, context, selection })
    },
  })
}
