# task-config-form · 开发清单

> spec: docs/spec/mademe-plugin-v0.1/spec.md
> 创建: 2026-10-12
> 方案修正: 配置走 DSH settings 体系（volatile 字段 + ctx.remote.settings），不自建存储与 Remote；见 tech-design §4.1 修正记录

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | Config schema：serviceUrl/mcpUrl/mcpEnabled 三个 volatile 字段（默认值、http(s) URL 校验拒绝非法值）+ node --test 单测（默认值、坏 URL 拒绝、合法 URL 通过） | feat04 场景1, 场景2 | packages/kmh-mademe/src/config.ts, packages/kmh-mademe/test/mademe-config.test.mjs | None | [x] 🟢 |
| T2 | 宿主半接线：apply(ctx, config) 导出 Config、保留配置引用（McpMount 在 task-mcp-tools 接入） | feat04 场景1 | packages/kmh-mademe/src/index.ts | None | [x] 🟢 |
| T3 | 配置表单：ConfigForm 注册 `plugins.row.config`（key '@kmh/mademe#kmh-mademe'），自建 MadeMeConfigController（ctx.configForms.get + SettingsFormModel/SettingsForm/SettingsValueField），非法 URL 阻塞保存、无 scheme 补 https | feat04 场景1, 场景2 | packages/kmh-mademe/src/client/ConfigForm.tsx, packages/kmh-mademe/src/client/config-controller.ts, packages/kmh-mademe/src/client/index.ts, packages/kmh-mademe/src/client/locales.ts, packages/kmh-mademe/package.json | None | [x] 🟢 |
| T4 | 实浏览器验收：插件详情打开表单、改地址保存生效（值持久化）、坏地址拦截提示 | feat04 场景1, 场景2 | 无（验证行） | None | [x] 🟢 |
| T5 | 可导出安装验收：临时 profile 经插件页安装本地路径（file: 指向本包），安装/启停/详情表单可用 | None | 无（验证行） | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent-os/
└── packages/kmh-mademe/
    ├── package.json                      M  # client inject 增加 remote 服务；devDeps 增 settings/schemastery 相关
    ├── src/index.ts                      M  # 导出 Config、apply(ctx, config) 保留配置引用
    ├── src/config.ts                     U  # 新增：三个 volatile 字段的 Config schema + URL 校验
    ├── src/client/index.ts               M  # 注册 ConfigForm 到 plugins.row.config（注入 controller face）
    ├── src/client/config-controller.ts   U  # 新增：SettingsFormModel 桥接（URL/布尔字段 spec + staged 编辑）
    ├── src/client/ConfigForm.tsx         U  # 新增：行详情配置表单（SettingsForm + SettingsValueField + Checkbox）
    ├── src/client/locales.ts             M  # 表单文案
    └── test/mademe-config.test.mjs       U  # 新增：schema 默认值与校验单测
```
