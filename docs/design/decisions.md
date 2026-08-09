# 已确认决策

> 来源: DESIGN.md 第 2 节（2026-08-10 拆分）
> 状态: **锁定，勿变更**（变更需重新整理设计并确认）

| 决策点   | 结论 |
| -------- | ---- |
| 包名     | `opencode-tsgw`（已确认；表明依赖 TSGW 网关） |
| 包形态   | 公共 npm 包 + GitHub 公共仓库（无私有代码顾虑） |
| 演进方式 | 单包版本演进: v0.1 仅 ts_search，v0.2 + ts_mark，v0.3 + session_history，后续逐个并入 |
| 本地项目 | `~/proj/opencode-tsgw`（GitHub 同名单仓） |
| 网关依赖 | 网关是强制性的: 启动时探测 TSGW 网关并获取可用模型列表，按模型可用性决定注册（有模型→注册，无模型→不注册）；探测失败时兜底注册并在调用时返回明确不可用提示；纯本地插件（session-history、worktree-tools、tracing）不依赖网关 |
| 施工方式 | 按 docs/operations/construction.md 开工，逐步实施 |
