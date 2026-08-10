// F 运行时实证验证夹具（tossp/opencode-tsgw#1，2026-08-10）
// 用途: 连接运行中的 OpenCode 服务，调用 config.providers()/provider.list()
//       读取 tsgw provider 的模型列表，验证"按模型注册"可行性。
// 用法: 先确保依赖可用（npm install 后），再运行:
//   OPENCODE_BASE_URL=http://<host>:<port> bun scripts/verify/model-list.mjs
// 环境变量:
//   OPENCODE_BASE_URL（必填）: OpenCode 服务地址
//   OPENCODE_DIRECTORY（可选）: 项目目录（默认当前目录）
//   OPENCODE_VERIFY_TIMEOUT_MS（可选）: 请求超时毫秒（默认 7000）
//   OPENCODE_VERIFY_OUTPUT_FILE（可选）: 输出文件路径（默认不落盘）
// 注意: options/headers 一律打码输出，不落盘敏感信息。
import { createOpencodeClient } from "@opencode-ai/sdk";

const baseUrl = process.env.OPENCODE_BASE_URL ?? "";
const directory = process.env.OPENCODE_DIRECTORY ?? "";
const timeoutMs = Number(process.env.OPENCODE_VERIFY_TIMEOUT_MS ?? "7000");

if (!baseUrl) {
  console.error("Usage: OPENCODE_BASE_URL=http://<host>:<port> bun scripts/verify/model-list.mjs");
  process.exit(1);
}

function sanitizeString(value) {
  return String(value)
    .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)([^,\s'"}]+)/gi, "$1[REDACTED]")
    .slice(0, 500);
}

function sanitize(value, key = "") {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "options" || normalizedKey === "headers") {
    return "[REDACTED]";
  }
  if (/(api.?key|token|secret|password|authorization|cookie|credential|^key$)/i.test(normalizedKey)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]));
  }
  return value;
}

function timeoutFetch(request) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return fetch(request, { signal: controller.signal })
    .catch((error) => {
      if (timedOut) throw new Error(`Request timed out after ${timeoutMs}ms`);
      throw error;
    })
    .finally(() => clearTimeout(timer));
}

async function attempt(label, action) {
  const startedAt = Date.now();
  try {
    return { label, ok: true, elapsedMs: Date.now() - startedAt, value: await action() };
  } catch (error) {
    return {
      label,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: {
        name: error instanceof Error ? error.name : typeof error,
        message: sanitizeString(error instanceof Error ? error.message : String(error)),
      },
    };
  }
}

const client = createOpencodeClient({
  baseUrl,
  directory,
  responseStyle: "data",
  throwOnError: true,
  fetch: timeoutFetch,
});

const providersResult = await attempt("config.providers", () => client.config.providers());
const report = {
  connection: { baseUrl, directory, timeoutMs },
  configProviders: providersResult.ok
    ? (() => {
        const response = providersResult.value;
        const tsgw = response.providers.find((provider) => provider.id === "tsgw");
        return {
          ok: true,
          elapsedMs: providersResult.elapsedMs,
          default: sanitize(response.default),
          providerIDs: response.providers.map((provider) => provider.id),
          tsgwPresent: Boolean(tsgw),
          tsgwModels: tsgw
            ? Object.entries(tsgw.models).map(([modelKey, model]) => ({
                modelKey,
                fields: Object.keys(model),
                model: sanitize(model),
              }))
            : [],
        };
      })()
    : providersResult,
};

const providerListResult = await attempt("provider.list", () => client.provider.list());
report.providerListComparison = providerListResult.ok
  ? (() => {
      const response = providerListResult.value;
      const tsgw = response.all.find((provider) => provider.id === "tsgw");
      return {
        ok: true,
        elapsedMs: providerListResult.elapsedMs,
        defaultTsgw: sanitize(response.default.tsgw ?? null),
        connectedProviderIDs: response.connected,
        tsgwPresent: Boolean(tsgw),
        tsgwModelKeys: tsgw ? Object.keys(tsgw.models) : [],
      };
    })()
  : providerListResult;

const output = JSON.stringify(report, null, 2);
if (process.env.OPENCODE_VERIFY_OUTPUT_FILE) {
  await Bun.write(process.env.OPENCODE_VERIFY_OUTPUT_FILE, `${output}\n`);
}
console.log(output);
