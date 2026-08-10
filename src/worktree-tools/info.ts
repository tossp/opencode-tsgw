import { tool, type PluginInput, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin"

import type { BaseUrlSelection } from "./connection.js"
import { getRepoNameHint } from "./shared.js"
import { TOOL_INFO_NAME } from "./tool-ids.js"

function buildWorktreeInfo(input: {
  project: PluginInput["project"]
  pluginInput: Pick<PluginInput, "directory" | "worktree" | "serverUrl">
  toolContext: Pick<ToolContext, "directory" | "sessionID" | "worktree">
  selection: BaseUrlSelection
}) {
  const projectName = "name" in input.project && typeof input.project.name === "string" ? input.project.name : undefined
  const repoNameHint = getRepoNameHint([
    input.toolContext.worktree,
    input.toolContext.directory,
    input.pluginInput.worktree,
    input.pluginInput.directory,
    input.project.worktree,
  ])

  return {
    sessionID: input.toolContext.sessionID,
    purpose: {
      summary: "使用此工具定位当前 OpenCode project/worktree 上下文，以及 worktree_create 相关的连接信息和路径指引。",
      worktreeCreateExpectation:
        "worktree_create 应请求 OpenCode server 在其管理的 worktree 目录中创建 worktree，路径模式为 [worktree]/[project.id]/[name]，而不是在当前仓库内部创建。",
      confirmActualLocation: "请通过 worktree_create 的返回 payload 以及 TUI/OpenCode 内部状态确认实际创建路径。",
    },
    worktreePathGuidance: {
      expectedPathPattern: "[worktree]/[project.id]/[name]",
      multiRepoNamePattern: "<repo>-<task>",
      recommendedMultiRepoPathPattern: "[worktree]/[project.id]/<repo>-<task>",
      ...(repoNameHint ? { repoNameHint } : {}),
    },
    project: {
      id: input.project.id,
      worktree: input.project.worktree,
      ...(projectName ? { name: projectName } : {}),
      ...(input.project.vcs ? { vcs: input.project.vcs } : {}),
    },
    pluginInput: {
      directory: input.pluginInput.directory,
      worktree: input.pluginInput.worktree,
      serverUrl: input.pluginInput.serverUrl.href,
    },
    toolContext: {
      directory: input.toolContext.directory,
      worktree: input.toolContext.worktree,
    },
    createBaseUrl: {
      selected: input.selection.baseUrl,
      probeDirectory: input.selection.probeDirectory,
      strategy: "以下字段用于连接定位与排障。",
      worktreeCreateLocationExpectation:
        "预期位于 server 管理的 worktree 目录中，路径模式为 [worktree]/[project.id]/[name]，且在当前仓库之外。",
      confirmActualLocationWith: "请检查 worktree_create 输出以及 TUI/OpenCode 内部状态。",
      candidates: {
        serverUrlRoot: input.selection.candidatePrimary,
        fixedAddress: input.selection.candidateFixed,
      },
      probe: {
        serverUrlRootUsable: input.selection.usesPrimary,
      },
    },
  }
}

export function createWorktreeInfoTool(input: {
  project: PluginInput["project"]
  pluginInput: Pick<PluginInput, "directory" | "worktree" | "serverUrl">
  selection: BaseUrlSelection
}): ToolDefinition {
  return tool({
    description:
      "返回 project.id、当前会话ID、当前 worktree/directory 上下文、连接信息，以及定位 worktree_create 所创建 worktree 的指引。包含 expectedPathPattern [worktree]/[project.id]/[name] 与 multiRepoNamePattern <repo>-<task>；可先用它确认当前 project/worktree 和预期创建位置，再去 create 结果或 TUI/OpenCode 内部状态中检查实际路径。",
    args: {},
    async execute(_args, context) {
      const info = buildWorktreeInfo({
        project: input.project,
        pluginInput: input.pluginInput,
        toolContext: { directory: context.directory, sessionID: context.sessionID, worktree: context.worktree },
        selection: input.selection,
      })

      return {
        title: TOOL_INFO_NAME,
        output: JSON.stringify(info, null, 2),
        metadata: {
          projectId: input.project.id,
          directory: context.worktree || context.directory,
          baseUrl: input.selection.baseUrl,
        },
      }
    },
  })
}
