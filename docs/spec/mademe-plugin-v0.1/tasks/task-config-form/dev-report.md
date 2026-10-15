# task-config-form · 开发报告

> spec: docs/spec/mademe-plugin-v0.1/spec.md
> 更新: 2026-10-12（T1–T4 完成）

## 结论

**T1–T4 全部完成并经真实浏览器验证**：包内测试 10/10、仓库全量回归 183/183；feat04 三个场景（含新增的连通性测试场景）端到端通过。T5（可导出安装验收）未开始。

## 浏览器验证记录（沙箱实例 http://127.0.0.1:60002，IAB）

- **场景1 查看/修改/持久化**：插件详情页直接内联显示配置表单（两 URL 字段默认值 + MCP 开关 + 测试连接 + Save）；修改 serviceUrl 为 `http://127.0.0.1:9999` 保存 → Save 回落禁用（staged 清空）、值规范化补尾斜杠、**profile patch 落盘**（`config: serviceUrl: http://127.0.0.1:9999/`）；刷新重进详情页值正确恢复。
- **场景2 坏地址拦截**：填 `not a valid url` → 内联提示 "a legal http(s) URL is required"、Save 禁用。
- **场景3 测试连接**：点击按钮 → 并行探测两个地址，状态行显示 `Service：unreachable or timed out · MCP：unreachable or timed out`（8100 无服务，正确）。
- 验证后已把 serviceUrl 改回默认并保存（落盘 `http://127.0.0.1:8100/`）。

## 两个关键根因（实现期发现）

1. **transform schema 字段会被 settings 链路丢弃**：宿主 describe 返回含 kmh-mademe（铁证日志），但 client mirror 拿不到——schemastery `Schema.transform()` 节点的序列化产物在 client 侧校验中被丢弃，导致 namespace 不可见（表单永远 loading/unavailable）。**解法：宿主 Config 用原生 `Schema.string().volatile()`，URL 校验与规范化全部移到表单 parse 层**（settingsHttpUrlField）。对照组：官方 Shell 卡（string/number 字段）一直正常。
2. **部分 WebKit 系 webview 的 `new URL()` 对非法 host 不抛错**（与 Node 行为不一致），曾绕过校验。**解法：normalizeHttpUrl 增加显式 hostname 字符校验**（域名/IPv4/IPv6 字面量）。

## 设计落点

- 表单同时注册 `plugins.bundle.config`（插件详情页内联，用户要求的入口）与 `plugins.row.config`（组件行详情，官方模式），共用一个 MadeMeConfigController（`ctx.configForms.get('kmh-mademe')` + SettingsFormModel）。
- 连通性测试为 client 侧 no-cors fetch 探测（5 秒超时），测当前草稿值，无需宿主参与。

## 未决

1. T5 可导出安装验收（file: 安装到临时 profile）未做。
2. serviceUrl/mcpUrl 默认值为占位 `http://127.0.0.1:8100`，待用户提供真实默认地址（src/config.ts TODO）。
3. 环境备注：IAB 对沙箱实例的导航/点击偶发超时（remote inventory 亦偶发挂起），重启实例可恢复；DOM click（evaluate el.click()）稳定可用。
