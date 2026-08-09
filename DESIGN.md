# opencode-tsgw 设计文档

> 状态: 待确认（施工蓝图）
> 用途: 作为新会话实施 opencode-tsgw 包的独立蓝图，不依赖本设计讨论的上下文。

## 1. 背景与目标

当前 OpenCode 用户级配置目录 `~/.config/opencode/` 同时承担配置、插件源码与依赖管理，存在以下问题:

- 插件源码与配置混居，插件膨胀后维护成本上升；
- 依赖管理不显式: 根 `package.json` 6 个直接依赖与插件无关的依赖混杂；存在双 node_modules（根 90M + `.opencode/` 63M 重复安装 `@opencode-ai/plugin` 依赖闭包）；zod 版本分裂（根 4.4.3 传递 vs `@opencode-ai/plugin` 固定 4.1.8 嵌套）；
- 插件声明分散在 opencode.jsonc、oc.jsonc、tui.jsonc 三处；
- 插件运行库（ai、@ai-sdk/*、uuid）依赖解析版本无法从 plugins/ 内确认（无 manifest/lockfile）。

目标: 把本地插件逐个抽取为公开 npm 包 **opencode-tsgw**，单包版本演进式扩容；用户级配置只保留对包名的引用；作为对 OpenCode 生态的公共贡献开放给所有人。

## 2. 已确认决策（勿变更）

| 决策点 | 结论 |
|---|---|
| 包名 | `opencode-tsgw`（已确认；表明依赖 TSGW 网关） |
| 包形态 | 公共 npm 包 + GitHub 公共仓库（无私有代码顾虑） |
| 演进方式 | 单包版本演进: v0.1 仅 ts_search，v0.2 + ts_mark，v0.3 + session_history，后续逐个并入 |
| 本地项目 | `~/proj/opencode-tsgw`（GitHub 同名单仓） |
| 网关依赖 | 网关是强制性的: 启动时探测 TSGW 网关并获取可用模型列表，按模型可用性决定注册（有模型→注册，无模型→不注册）；探测失败时兜底注册并在调用时返回明确不可用提示；纯本地插件（session-history、worktree-tools、tracing）不依赖网关 |
| 施工方式 | 新会话按本文档开工，逐步实施 |

## 3. 现状盘点（证据摘要，2026-08-10 取证）

### 3.1 本地插件（~/.config/opencode/plugins/，5 入口 + 39 文件 + 3,344 行）

| 插件 | 规模 | 外部依赖 | 依赖网关 |
|---|---|---|---|
| ts_search | 709 行（入口+9 文件: auth/chat-params/client/constants/error/render/request/response/tool） | @opencode-ai/plugin、@opencode-ai/sdk/v2、@ai-sdk/openai-compatible、ai | 是 |
| ts-mark | 866 行（入口+8 文件: artifact/audio/auth/client/constants/image/metadata/validation） | @opencode-ai/plugin、@opencode-ai/sdk/v2、@ai-sdk/openai-compatible、@ai-sdk/openai、ai、uuid | 是 |
| session-history | 1,047 行（入口+9 文件） | 仅 @opencode-ai/plugin | 否 |
| worktree-tools | 693 行（入口+9 文件） | @opencode-ai/plugin、@opencode-ai/sdk/v2 | 否 |
| tracing | 29 行单文件 | 仅 @opencode-ai/plugin | 否 |

全部 5 个插件合计第三方依赖 specifier 仅 6 个: @opencode-ai/plugin、@opencode-ai/sdk（/v2 子路径）、@ai-sdk/openai-compatible、@ai-sdk/openai、ai、uuid。

另有遗留空目录 `plugins/aih_search/`（可清理）。

### 3.2 依赖环境（~/.config/opencode/）

- 根 package.json 依赖: @ai-sdk/openai ^4.0.36、@ai-sdk/openai-compatible ^3.0.27、@franlol/opencode-md-table-formatter ^0.0.6、@opencode-ai/plugin ^1.18.15、ai ^7.0.58、uuid ^14；devDeps @types/node ^26.2.0。无 name/scripts/packageManager。
- tsconfig.json: target ES2022、module ES2022、moduleResolution bundler、strict true，include ["plugins/**/*.ts", "*.ts"]。
- 双 npm 根: 根 node_modules 90M；.opencode/package.json 固定 @opencode-ai/plugin 1.18.15 + 独立 lockfile，node_modules 63M。
- 运行时实证（opencode debug info，2026-08-10）: 实际加载 7 个插件 = 2 个 npm 包（@franlol/opencode-md-table-formatter@latest、@cortexkit/opencode-magic-context@0.35.0）+ 5 个本地文件插件。

### 3.3 官方生态机制（opencode.ai/docs/zh-cn/ecosystem + plugins 文档，快照提交 0bff28de）

- 接入: opencode.json 的 `plugin` 数组写 npm 包名（支持 scoped 包）；npm 插件启动时由 Bun 自动安装，缓存在 `~/.cache/opencode/node_modules/`。
- 发现: 无官方 registry/marketplace；官方生态页是社区 PR 维护的 Markdown 清单（ecosystem.mdx）；另有 awesome-opencode、opencode.cafe 社区聚合。
- 模块契约: "插件是一个 JavaScript/TypeScript 模块，它导出一个或多个插件函数。每个函数接收一个上下文对象，并返回一个钩子对象。"
- 未规定: package.json 的 main/exports/keywords、默认导出、发布目录、包名前缀（opencode-* 仅是示例习惯）、脚手架、发布 CLI（社区模板 zenobi-us/opencode-plugin-template 已 archived，仅参考）。
- ⚠️ 重复加载警告: "本地插件和名称相似的 npm 插件会分别独立加载"——迁移必须删除对应本地入口文件，防止双加载。
- 加载顺序: 全局配置 → 项目配置 → 全局插件目录 → 项目插件目录；同名同版本 npm 包只加载一次。
- 本地依赖: 配置目录 package.json 声明的依赖会在启动时 bun install（本地插件模式的依赖承载方式；抽取为包后依赖转入包自身声明）。

## 4. 包结构设计

```
opencode-tsgw/                  # repo 根（~/proj/opencode-tsgw）
├── package.json                # 包元数据 + 依赖（见 §5）
├── tsconfig.json               # strict: true，对齐现有编译门槛
├── README.md                   # 能力清单、TSGW 网关依赖说明、安装方式、示例
├── LICENSE                     # 开源许可（开工时选型）
├── .gitignore
└── src/
    ├── index.ts                # 聚合导出全部插件函数（具名导出）
    ├── shared/                 # 跨插件共享: tsgw provider 探测、认证、client、优雅降级文案
    ├── ts-search/              # v0.1: tsSearch 插件函数 + 实现（auth/chat-params/client/constants/error/request/render/response/tool）
    ├── ts-mark/                # v0.2: tsMark 插件函数（artifact/audio/image/metadata/validation）
    ├── session-history/        # v0.3
    ├── worktree-tools/         # v0.4
    └── tracing/                # v0.5
```

要点:
- 每个插件一个目录，导出插件函数（具名导出），与官方"导出一个或多个插件函数"契约一致。
- 根 index.ts 聚合导出所有插件函数; 配置 `plugin` 数组写 `"opencode-tsgw"`。
- ts_search 与 ts-mark 各自独立的 auth.ts/client.ts 抽取为 shared/（认证 hook、client 构造、provider 探测与模型列表获取逻辑复用，注意两者用途不同: ts_search 走 OpenAI-compatible + web_search 工具；ts-mark 走 images API + TTS 专用路由，抽取时不得改变既有行为语义）。
- 编译门槛: 沿用 strict: true（与现有验证门槛一致）; 不通过排除文件、关闭 strict、@ts-ignore 或宽泛 any 让编译通过。

## 5. 依赖设计

- dependencies（显式声明，解决"传递依赖当稳定依赖"问题）: `ai`、`@ai-sdk/openai-compatible`、`@ai-sdk/openai`、`@opencode-ai/sdk`、`uuid`（如 v0.1 不需要的包可延后加入，仅声明实际使用的）。
- `@opencode-ai/plugin`: **决策点 B**——dependencies 或 peerDependencies 开工时验证（建议先看 @franlol/opencode-md-table-formatter 与 @cortexkit/opencode-magic-context 的 package.json 实践，再以最小验证确认运行时解析正常）。
- 版本策略: 包内锁定范围版本 + 自有 lockfile；不使用 `@latest` 动态解析（现有 formatter 声明 @latest 的教训: 不可复现）。
- 本包发布后，本地插件依赖从根 package.json 迁出，根清单只保留必要项（见 §8）。

## 6. 网关强制与按模型注册

注册决策由 TSGW 网关的可用模型列表驱动（三层逻辑）:
1. 启动时成功探测 TSGW provider 并取得可用模型列表:
   - 工具所需模型在可用列表中 → 注册该工具，功能生效;
   - 无相关模型 → 不注册该工具（不在工具清单中出现）。
2. 启动时探测失败（拿不到 provider 状态或模型列表，异常/超时兜底）→ 工具依然注册，调用时返回明确不可用提示（如"当前未配置 TSGW 网关"或"该模型不可用"），作为正常 ToolResult 返回，不抛异常。
3. 纯本地插件（session-history、worktree-tools、tracing）不参与模型注册逻辑，始终注册。

探测方式:
- provider 状态: 通过注入的 client.config.providers() 获取，从 result.data.providers[] 查找 id === "tsgw"，读取 options.baseURL（既有已验证做法; 插件只保留类型检查过的 baseURL，不记录/透传完整 provider 响应，响应可能含 key）。
- 模型列表获取: 待验证（决策点 F）——providers() 返回数据是否含模型列表，或需 OpenCode SDK 其他 API（如 provider.models）; 施工第一步确认，若确实无法获取模型列表，则整体退化为第 2 层策略（始终注册 + 调用时不可用）。

工具→模型映射（施工时定义并随版本维护）:
- ts_mark: 图像生成模型（gpt-image-2 / gpt-5.6-luna）+ TTS 模型（mimo-v2.5-tts）等;
- ts_search: GPT 路（gpt-5.4）+ Grok 路（grok-4.20-fast）模型等;
- 每个工具声明所需模型族，注册时按清单检查。

其他:
- chat.params 自动参数 hook 与认证 hook: 仅在 TSGW provider 存在时生效; 无网关时不影响其他 provider 的会话。
- 工具 description 中注明各自能力依赖（如"需要 TSGW 网关与相应模型"），让调用方提前判断。

## 7. 版本演进路线（单包逐步扩容）

- v0.1.0: ts_search（含 shared 基础: provider 探测/模型列表获取/认证/按模型注册）+ 全链路验证。
- v0.2.0: + ts_mark（audio/image/artifact/validation）。
- v0.3.0: + session_history。
- v0.4.0: + worktree_tools。
- v0.5.0: + tracing。

每个版本的迁移步骤（逐个执行，不跨版本合并）:
1. 从 ~/.config/opencode/plugins/ 复制/重构该插件实现到 src/<name>/，引入 shared 共享模块（行为不变）;
2. `tsc --noEmit` 严格编译通过;
3. 本地开发验证（包未发布前可用配置临时指向本地路径或本地安装验证）;
4. 发布对应版本到 npm;
5. 配置 plugin 数组加入（或更新）包名;
6. **删除 ~/.config/opencode/plugins/ 下对应本地入口文件**（防双加载）;
7. 重启 OpenCode，用 `opencode debug info` 验证插件清单（本地入口消失、包内插件函数生效）。

## 8. 当前环境迁移清单（本机 ~/.config/opencode/，随版本逐个执行）

1. 三处 plugin 声明（opencode.jsonc、oc.jsonc、tui.jsonc）按版本逐步调整;
2. 根 package.json 瘦身: 移除已迁出的插件运行库（ai、@ai-sdk/*、uuid、@opencode-ai/plugin 视最终需要）; 保留或明确 formatter 依赖（当前根 manifest ^0.0.6 与 oc.jsonc @latest 不一致，需统一策略）;
3. tsconfig.json: include 随本地插件删除逐步收窄（最终可能只剩 *.ts）;
4. .opencode/ 63M 独立依赖根: 本地插件全部迁出后评估是否清理;
5. up.sh 维护脚本同步更新;
6. 删除 plugins/ 下遗留空目录 aih_search/;
7. 迁移期间保持"发布验证一个、删除一个"节奏，不得提前批量删除本地入口。

## 9. 发布流程（npm + GitHub）

1. 开工第一步: 检查 npm 包名 `opencode-tsgw` 是否可用;
2. 仓库初始化: git init、README、LICENSE、.gitignore、package.json、tsconfig（strict）;
3. 版本规范: semver; 每次扩容发布 minor（v0.1 → v0.2 → ...）;
4. 元数据: keywords（opencode、plugin、tsgw 等）、description（说明依赖 TSGW 网关的能力）、homepage 指向 GitHub;
5. `npm publish`（公共包，无 access 限制）;
6. 可选（生态曝光）: 向官方仓库提交 PR，将 opencode-tsgw 加入 ecosystem.mdx 清单（社区 PR 机制，无官方审查标准文档，按现有表格格式提交即可）;
7. 后续可评估 GitHub Actions 自动化发布（tag 触发）。

## 10. 风险与待验证点（开工时逐项确认）

- A. 多插件函数单包加载行为: 官方契约支持"一个或多个插件函数"，但 plugin 数组写包名时是否加载全部导出，需最小验证（debug info 观察）。若只加载首个导出，退化为 exports 子路径方案（plugin 数组写 `opencode-tsgw/ts-search` 等）。
- B. @opencode-ai/plugin 的声明方式（peer vs dependencies）与运行时解析行为。
- C. npm 包名 opencode-tsgw 可用性。
- D. Bun 自动安装缓存 ~/.cache/opencode/node_modules/ 的版本解析行为（包自身锁版本即可规避）。
- E. 迁移期双加载防护（先删本地入口、再重启验证）。
- F. 模型列表获取方式: providers() 返回是否含模型列表，或需 SDK 其他 API; 决定"按模型注册"能否实现（若无法获取，退化为"始终注册 + 调用时不可用"）。

## 11. 新会话开工步骤（按序执行）

1. 检查 npm 包名可用性（决策点 C）;
2. git init + 基础文件（package.json、tsconfig strict、README、LICENSE、.gitignore）;
3. 决策点 B 验证: 参照现成插件包实践确定 @opencode-ai/plugin 声明方式;
4. 决策点 F 验证: 确认能否在插件启动阶段获取 TSGW 网关可用模型列表，确定按模型注册实现路径（无法获取则确认整体退化策略）;
5. 迁移 v0.1: src/shared/（含模型列表探测）+ src/ts-search/，行为保持不变（ts_search 双路路由、chat.params、认证 hook、输出契约）;
6. 决策点 A 验证: 确认单包多插件导出加载行为，必要时调整导出结构;
7. tsc --noEmit 通过 → 本地验证功能（搜索/图像/音频等如有网关则实测）;
8. 发布 v0.1.0 到 npm;
9. 配置切换 + 删除本地 ts_search 入口 + 重启 + debug info 验证;
10. 提交生态 PR（可选）;
11. 进入 v0.2（ts_mark），重复 4-10 节奏。

## 12. 禁止事项（施工红线）

- 不得静默改变既有插件行为（ts_search 的 chat.params、双路协议、输出契约；ts-mark 的参数语义与机械验证矩阵等）; 行为变更必须先重新整理设计并确认。
- 不得在迁移期同时保留本地入口与包内同名插件（双加载）。
- 不得用 @latest 发布策略; 包内锁版本。
- 不得绕过 strict 编译门槛。
- 不在设计文档未经确认前发布包或修改本机配置。
