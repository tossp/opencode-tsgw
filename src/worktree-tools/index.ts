import type { Plugin } from "@opencode-ai/plugin"

import { createWorktreeTool } from "./create.js"
import { readServeEnv, resolveBaseUrlSelection } from "./connection.js"
import { createWorktreeInfoTool } from "./info.js"
import { createWorktreeListTool } from "./list.js"
import { createWorktreeRemoveTool } from "./remove.js"
import { createWorktreeResetTool } from "./reset.js"
import {
  DEFAULT_SERVE_HOSTNAME,
  DEFAULT_SERVE_PORT,
  TOOL_CREATE_NAME,
  TOOL_INFO_NAME,
  TOOL_LIST_NAME,
  TOOL_REMOVE_NAME,
  TOOL_RESET_NAME,
} from "./tool-ids.js"

const serveEnv = readServeEnv()
const serveHostname = serveEnv.OPENCODE_SERVE_HOSTNAME
const servePort = serveEnv.OPENCODE_SERVE_PORT
const fixedAddress = `http://${serveHostname ?? DEFAULT_SERVE_HOSTNAME}:${servePort ?? DEFAULT_SERVE_PORT}`

export const worktreeTools: Plugin = async ({ project, serverUrl, directory, worktree }) => {
  const selection = await resolveBaseUrlSelection({ serverUrl, directory, worktree }, fixedAddress)

  return {
    tool: {
      [TOOL_CREATE_NAME]: createWorktreeTool(selection),
      [TOOL_LIST_NAME]: createWorktreeListTool(selection),
      [TOOL_REMOVE_NAME]: createWorktreeRemoveTool(selection),
      [TOOL_RESET_NAME]: createWorktreeResetTool(selection),
      [TOOL_INFO_NAME]: createWorktreeInfoTool({ project, pluginInput: { directory, worktree, serverUrl }, selection }),
    },
  }
}
