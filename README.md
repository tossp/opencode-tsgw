# opencode-tsgw

依赖 TSGW 网关模型的 OpenCode 插件扩展包（公共 npm 包）。

- 单包版本演进：v0.1 ts_search → v0.2 ts_mark → v0.3 session_history → v0.4 worktree_tools → v0.5 tracing
- 部分能力（TS Search / TS Mark）依赖 TSGW 网关的模型；无对应模型时相关工具不注册，探测失败时兜底返回不可用提示
- 文档导航：docs/design（设计）、docs/planning（路线与风险）、docs/operations（迁移与发布）、docs/research（现状取证）

施工中，规则见 AGENTS.md。
