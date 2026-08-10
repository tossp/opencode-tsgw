import type { Dict } from "./contract.js"

export const clamp = (value: number | undefined, fallback: number, max: number): number => !Number.isFinite(value)
  ? fallback
  : Math.min(max, Math.max(1, Math.floor(value!)))

export const safeJsonParse = (value: unknown): unknown => {
  if (typeof value !== "string") return null
  try { return JSON.parse(value) } catch { return null }
}

export const obj = (value: unknown): Dict => value && typeof value === "object" ? value as Dict : {}
export const str = (value: unknown): string => typeof value === "string" ? value : ""
export const num = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null
export const bool = (value: unknown): boolean | null => typeof value === "boolean" ? value : null
export const asIso = (value: unknown): string | null => num(value) === null ? null : new Date(value as number).toISOString()
export const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`
export const sqlList = (values: string[]): string => values.map(sqlString).join(", ")
export const decodeText = (value: unknown): string => typeof value === "string" ? value : value instanceof Uint8Array ? new TextDecoder().decode(value) : ""
