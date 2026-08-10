import type { Hooks, Plugin } from "@opencode-ai/plugin"

import { createTsgwAuth, type CreateError } from "../shared/tsgw/auth.js"
import { hasAnyModel } from "../shared/tsgw/model-availability.js"
import { resolveTsgwAvailability } from "../shared/tsgw/provider.js"
import { createAudioTool } from "./audio.js"
import { AUDIO_MODELS, IMAGE_MODELS, type TsgwMediaAvailabilityStatus } from "./constants.js"
import { TsgwMediaError } from "./error.js"
import { createImageTool } from "./image.js"

export const tsMark: Plugin = async ({ client, directory }) => {
  const createError: CreateError = (phase, message) => new TsgwMediaError(phase, message)
  const tsgwAuth = createTsgwAuth(createError)
  let registerImage = true
  let registerAudio = true
  let availability: TsgwMediaAvailabilityStatus = "unavailable"

  try {
    const { activeModelIds } = await resolveTsgwAvailability(client, directory, createError)
    registerImage = hasAnyModel(activeModelIds, [...IMAGE_MODELS])
    registerAudio = hasAnyModel(activeModelIds, [...AUDIO_MODELS])
    availability = "ok"
  } catch {
    registerImage = true
    registerAudio = true
    availability = "unavailable"
  }

  const tools: NonNullable<Hooks["tool"]> = {
    ...(registerImage ? { ts_mark_image: createImageTool({ client, directory, getApiKey: tsgwAuth.getApiKey, availability }) } : {}),
    ...(registerAudio ? { ts_mark_audio: createAudioTool({ client, directory, getApiKey: tsgwAuth.getApiKey, availability }) } : {}),
  }

  return {
    auth: tsgwAuth.hook,
    tool: tools,
  }
}
