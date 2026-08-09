# 当前环境迁移清单（本机 ~/.config/opencode/，随版本逐个执行）

> 来源: DESIGN.md 第 8 节（2026-08-10 拆分）

1. 三处 plugin 声明（opencode.jsonc、oc.jsonc、tui.jsonc）按版本逐步调整;
2. 根 package.json 瘦身: 移除已迁出的插件运行库（ai、@ai-sdk/*、uuid、@opencode-ai/plugin 视最终需要）; 保留或明确 formatter 依赖（当前根 manifest ^0.0.6 与 oc.jsonc @latest 不一致，需统一策略）;
3. tsconfig.json: include 随本地插件删除逐步收窄（最终可能只剩 *.ts）;
4. .opencode/ 63M 独立依赖根: 本地插件全部迁出后评估是否清理;
5. up.sh 维护脚本同步更新;
6. 删除 plugins/ 下遗留空目录 aih_search/;
7. 迁移期间保持"发布验证一个、删除一个"节奏，不得提前批量删除本地入口。

> 版本节奏: 见 planning/roadmap.md
