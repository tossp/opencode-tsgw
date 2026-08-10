import type { Hooks } from "@opencode-ai/plugin"

import type { SearchFamily } from "./constants.js"

type ChatParamsHook = NonNullable<Hooks["chat.params"]>
type ChatParamsInput = Parameters<ChatParamsHook>[0]
type ChatParamsOutput = Parameters<ChatParamsHook>[1]
type ChatParamsOptions = Record<string, unknown>

type AutoSearchAugmentation = {
  wireFormat: string
  apply: (target: ChatParamsOptions) => void
}

type AutoSearchPlan = {
  options: ChatParamsOptions
  family: SearchFamily | "unsupported"
  shouldAugment: boolean
  skipReason: string
  augmentation: AutoSearchAugmentation | null
}

const autoInjectedOptions = new WeakSet<object>()

function normalizeModel(value: unknown): string {
  if (typeof value !== "string") return ""

  const trimmed = value.trim()
  if (!trimmed) return ""

  const slash = trimmed.indexOf("/")
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

function detectFamily(model: string): SearchFamily | "unsupported" {
  const lower = model.toLowerCase()
  if (lower.includes("gpt")) return "gpt"
  if (lower.includes("grok")) return "grok"
  return "unsupported"
}

function hasWebSearchTool(tools: unknown): boolean {
  return Array.isArray(tools)
    && tools.some((item) => isRecord(item) && String(item.type ?? "").toLowerCase() === "web_search")
}

function hasGrokSearchFields(options: ChatParamsOptions): boolean {
  return Object.hasOwn(options, "search_parameters") || Object.hasOwn(options, "web_search_options")
}

function getRequestModelID(input: ChatParamsInput): string {
  return normalizeModel(input.model.id || input.model.name)
}

function buildFamilyAutoSearchAugmentation(
  family: SearchFamily | "unsupported",
  options: ChatParamsOptions,
): Omit<AutoSearchPlan, "options"> {
  if (family === "gpt") {
    if (hasWebSearchTool(options.tools)) {
      return { family, shouldAugment: false, skipReason: "already-configured", augmentation: null }
    }

    if (options.tools !== undefined && !Array.isArray(options.tools)) {
      return { family, shouldAugment: false, skipReason: "unsupported-tools-shape", augmentation: null }
    }

    return {
      family,
      shouldAugment: true,
      skipReason: "",
      augmentation: {
        wireFormat: 'tools:[{type:"web_search"}]',
        apply(target) {
          const tools = Array.isArray(target.tools) ? target.tools : []
          target.tools = [...tools, { type: "web_search" }]
        },
      },
    }
  }

  if (family === "grok") {
    if (hasGrokSearchFields(options)) {
      return { family, shouldAugment: false, skipReason: "already-configured", augmentation: null }
    }

    return {
      family,
      shouldAugment: true,
      skipReason: "",
      augmentation: {
        wireFormat: "search_parameters",
        apply(target) {
          target.search_parameters = {}
        },
      },
    }
  }

  return { family, shouldAugment: false, skipReason: "unsupported-family", augmentation: null }
}

function resolveAutoSearchEnhancement(input: ChatParamsInput, output: ChatParamsOutput): AutoSearchPlan | null {
  const options = output.options as ChatParamsOptions
  if (!options || typeof options !== "object") return null

  const family = detectFamily(getRequestModelID(input))
  if (autoInjectedOptions.has(options)) {
    return { options, family, shouldAugment: false, skipReason: "already-injected", augmentation: null }
  }

  return { options, ...buildFamilyAutoSearchAugmentation(family, options) }
}

function applyAutoSearchEnhancement(plan: AutoSearchPlan | null): void {
  if (!plan || autoInjectedOptions.has(plan.options)) return

  autoInjectedOptions.add(plan.options)
  if (!plan.shouldAugment || !plan.augmentation) return

  plan.augmentation.apply(plan.options)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function injectAutoSearchParams(input: ChatParamsInput, output: ChatParamsOutput): void {
  applyAutoSearchEnhancement(resolveAutoSearchEnhancement(input, output))
}

export function createAutoSearchParamsHook(): ChatParamsHook {
  return async (input, output) => {
    injectAutoSearchParams(input, output)
  }
}
