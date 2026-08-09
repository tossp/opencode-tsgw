# 发布流程（npm + GitHub）

> 来源: DESIGN.md 第 9 节（2026-08-10 拆分）

1. 开工第一步: 检查 npm 包名 `opencode-tsgw` 是否可用——✅ 已确认可用（2026-08-10）;
2. 仓库初始化: git init、README、LICENSE、.gitignore、package.json、tsconfig（strict）——✅ 基础骨架已完成（2026-08-10）;
3. 版本规范: semver; 每次扩容发布 minor（v0.1 → v0.2 → ...）;
4. 元数据: keywords（opencode、plugin、tsgw 等）、description（说明依赖 TSGW 网关的能力）、homepage 指向 GitHub;
5. `npm publish`（公共包，无 access 限制）;
6. 可选（生态曝光）: 向官方仓库提交 PR，将 opencode-tsgw 加入 ecosystem.mdx 清单（社区 PR 机制，无官方审查标准文档，按现有表格格式提交即可）;
7. 后续可评估 GitHub Actions 自动化发布（tag 触发）。
