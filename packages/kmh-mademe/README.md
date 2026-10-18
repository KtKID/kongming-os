# @kmh/mademe

MadeMe 服务插件：Kongming Web 的第一个"服务插件"——在现有侧栏注册 MadeMe 入口，点击在主区内嵌打开 MadeMe 网页；插件详情页提供配置表单（服务地址）与连通性测试。以 `dsh.bundle.patch` 组合包形式分发，可被任何 DSH Web 经插件页安装启停，是后续服务插件（知识、Meloop、x-infra 等）的模板。设计规格与任务验证记录见仓库 [docs/spec/mademe-plugin-v0.1/](../../docs/spec/mademe-plugin-v0.1/)。

MadeMe 的知识库工具（助手侧 `mcp__mademe__<tool>`）不由本插件装配：kmh-web profile 以独立的 `mcp-mademe` 实例拉起 MadeMe-web 自带的 stdio MCP 服务，接入路径、验证与停用方式见 [Web 配置 · MadeMe 工具](../../profiles/kmh-web/README.md#mademe-工具)。

## 仓库位置与宿主关系

本包由 kongming-os 主仓库直接跟踪，位于 `packages/kmh-mademe`：`package.json` 的 devDependencies 以 `link:../../third_party/dsh/...` 相对路径引用本仓的 DSH 子模块，安装、构建与测试（`pnpm install --frozen-lockfile`、`pnpm --filter @kmh/mademe build`、根 `pnpm test`）在本仓 workspace 内执行。本包于 2026-10 自 kongming-agent-os 检出内的独立 Git 仓库迁入，迁移前的独立提交历史留存在原仓库。

**一个组合包即一个插件，整体交付、整体启停**：宿主半（Node，条目 `kmh-mademe`）承载配置 schema；浏览器半承载入口、面板与表单。停用本插件即一并移除入口、面板与配置表单；MadeMe 工具属于 profile 的 `mcp-mademe` 实例，不随本插件启停。Kongming 自有包清单见[插件索引](../../docs/kmh/plugin-index.md)。

## 使用本包

kmh-web profile 在 [package.json](../../profiles/kmh-web/package.json) 的 dependencies 声明本包，并在 [cordis.patch.yml](../../profiles/kmh-web/cordis.patch.yml) 以实例 `kmh-mademe` 挂载；安装后侧栏出现 MadeMe 图标，插件详情页（插件页 → View @kmh/mademe）直接内联配置表单：

- **MadeMe 服务地址**：内嵌网页的打开目标，修改保存后面板按新地址热加载
- **测试连接**：对服务地址做可达性探测（no-cors，5 秒超时），显示可达耗时或不可达

地址校验与规范化（无 scheme 补 https）在表单层完成；保存经 settings 体系（revision 乐观锁）写入 profile patch 并 volatile 热提交。构建产物 `lib/src/index.js`（宿主半）与 `lib/client.js`（浏览器半，`__ModuleLoader__` 工厂），`pnpm --filter @kmh/mademe build` 生成。

## 理解实现

宿主半（`src/index.ts` + `src/config.ts`）声明一个 `.volatile()` 字段 `serviceUrl` 的 Config schema——**必须用原生 `Schema.string()`**，transform 节点的序列化产物会被 settings 的 client 链路丢弃（namespace 不可见，实测结论）；`apply` 为空，配置的读写、持久化与热提交全部由 settings 体系与 loader 承担。浏览器半（`src/client/`）四件注册：`sidebar.panellist` 图标行、`main` keyed 面板（注入 serviceUrl 快照，来自 configForms 订阅投影）、`plugins.bundle.config` + `plugins.row.config` 配置表单（共用一个 `MadeMeConfigController`，基于 ui-primitives 的 SettingsFormModel）。面板 iframe 沿用 DSH 浏览器 tab 的 sandbox 策略；8 秒无 load 显示"可能无法内嵌打开"提示。构建范式与 `packages/codex-cli` 一致（build.mjs + tsconfig 双 references + `dsh.client` 元数据）。

## 已知限制

- 面板切走即卸载 iframe，切回按当前地址重新加载——WebKit/Safari 系浏览器同步搬移 iframe 必定重载（实验结论，Chrome 保留），保活池不可依赖；服务登录态由 cookie 保留。
- 同一服务无法同时登录两个账号（浏览器 Cookie 按域隔离的通用限制）。
- 拒绝被内嵌的服务（X-Frame-Options/CSP frame-ancestors）只能以超时提示 + 系统浏览器打开兜底，无法精确区分拒绝与不可达。

## 开发备注

验证沙箱配方见 [tests/runtime/web-plugin-hmr.test.mjs](../../tests/runtime/web-plugin-hmr.test.mjs)（临时目录 + 符号链接 + `--no-watch`）。历史决策与排障记录见 [docs/spec/mademe-plugin-v0.1/tasks/](../../docs/spec/mademe-plugin-v0.1/tasks/) 的 dev-report。
