export const PLUGIN_NAME = "ts_search"
export const TOOL_TITLE = "TS Search"
export const BACKEND = "aih"
export const CHAT_COMPLETIONS_PATH = "chat/completions"
export const GPT_SEARCH_MODEL = "gpt-5.4"
export const GROK_SEARCH_MODEL = "grok-4.20-fast"

export type SearchFamily = "gpt" | "grok"

export type SearchRoute = {
  family: SearchFamily
  model: string
}

export const SEARCH_ROUTES: readonly SearchRoute[] = [
  { family: "gpt", model: GPT_SEARCH_MODEL },
  { family: "grok", model: GROK_SEARCH_MODEL },
]

export const SEARCH_PROMPT_TEMPLATE = [
  "请使用网页上最新可获得的信息回答用户的问题。",
  "请保持回答简洁。",
  "如有可用来源，请仅提供支持答案所需的最相关来源 URL，避免堆砌链接。",
  "如果没有实时网页信息，请严格回复：[没有实时网页信息]",
].join(" ")
