import type { Plugin } from "@opencode-ai/plugin"

const TRACING_THREAD_HEADER = "AH-Thread-Id"
const TRACING_TRACE_HEADER = "AH-Trace-Id"

export const tracing: Plugin = async (_ctx) => {
  return {
    "chat.headers": async (input, output) => {
      if (!input?.sessionID || !output?.headers) return

      output.headers[TRACING_THREAD_HEADER] = input.sessionID

      if (input.message) {
        const msg = input.message
        if (msg.sessionID) output.headers[TRACING_THREAD_HEADER] = msg.sessionID
        if (msg.id) output.headers[TRACING_TRACE_HEADER] = msg.id
      }
    },
  }
}

export default tracing
