import type { Hooks, Plugin } from "@opencode-ai/plugin"

import { createTsgwAuth, type CreateError } from "../shared/tsgw/auth.js"
import { createTsgwProviderReader } from "../shared/tsgw/provider.js"
import { createAudioTool } from "./audio.js"
import { TsgwMediaError } from "./error.js"
import { createImageTool } from "./image.js"

export const tsMark: Plugin = async ({ client, directory }) => {
  const createError: CreateError = (phase, message) => new TsgwMediaError(phase, message)
  const tsgwAuth = createTsgwAuth(createError)
  const readProvider = createTsgwProviderReader(client, directory, createError)
  void readProvider().catch(() => undefined)

  const tools: NonNullable<Hooks["tool"]> = {
    ts_mark_image: createImageTool({ client, directory, getApiKey: tsgwAuth.getApiKey, readProvider }),
    ts_mark_audio: createAudioTool({ client, directory, getApiKey: tsgwAuth.getApiKey, readProvider }),
  }

  return {
    auth: tsgwAuth.hook,
    tool: tools,
  }
}
