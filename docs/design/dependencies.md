# 依赖设计

> 来源: DESIGN.md 第 5 节（2026-08-10 拆分）

- dependencies（显式声明，解决"传递依赖当稳定依赖"问题）: `ai`、`@ai-sdk/openai-compatible`、`@opencode-ai/sdk`、`@ai-sdk/openai`、`uuid`（如 v0.1 不需要的包可延后加入，仅声明实际使用的）。
- `@opencode-ai/plugin`、`@opencode-ai/sdk`: **决策点 B 已确认（2026-08-10）**——版本下限 `>=1.18.0`（以本地安装版本为参照，本地实证 1.18.15）；声明位置入 dependencies。
- 版本策略: 包内锁定范围版本 + 自有 lockfile；不使用 `@latest` 动态解析（现有 formatter 声明 @latest 的教训: 不可复现）。
- 本包发布后，本地插件依赖从根 package.json 迁出，根清单只保留必要项（见 operations/migration.md）。

决策点跟踪: 见 planning/risks.md（决策点 B）。
