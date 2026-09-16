# opencode-tsgw

依赖 TSGW 网关模型的 OpenCode 插件扩展包（公共 npm 包）。

- 包提供五个插件：TS Search、TS Mark、Session History、Worktree Tools、Tracing。
- TS Search / TS Mark 启动即完整注册工具、模型枚举及参数默认值；后台 provider 查询不阻塞初始化，无相关 active 模型也显示工具。仅复用当前实例的在途查询，完成后调用时重新读取；执行期按真实配置、认证和网关请求处理错误，不因后台失败永久禁用工具。
- 实际请求地址依次取运行时 `options.baseURL`、目标模型 `api.url`、按需读取配置的 `provider.tsgw.options.baseURL`、`provider.tsgw.api`；不借用其他模型地址。
- 文档与工作跟踪以 GitHub 为准（Issues/PR）：https://github.com/tossp/opencode-tsgw

施工中，规则见 AGENTS.md。

## 图像支持（当前源码，尚未发布）

- 仅支持 `gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`、`gpt-image-2.5`，全部走 Images API；默认 **`gpt-image-2.5-flare`**，quality 为 `auto`、timeout 为 300 秒。
- 三个 ID 均允许 `low/medium/high/xhigh/max/auto`；已移除旧图像模型及 Responses 图像路径。
- 裸 ID `gpt-image-2.5` 原样透传、不映射变体，上游语义及参数接受性未知，不代表已核实当前 TSGW 部署。工具注册后可选择其他候选模型，由实际请求返回可用性结果。
- size 可省略、设为 `auto` 或正安全整数 `WIDTHxHEIGHT`，本地仅检查 16 对齐、宽高比不超过 3:1；其他限额由服务端检查，不继承旧模型像素预算或单边限制。
- 修复 GPT Images 的 quality/outputFormat 未实际发出：使用 SDK 的 `openai` 参数命名空间，请求体包含 `quality` 和 `output_format: "png"`。离线回归不代表真实网关生成已验证。

## 搜索模型（当前源码，尚未发布）

- 双路固定为 `gpt-6-astra` 和 `grok-4.6`，各自解析目标模型地址并走 chat/completions。
- 工具内部 GPT 请求固定 `reasoning_effort: "low"` 并启用 `web_search`；Grok 保持 `search_parameters`。不改变 OpenCode 全局模型变体或图像 quality。
- 仅完成离线请求回归，未验证真实网关搜索能力。
