function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function trimLine(value: unknown): string {
  return String(value ?? "").trim()
}

export function flattenText(value: unknown): string {
  if (typeof value === "string") return value.trim()

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item
        if (!isRecord(item)) return ""
        if (typeof item.text === "string") return item.text
        if (typeof item.content === "string") return item.content
        return flattenText(item.content)
      })
      .filter(Boolean)
      .join("\n")
      .trim()
  }

  if (isRecord(value)) {
    if (typeof value.text === "string") return value.text.trim()
    if (typeof value.content === "string") return value.content.trim()
    if (Array.isArray(value.content)) return flattenText(value.content)
  }

  return ""
}

function firstNonEmpty(values: readonly unknown[]): string {
  for (const value of values) {
    const text = flattenText(value)
    if (text) return text
  }

  return ""
}

export function extractAnswer(payload: unknown): string {
  const record = isRecord(payload) ? payload : undefined
  const choices = record && Array.isArray(record.choices) ? record.choices : []
  const choice = isRecord(choices[0]) ? choices[0] : undefined
  const message = choice && isRecord(choice.message) ? choice.message : undefined
  const delta = choice && isRecord(choice.delta) ? choice.delta : undefined

  return firstNonEmpty([
    message?.content,
    delta?.content,
    record?.output_text,
    record?.answer,
    record?.message,
  ])
}

export function collectUrls(input: unknown, output = new Set<string>()): Set<string> {
  if (typeof input === "string") {
    const matches = input.match(/https?:\/\/[^\s)\]}>'"]+/gu) ?? []
    for (const match of matches) output.add(match.replace(/[.,;]+$/u, ""))
    return output
  }

  if (Array.isArray(input)) {
    for (const item of input) collectUrls(item, output)
    return output
  }

  if (!isRecord(input)) return output

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && key.toLowerCase().includes("url")) {
      collectUrls(value, output)
      continue
    }

    if (["citations", "annotations", "sources", "search_results", "results", "references"].includes(key)) {
      collectUrls(value, output)
      continue
    }

    collectUrls(value, output)
  }

  return output
}
