// 依据: F 运行时验证结论（2026-08-10）；用于各插件工具到模型映射的注册策略。
// 约束: 只读取模型 ID 与 status，不读取或透传 options、headers。
import type { Model } from "@opencode-ai/sdk"

export function getActiveModelIds(provider: { models?: Record<string, Model> } | undefined): string[] {
  return Object.entries(provider?.models ?? {})
    .filter(([, model]) => model.status === "active")
    .map(([modelID]) => modelID)
}

export function hasAnyModel(
  activeIds: string[],
  required: string[],
  aliases?: Record<string, string>,
): boolean {
  return required.some((modelID) => activeIds.includes(aliases?.[modelID] ?? modelID))
}
