// 来源: ts_search/auth.ts 与 ts-mark/auth.ts 的逐字一致认证逻辑（2026-08-10 抽取）。
// 硬约束: 每次 createTsgwAuth 调用创建独立 accessor 闭包，错误由调用插件注入。
import type { Auth } from "@opencode-ai/sdk/v2"
import type { AuthHook } from "@opencode-ai/plugin"

import { TSGW_PROVIDER_ID, TSGW_PROVIDER_LABEL } from "./constants.js"

export type TsgwFailurePhase = "AUTH" | "TSGW_CONFIG"

export type CreateError = (phase: TsgwFailurePhase, message: string) => Error

type AuthAccessor = () => Promise<Auth>

export type TsgwAuth = {
  hook: AuthHook
  getApiKey: () => Promise<string>
}

export function createTsgwAuth(createError: CreateError): TsgwAuth {
  let getAuth: AuthAccessor | undefined

  const hook = {
    provider: TSGW_PROVIDER_ID,
    methods: [],
    loader: async (accessor) => {
      getAuth = accessor
      return {}
    },
  } satisfies AuthHook

  return {
    hook,
    async getApiKey() {
      if (!getAuth) {
        throw createError("AUTH", `${TSGW_PROVIDER_LABEL} API authentication is not available.`)
      }

      let auth: Auth
      try {
        auth = await getAuth()
      } catch {
        throw createError("AUTH", `${TSGW_PROVIDER_LABEL} API authentication could not be loaded.`)
      }

      if (auth.type !== "api" || !auth.key.trim()) {
        throw createError("AUTH", `${TSGW_PROVIDER_LABEL} requires an API-key authentication record.`)
      }

      return auth.key
    },
  }
}
