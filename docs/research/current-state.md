# 现状盘点（证据摘要，2026-08-10 取证）

> 来源: DESIGN.md 第 3 节（2026-08-10 拆分）
> 说明: 本页为迁移前的事实基线，随版本迁移逐步过时（每个版本迁移完成后更新）。

## 本地插件（~/.config/opencode/plugins/，5 入口 + 39 文件 + 3,344 行）

| 插件            | 规模                                                                                        | 外部依赖                                                                                      | 依赖网关 |
| --------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| ts_search       | 709 行（入口+9 文件: auth/chat-params/client/constants/error/render/request/response/tool） | @opencode-ai/plugin、@opencode-ai/sdk/v2、@ai-sdk/openai-compatible、ai                       | 是       |
| ts-mark         | 866 行（入口+8 文件: artifact/audio/auth/client/constants/image/metadata/validation）       | @opencode-ai/plugin、@opencode-ai/sdk/v2、@ai-sdk/openai-compatible、@ai-sdk/openai、ai、uuid | 是       |
| session-history | 1,047 行（入口+9 文件）                                                                     | 仅 @opencode-ai/plugin                                                                        | 否       |
| worktree-tools  | 693 行（入口+9 文件）                                                                       | @opencode-ai/plugin、@opencode-ai/sdk/v2                                                      | 否       |
| tracing         | 29 行单文件                                                                                 | 仅 @opencode-ai/plugin                                                                        | 否       |

全部 5 个插件合计第三方依赖 specifier 仅 6 个: @opencode-ai/plugin、@opencode-ai/sdk（/v2 子路径）、@ai-sdk/openai-compatible、@ai-sdk/openai、ai、uuid。

另有遗留空目录 `plugins/aih_search/`（可清理）。

## 依赖环境（~/.config/opencode/）

- 根 package.json 依赖: @ai-sdk/openai ^4.0.36、@ai-sdk/openai-compatible ^3.0.27、@franlol/opencode-md-table-formatter ^0.0.6、@opencode-ai/plugin ^1.18.15、ai ^7.0.58、uuid ^14；devDeps @types/node ^26.2.0。无 name/scripts/packageManager。
- tsconfig.json: target ES2022、module ES2022、moduleResolution bundler、strict true，include ["plugins/**/*.ts", "*.ts"]。
- 双 npm 根: 根 node_modules 90M；.opencode/package.json 固定 @opencode-ai/plugin 1.18.15 + 独立 lockfile，node_modules 63M。
- 运行时实证（opencode debug info，2026-08-10）: 实际加载 7 个插件 = 2 个 npm 包（@franlol/opencode-md-table-formatter@latest、@cortexkit/opencode-magic-context@0.35.0）+ 5 个本地文件插件。

## 官方生态机制（opencode.ai/docs/zh-cn/ecosystem + plugins 文档，快照提交 0bff28de）

- 接入: opencode.json 的 `plugin` 数组写 npm 包名（支持 scoped 包）；npm 插件启动时由 Bun 自动安装，缓存在 `~/.cache/opencode/node_modules/`。
- 发现: 无官方 registry/marketplace；官方生态页是社区 PR 维护的 Markdown 清单（ecosystem.mdx）；另有 awesome-opencode、opencode.cafe 社区聚合。
- 模块契约: "插件是一个 JavaScript/TypeScript 模块，它导出一个或多个插件函数。每个函数接收一个上下文对象，并返回一个钩子对象。"
- 未规定: package.json 的 main/exports/keywords、默认导出、发布目录、包名前缀（opencode-* 仅是示例习惯）、脚手架、发布 CLI（社区模板 zenobi-us/opencode-plugin-template 已 archived，仅参考）。
- ⚠️ 重复加载警告: "本地插件和名称相似的 npm 插件会分别独立加载"——迁移必须删除对应本地入口文件，防止双加载。
- 加载顺序: 全局配置 → 项目配置 → 全局插件目录 → 项目插件目录；同名同版本 npm 包只加载一次。
- 本地依赖: 配置目录 package.json 声明的依赖会在启动时 bun install（本地插件模式的依赖承载方式；抽取为包后依赖转入包自身声明）。
