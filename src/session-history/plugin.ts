import { tool, type Plugin } from "@opencode-ai/plugin"
import {
  DEFAULT_LIMIT,
  DEFAULT_OUTPUT_LIMIT,
  DEFAULT_PART_LIMIT,
  DEFAULT_TOTAL_LIMIT,
  MAX_LIMIT,
  MAX_OUTPUT_LIMIT,
  MAX_PART_LIMIT,
  MAX_TOTAL_LIMIT,
} from "./contract.js"
import { asToolResult } from "./content.js"
import { buildInspectPayload, buildReadPayload, buildTimelinePayload, renderReadMarkdown } from "./payloads.js"
import { clamp } from "./value.js"

export const sessionHistory: Plugin = (async () => ({
  tool: {
    session_read: tool({
      description: "从 opencode db 读取结构化的历史会话消息。",
      args: {
        sessionId: tool.schema.string().describe("目标会话 ID。"),
        includeParts: tool.schema.boolean().optional().describe("是否包含返回消息关联的 part 记录。"),
        includeTodos: tool.schema.boolean().optional().describe("是否包含会话的 todo 上下文。"),
        limitMessages: tool.schema.number().int().positive().max(MAX_LIMIT).optional().describe("返回的尾部消息数量。"),
        format: tool.schema.enum(["structured", "markdown"]).optional().describe("输出格式。"),
      },
      async execute(args) {
        const sessionId = args.sessionId.trim()
        const format = args.format || "structured"
        const result = buildReadPayload(sessionId, !!args.includeParts, !!args.includeTodos, clamp(args.limitMessages, DEFAULT_LIMIT, MAX_LIMIT), DEFAULT_OUTPUT_LIMIT)
        const output = format === "markdown" ? renderReadMarkdown(result) : JSON.stringify(result, null, 2)
        return asToolResult(`session_read ${sessionId}`, output, { format, session_read: result })
      },
    }),
    session_timeline: tool({
      description: "从 opencode message/part 存储构建轻量级会话索引和时间线。",
      args: {
        sessionId: tool.schema.string().describe("目标会话 ID。"),
        view: tool.schema.enum(["full", "current_context", "audit"]).optional().describe("时间线视图。"),
        includeChildren: tool.schema.enum(["none", "summary", "full"]).optional().describe("子会话包含级别。"),
        includeParts: tool.schema.enum(["none", "summary", "full"]).optional().describe("消息中 part 详情的包含级别。"),
        includeTools: tool.schema.enum(["none", "summary", "full"]).optional().describe("工具输入/输出详情的包含级别。"),
        includeEvents: tool.schema.boolean().optional().describe("是否包含事件摘要。"),
        limitMessages: tool.schema.number().int().positive().max(MAX_LIMIT).optional().describe("返回的尾部消息数量。"),
        limitParts: tool.schema.number().int().positive().max(MAX_PART_LIMIT).optional().describe("返回的 part 数量上限。"),
        maxOutputChars: tool.schema.number().int().positive().max(MAX_OUTPUT_LIMIT).optional().describe("每个展开字段的摘录字符数上限。"),
        maxTotalChars: tool.schema.number().int().positive().max(MAX_TOTAL_LIMIT).optional().describe("组装结果的总字符数上限。"),
      },
      async execute(args) {
        const sessionId = args.sessionId.trim()
        const result = buildTimelinePayload({
          sessionId,
          view: args.view || "full",
          includeChildren: args.includeChildren || "summary",
          includeParts: args.includeParts || "none",
          includeTools: args.includeTools || "summary",
          includeEvents: !!args.includeEvents,
          limitMessages: clamp(args.limitMessages, DEFAULT_LIMIT, MAX_LIMIT),
          limitParts: clamp(args.limitParts, DEFAULT_PART_LIMIT, MAX_PART_LIMIT),
          maxOutputChars: clamp(args.maxOutputChars, DEFAULT_OUTPUT_LIMIT, MAX_OUTPUT_LIMIT),
          maxTotalChars: clamp(args.maxTotalChars, DEFAULT_TOTAL_LIMIT, MAX_TOTAL_LIMIT),
        })
        return asToolResult(`session_timeline ${sessionId}`, JSON.stringify(result), { session_timeline: result })
      },
    }),
    session_inspect: tool({
      description: "通过 session_timeline 中的 ID 引用检查一个会话对象。",
      args: {
        sessionId: tool.schema.string().describe("目标会话 ID。"),
        messageId: tool.schema.string().optional().describe("要检查的单条消息。"),
        partId: tool.schema.string().optional().describe("要检查的单个 part。"),
        callId: tool.schema.string().optional().describe("要检查的工具调用。"),
        taskId: tool.schema.string().optional().describe("要检查的任务。"),
        childSessionId: tool.schema.string().optional().describe("要检查的子会话。"),
        includeParts: tool.schema.enum(["summary", "full"]).optional().describe("消息或 part 检查的详情级别。"),
        includeToolIO: tool.schema.enum(["summary", "full"]).optional().describe("工具输入/输出的详情级别。"),
        maxOutputChars: tool.schema.number().int().positive().max(MAX_OUTPUT_LIMIT).optional().describe("每个展开字段的字符数上限。"),
      },
      async execute(args) {
        const sessionId = args.sessionId.trim()
        const result = buildInspectPayload({
          sessionId,
          messageId: args.messageId?.trim(),
          partId: args.partId?.trim(),
          callId: args.callId?.trim(),
          taskId: args.taskId?.trim(),
          childSessionId: args.childSessionId?.trim(),
          includeParts: args.includeParts || "summary",
          includeToolIO: args.includeToolIO || "summary",
          maxOutputChars: clamp(args.maxOutputChars, DEFAULT_OUTPUT_LIMIT, MAX_OUTPUT_LIMIT),
        })
        return asToolResult(`session_inspect ${sessionId}`, JSON.stringify(result), { session_inspect: result })
      },
    }),
  },
})) satisfies Plugin

export default sessionHistory
