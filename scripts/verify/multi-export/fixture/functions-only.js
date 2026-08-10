// A 双导出加载行为验证夹具（tossp/opencode-tsgw#2，2026-08-10）
// 结论: OpenCode 1.18.15 按顺序执行模块全部函数导出（工具/hook 均注册）；
//       根入口禁止非函数运行时导出（否则模块加载失败）；
//       插件初始化抛错会阻断同包后续插件。
// 用法: opencode.json 的 plugin 数组写 file:// 指向 functions-only.js（正常）或 index.js（复现非函数导出失败）；
//       A_VERIFY_THROW=1 复现单插件初始化失败。

export { pluginA, pluginB } from "./index.js";
