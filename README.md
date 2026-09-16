# opencode-tsgw

依赖 TSGW 网关模型的 OpenCode 插件扩展包（公共 npm 包）。

- 包提供五个插件：TS Search、TS Mark、Session History、Worktree Tools、Tracing。
- TS Search / TS Mark 根据 OpenCode 配置中 `tsgw` 的模型字典 key 和 `status=active` 注册；成功读取但无对应活跃模型时不注册，provider 缺失或读取失败时兜底返回不可用提示。缺地址不影响注册判定。
- 实际请求地址依次取运行时 `options.baseURL`、目标模型 `api.url`、按需读取配置的 `provider.tsgw.options.baseURL`、`provider.tsgw.api`；不借用其他模型地址。
- 文档与工作跟踪以 GitHub 为准（Issues/PR）：https://github.com/tossp/opencode-tsgw

施工中，规则见 AGENTS.md。

## 图像支持（当前源码，尚未发布）

- 默认模型仍为 `gpt-image-2`，默认 quality 为 `auto`、timeout 为 300 秒；GPT Image 2/2.5 走 Images API，`gpt-5.6-luna` 保持 Responses 路径。
- 新增 `gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`、`gpt-image-2.5`，允许 `low/medium/high/xhigh/max/auto`；旧 GPT Image 2 与 Luna 仍只允许 `low/medium/high/auto`。
- 裸 ID `gpt-image-2.5` 仅确认已列于 TSGW 模型列表，原样透传、不映射变体；生成及参数接受性未实测。工具注册后可选择其他候选模型，由实际请求返回可用性结果。
- 2.5 的 size 可省略、设为 `auto` 或正安全整数 `WIDTHxHEIGHT`，本地仅检查 16 对齐、宽高比不超过 3:1；其他限额由服务端检查。旧模型尺寸校验保持不变。
- 修复 GPT Images 的 quality/outputFormat 未实际发出：使用 SDK 的 `openai` 参数命名空间，请求体包含 `quality` 和 `output_format: "png"`。离线回归不代表真实网关生成已验证。
