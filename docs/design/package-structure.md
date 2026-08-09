# 包结构与文件布局

> 来源: DESIGN.md 第 4 节（2026-08-10 拆分）
> 更新: 2026-08-10 oracle 重审定稿（基于源码取证）

## 目录结构

```
opencode-tsgw/                  # repo 根（~/proj/opencode-tsgw）
├── package.json                # 包元数据 + 依赖（见 dependencies.md）
├── tsconfig.json               # strict: true，对齐现有编译门槛
├── README.md                   # 简述项目用途（仅根目录一份）
├── AGENTS.md                   # 项目规则（施工红线等约束）
├── LICENSE                     # 开源许可（暂缓选型）
├── .gitignore
└── src/
    ├── index.ts                # 唯一包根入口，保持极薄（只做导出转换）
    ├── shared/
    │   └── tsgw/               # 跨插件共享的 TSGW 机制层
    │       ├── constants.ts    # TSGW_PROVIDER_ID / TSGW_PROVIDER_LABEL
    │       ├── auth.ts         # createTsgwAuth（认证 hook + accessor + API-key 校验）
    │       ├── provider.ts     # provider 探测 / baseURL 类型提取
    │       └── model-availability.ts  # 模型字典读取与通用匹配机制
    ├── ts-search/              # v0.1: tsSearch 插件（auth/client/chat-params/… 保留插件内）
    ├── ts-mark/                # v0.2: tsMark 插件（image/audio/artifact/validation…）
    ├── session-history/        # v0.3
    ├── worktree-tools/         # v0.4
    └── tracing/                # v0.5
```

## 共享边界（源码取证定稿，2026-08-10）

| 内容                                                        | 归属          | 证据与约束                                   |
| ----------------------------------------------------------- | ------------- | -------------------------------------------- |
| TSGW_PROVIDER_ID / TSGW_PROVIDER_LABEL                      | shared/tsgw   | 两插件 constants 逐字一致                    |
| createTsgwAuth 的 hook、accessor 捕获、API-key 校验          | shared/tsgw   | auth.ts 47 行中 43 行一致；注入插件本地错误工厂 |
| provider 查找、baseURL 类型提取                              | shared/tsgw   | client.ts 探测流程 25/35 行一致；只投影所需字段 |
| 模型字典读取与通用匹配机制                                  | shared/tsgw   | provider.models 有类型证据；enabled 过滤待 F 实证 |
| new URL(baseURL) 校验                                        | ts-search 保留 | ts-mark 无此拒绝路径，移入共享会改变行为     |
| 工具→模型映射                                                | 各插件        | 搜索/图像/音频各自的注册策略                 |
| Search/Mark 协议客户端                                       | 各插件        | 双路 chat、Images/Responses/TTS 协议完全不同 |
| 错误类、phase、未知错误映射、ToolResult 渲染                | 各插件        | phase 集合与渲染契约有明确差异               |
| "不可用"最终文案与 metadata                                  | 各插件        | Search 双路报告 vs Mark 单失败结果           |

## 硬约束（迁移时强制执行）

1. **共享代码，不共享可变认证状态**: createTsgwAuth 每次调用创建独立 accessor 闭包；禁止把 accessor 提升为 shared 模块级变量（否则两插件互相覆盖认证状态）。
2. **错误工厂保持完整错误契约**: shared 不先包装通用错误再二次转换；保留原 phase / message / cause 与现有捕获路径。
3. **行为不变**: 抽取后 ts_search 的 chat.params、双路协议、输出契约；ts-mark 的参数语义与机械验证矩阵均不得改变。

## 根入口约束

- 插件目录各自默认导出一个插件函数（贴近现有源码）; src/index.ts 只负责转换为包加载器需要的导出形式。
- 根入口不得同时以 default 和 named 导出同一函数（防止枚举全部导出的加载器重复执行）。
- 根入口不得导出运行时 helper / 常量 / client; 公共 exports 初始只开放 "."。
- 决策点 A（多导出加载行为）若需调整，只改根适配层，不移动插件内部文件。

## 发布产物

- 编译后、非捆绑 ESM dist/; main / types / exports["."] 指向同一根入口; files 仅含 dist 与必要文档; 生成声明文件; 发布前检查 tarball。
- 不提前公开 shared/* 或插件子路径。
- moduleResolution bundler 配合非捆绑 ESM 需使用明确 .js 输出引用，打包安装验证后确认。
- 运行时兼容承诺: 仅 OpenCode 所带 Bun（推荐，待最终确认）。
