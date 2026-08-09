# 版本演进路线（单包逐步扩容）

> 来源: DESIGN.md 第 7 节（2026-08-10 拆分）

- v0.1.0: ts_search（含 shared 基础: provider 探测/模型列表获取/认证/按模型注册）+ 全链路验证。
- v0.2.0: + ts_mark（audio/image/artifact/validation）。
- v0.3.0: + session_history。
- v0.4.0: + worktree_tools。
- v0.5.0: + tracing。

## 每个版本的迁移步骤（逐个执行，不跨版本合并）

1. 从 ~/.config/opencode/plugins/ 复制/重构该插件实现到 src/<name>/，引入 shared 共享模块（行为不变）;
2. `tsc --noEmit` 严格编译通过;
3. 本地开发验证（包未发布前可用配置临时指向本地路径或本地安装验证）;
4. 发布对应版本到 npm（见 operations/release.md）;
5. 配置 plugin 数组加入（或更新）包名;
6. **删除 ~/.config/opencode/plugins/ 下对应本地入口文件**（防双加载）;
7. 重启 OpenCode，用 `opencode debug info` 验证插件清单（本地入口消失、包内插件函数生效）。

> 迁移清单明细: 见 operations/migration.md
