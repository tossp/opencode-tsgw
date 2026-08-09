# 项目规则

## 项目定位

- opencode-tsgw：依赖 TSGW 网关模型的 OpenCode 插件扩展包（公共 npm 包）。
- 单包版本演进：v0.1 ts_search → v0.2 ts_mark → v0.3 session_history → v0.4 worktree_tools → v0.5 tracing。
- README 仅根目录一份，简述项目用途；施工蓝图与文档以 `docs/` 为准。

## 施工红线

- 不得静默改变既有插件行为（ts_search 的 chat.params、双路协议、输出契约；ts-mark 的参数语义与机械验证矩阵）；行为变更必须先重新整理设计并确认。
- 迁移期不得同时保留 `~/.config/opencode/plugins/` 本地入口与包内同名插件（防双加载）；配置切换与删除本地入口须同一窗口完成。
- 不使用 `@latest` 发布/引用策略；包内锁版本，配置引用固定精确版本。
- 不得绕过 strict 编译门槛（不通过排除文件、关闭 strict、`@ts-ignore` 或宽泛 any 让编译通过）。
- 未经确认不得发布 npm 包或修改本机 `~/.config/opencode` 配置。
- 依赖下限：`@opencode-ai/plugin`、`@opencode-ai/sdk` >= 1.18.0（本地实证 1.18.15）。

## 验证与交付

- 每个版本按序验收：`tsc --noEmit` 通过 → 固定输入输出夹具 + 有网关时受控实测 → 发布 → 配置切换 → `opencode debug info` 验证插件清单。
- 未验证或无法验证的部分必须明确标注，不得以局部成功当整体成功。

## 文档规则

- `docs/` 按主题域维护：`design/`（设计）、`research/`（取证）、`planning/`（规划）、`operations/`（执行）。
- 决策变更先更新文档、再改代码。
- 外部调研成果沉淀到 smemo 记忆系统；项目 docs 只记录采用/否决判断与理由。
