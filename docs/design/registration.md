# 网关强制与按模型注册

> 来源: DESIGN.md 第 6 节（2026-08-10 拆分）
> 更新: 2026-08-10 oracle 重审定稿

注册决策由 TSGW 网关的可用模型列表驱动（三层逻辑）:
1. 启动时成功探测 TSGW provider 并取得可用模型列表:
   - 工具所需模型在可用列表中 → 注册该工具，功能生效;
   - 无相关模型 → 不注册该工具（不在工具清单中出现）。
2. 启动时探测失败（拿不到 provider 状态或模型列表，异常/超时兜底）→ 工具依然注册，调用时返回明确不可用提示（如"当前未配置 TSGW 网关"或"该模型不可用"），作为正常 ToolResult 返回，不抛异常。
3. 纯本地插件（session-history、worktree-tools、tracing）不参与模型注册逻辑，始终注册。

> 语义澄清（2026-08-10）: "网关强制" = 能力依赖（无网关功能不生效）; "探测失败兜底注册" = 容错策略。二者是同一设计的两个层面，不冲突。

## 探测方式

- provider 状态: 通过注入的 client.config.providers() 获取，从 result.data.providers[] 查找 id === "tsgw"，读取 options.baseURL（既有已验证做法; 插件只保留类型检查过的 baseURL，不记录/透传完整 provider 响应，响应可能含 key）。
- 模型列表获取: **决策点 F 部分确认（2026-08-10）**——config.providers() 返回的 provider 含 models 字段（Record<string, Model>），按 id === "tsgw" 过滤后即可读取模型字典，"按已配置模型注册"可实现；根 SDK 无专用模型 API（v2 model.list() 带 enabled 但 PluginInput.client 不可用）。缺运行时实证（启动加载时序、逐模型 enabled）——见 operations/construction.md 验证清单 F。
- 模型匹配规则: **任一可用即注册**（工具声明模型族，族内任一模型在可用列表即注册）+ 精确 ID 为主、显式别名表兜底。

## 工具→模型映射（施工时定义并随版本维护）

- ts_mark: 图像生成模型（gpt-image-2 / gpt-5.6-luna）+ TTS 模型（mimo-v2.5-tts）等;
- ts_search: GPT 路（gpt-5.4）+ Grok 路（grok-4.20-fast）模型等;
- 每个工具声明所需模型族，注册时按清单检查; 工具→模型映射属于各插件自己的注册策略（shared 只提供匹配机制）。

## 三层模型语义（运行时验证项，写入施工）

1. 探测成功且存在所需模型 → 只注册对应工具;
2. 探测成功但无相关模型 → 不注册对应工具;
3. 探测失败 → 工具仍注册，调用返回既定不可用 ToolResult;
4. 模型已配置/列出但实际网关调用失败 → 不得把"已注册"表述为"此刻可调用"，调用期按各插件错误契约返回;
5. 纯本地插件始终注册; ts_search 的 chat.params 仅对 TSGW 及相应 GPT/Grok 模型族生效。

## 其他

- chat.params 自动参数 hook 与认证 hook: 仅在 TSGW provider 存在时生效; 无网关时不影响其他 provider 的会话。
- 工具 description 中注明各自能力依赖（如"需要 TSGW 网关与相应模型"），让调用方提前判断。

决策点跟踪: 见 planning/risks.md（决策点 F）+ operations/construction.md（最小验证清单）。
