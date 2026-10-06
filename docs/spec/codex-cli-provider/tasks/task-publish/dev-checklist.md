# task-publish · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat07（独立分享）：导出可独立安装的插件包、版本基线与自定义可执行路径、与既有配置共存。依赖全部前置 task。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 发布包内容：files/exports 覆盖 Host 入口、Client 入口与类型声明，运行依赖全部为公开包名，构建产物自检 | feat07 场景1 | packages/codex-cli/package.json, packages/codex-cli/build.mjs | None | [ ] ⏳ |
| T2 | 版本基线与路径：声明官方 CLI 支持基线（0.160.0 起），配置可指定其他受支持版本的可执行文件路径 | feat07 场景2 | packages/codex-cli/src/status.ts, packages/codex-cli/src/config.ts | None | [ ] ⏳ |
| T3 | 独立安装验收：干净环境安装导出包后加载，模型对话、账号操作、详情页、测试连接完整工作，全程不改宿主代码 | feat07 场景4 | tests/runtime/codex-cli.test.mjs | 高:独立发布包若夹带宿主私有依赖即无法加载 | [ ] ⏳ |
| T4 | 共存验收：与既有 Agent 预设、工具注册、其他模型提供方共存互不干扰，现有模型选择器可选 Codex | feat07 场景3 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |
| T5 | 文档收尾：插件 README（安装、配置、故障处理）、plugin-index 补条目、spec 状态更新 | feat07 场景1-4 | packages/codex-cli/README.md, docs/kmh/plugin-index.md, docs/spec/codex-cli-provider/spec.md | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/
│   ├── package.json    M  # files/exports 发布面与公开依赖复核
│   ├── build.mjs       M  # 构建产物完整性自检
│   ├── src/status.ts   M  # 支持基线声明
│   ├── src/config.ts   M  # 自定义可执行路径
│   └── README.md       M  # 安装/配置/故障处理说明
├── docs/kmh/plugin-index.md           M  # codex-cli 插件功能索引条目
├── docs/spec/codex-cli-provider/spec.md  M  # 状态推进记录
└── tests/runtime/codex-cli.test.mjs   M  # 追加：独立安装与共存验收
```
