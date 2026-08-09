# 背景与目标

> 来源: DESIGN.md 第 1 节（2026-08-10 拆分）

当前 OpenCode 用户级配置目录 `~/.config/opencode/` 同时承担配置、插件源码与依赖管理，存在以下问题:

- 插件源码与配置混居，插件膨胀后维护成本上升；
- 依赖管理不显式: 根 `package.json` 6 个直接依赖与插件无关的依赖混杂；存在双 node_modules（根 90M + `.opencode/` 63M 重复安装 `@opencode-ai/plugin` 依赖闭包）；zod 版本分裂（根 4.4.3 传递 vs `@opencode-ai/plugin` 固定 4.1.8 嵌套）；
- 插件声明分散在 opencode.jsonc、oc.jsonc、tui.jsonc 三处；
- 插件运行库（ai、@ai-sdk/*、uuid）依赖解析版本无法从 plugins/ 内确认（无 manifest/lockfile）。

目标: 把本地插件逐个抽取为公开 npm 包 **opencode-tsgw**，单包版本演进式扩容；用户级配置只保留对包名的引用；作为对 OpenCode 生态的公共贡献开放给所有人。
