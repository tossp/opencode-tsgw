// A 双导出加载行为验证夹具（tossp/opencode-tsgw#2，2026-08-10）
// 结论: OpenCode 1.18.15 按顺序执行模块全部函数导出（工具/hook 均注册）；
//       根入口禁止非函数运行时导出（否则模块加载失败）；
//       插件初始化抛错会阻断同包后续插件。
// 用法: opencode.json 的 plugin 数组写 file:// 指向 functions-only.js（正常）或 index.js（复现非函数导出失败）；
//       A_VERIFY_THROW=1 复现单插件初始化失败。

import { appendFileSync } from "node:fs";

const logFile = process.env.A_VERIFY_LOG ?? "/tmp/a-verify-log.txt";
const scenario = process.env.A_VERIFY_SCENARIO ?? "unspecified";

function log(event) {
  appendFileSync(logFile, `${new Date().toISOString()} | ${scenario} | ${event}\n`);
}

function tool(name) {
  return {
    description: `A-verify fixture tool ${name}`,
    args: {},
    async execute() {
      log(`tool:${name}`);
      return `fixture ${name} executed`;
    },
  };
}

export async function pluginA() {
  log("init:pluginA:start");
  if (process.env.A_VERIFY_THROW === "1") {
    log("init:pluginA:throw");
    throw new Error("A_VERIFY intentional pluginA initialization failure");
  }
  log("init:pluginA:return");
  return {
    tool: { tool_a: tool("tool_a") },
    event: async ({ event }) => {
      log(`hook:pluginA:event:${event.type}`);
    },
    "chat.params": async () => {
      log("hook:pluginA:chat.params");
    },
  };
}

export async function pluginB() {
  log("init:pluginB:start");
  log("init:pluginB:return");
  return {
    tool: { tool_b: tool("tool_b") },
    event: async ({ event }) => {
      log(`hook:pluginB:event:${event.type}`);
    },
    "chat.params": async () => {
      log("hook:pluginB:chat.params");
    },
  };
}

export const helper = { purpose: "non-function export for loader behavior" };
