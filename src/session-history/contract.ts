export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 50
export const DEFAULT_PART_LIMIT = 200
export const MAX_PART_LIMIT = 400
export const DEFAULT_OUTPUT_LIMIT = 1600
export const DEFAULT_TOOL_LIMIT = 800
export const MAX_OUTPUT_LIMIT = 12000
export const DEFAULT_TOTAL_LIMIT = 20000
export const MAX_TOTAL_LIMIT = 200000
export const SUMMARY_EXCERPT_LIMIT = 400
export const TOOL_OUTPUT_DIR = "/root/.local/share/opencode/tool-output"

export type DetailMode = "none" | "summary" | "full"
export type Row = Record<string, unknown>
export type Dict = Record<string, unknown>

export type ParsePartOptions = {
  detailMode: DetailMode
  toolMode: DetailMode
  maxOutputChars: number
  warnings: Array<Record<string, unknown>>
}
