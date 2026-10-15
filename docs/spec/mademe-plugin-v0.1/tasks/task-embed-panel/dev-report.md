# task-embed-panel · 开发报告

> spec: docs/spec/mademe-plugin-v0.1/spec.md
> 更新: 2026-10-12（全部完成；T6/T7 经用户真实浏览器验收）

## 结论

**T1–T7 全部完成**：源码侧 build/typecheck/lint/format 全绿、包内测试 10/10、仓库全量回归 183/183；T6/T7 由用户在真实浏览器对真实服务（http://127.0.0.1:30000/）验收通过——**MadeMe 正常使用、登录状态跨刷新保留**。

## T2 保活池实验结论（关键架构决策）

独立实验页（计时 iframe 入池/搬回三轮，display:none 与屏外定位两种池）：

- `display:none` 池：**立即销毁浏览上下文**（计时死、DOM 不可读）。
- 屏外定位池（position:fixed; left:-10000px）：iframe 上下文存活，但**每次 appendChild 搬移必定重载**（计时归零，三轮一致）。
- 结论：本 webview（WebKit 内核，Safari 同系）中"同步搬移保留浏览上下文"不成立（Chrome 保留、WebKit 重载的已知差异）。**按 tech-design §8-1 预案降级**：面板卸载即销毁 iframe，切回按当前地址重新加载；登录态由浏览器 cookie 保留。spec feat02 场景2 已回写。

## 实现要点

- `MadeMePanel`：工具栏（地址展示 + 刷新 nonce + `window.open` 系统浏览器）+ iframe（DSH sandbox 策略 `allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox`、`referrerPolicy=no-referrer`、key=`url#nonce` 地址变化自动重载）+ 8 秒无 load 超时提示。
- 地址热生效：`client/index.ts` 从 `configForms.get<Record<string, unknown>>('kmh-mademe')` 订阅投影 `serviceUrl` 为 `ServiceUrlState` 快照 store，注入 main 面板 face；配置保存 → volatile 热提交 → store 更新 → iframe 按新地址重载。
- URL 校验复用 task-config-form 的 `normalizeHttpUrl`（含 hostname 显式校验，防 webview URL 解析宽松）。

## 用户验收记录（2026-10-12）

- 用户配置真实地址 `http://127.0.0.1:30000/`（服务在线，首页 307 → /login）。
- 用户在 KMH Web 内嵌面板中正常使用 MadeMe（含登录流程），刷新后登录保留——feat02 场景1/2/3 实际通过；场景4（超时提示）与场景5（地址热生效）由实现机制覆盖并在开发中经真实浏览器验证（8 秒超时提示、配置保存后面板按新地址重载）。
- 遗留观察项：无。
