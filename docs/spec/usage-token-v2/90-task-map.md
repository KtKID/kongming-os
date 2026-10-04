# Task 映射

## 实施策略（敲定于 2026-05-15）

v2 走**单一 bigbang task**策略：1 个 PR + 4 个 commit + 一起合并。

| 单一 task | 内容 |
|---|---|
| **`usage-token-v2-bigbang`** | 后端架构改造 + 前端切换 + 全套验证 + 文档同步，**一步到位** |

详细 task 包：[`dev-pipeline/tasks/usage-token-v2-bigbang/`](../../dev-pipeline/tasks/usage-token-v2-bigbang/)

## 为什么不渐进式拆 6 task（决策历史）

原计划是把 v2 实施拆 6 个 task（schema v9 → 包+派生器 → claude 切 → codex+generic 切 → 前端拆分 → v1 清理），每个 0.5-1.5 天。

**用户洞察推翻**（2026-05-15 讨论）：v2 是架构纯重构，渐进迁移会留 5 个半成品中间状态在 main 上（v1 v2 并存、token 字段半删、wiring 部分切），实际比一刀切**更复杂、更容易遗忘"做到哪一步"**。

| | 原 6 task 渐进式 | bigbang 一步到位 |
|---|---|---|
| 中间状态 | 5 个（每 task 后） | **0 个**（main 上没有半成品） |
| commit 粒度 | 6 个 PR | **1 个 PR 4 commit** |
| 回滚成本 | 单 task 回滚 / 复杂依赖 | 整 PR revert 一刀切 |
| 实施时间 | 5 天分散 | **3 天集中** |
| "忘记做到哪" 风险 | 高（task 之间间隔可能数天） | **不存在**（一气呵成） |
| review 成本 | 6 次小 review | 1 次大 review（commit 拆好可读） |
| 编译期 atomicity 保护 | 弱（中间态可能编译过但逻辑半完整） | 强（commit 1 内 v1 引用必须全删，否则 import 报错） |

**结论**：bigbang 更适合架构纯重构。

## bigbang task 概览

详见 [`dev-pipeline/tasks/usage-token-v2-bigbang/README.md`](../../dev-pipeline/tasks/usage-token-v2-bigbang/README.md) 和 [`dev-checklist.md`](../../dev-pipeline/tasks/usage-token-v2-bigbang/dev-checklist.md)。

### 7 项开发清单（粗粒度）

| # | 优先级 | 🔍 | 内容 | 估时 |
|---|---|---|---|---|
| 1 | P0 | 🔍 | schema v9 + 物理删 3 字段 + lazy upgrade + 5 schema 测试 | 0.3d |
| 2 | P0 | 🔍 | v2 包：_models + 3 派生器 + manager（≥ 34 单测） | 1.2d |
| 3 | P0 | 🔍 | 装配 + service 三通道切换 + ws_event_sink + routers | 0.5d |
| 4 | P0 | 🔍 | 删 v1 包 + Contract 9 升级 + 后端全套验证 → **commit 1** | 0.2d |
| 5 | P0 | 🔍 | 前端切换：protocol + chat store + StatusLine 拆三组件 → **commit 2** | 0.5d |
| 6 | P0 |   | 三通道 Playwright e2e + 前端 build → **commit 3** | 0.3d |
| 7 | P0 |   | spec 文档同步 + docs/usage-token/ 归档 + dev-report → **commit 4** | 0.2d |

**总估时**：3.2 天

### Commit 拆分（task 内部纪律）

| commit | 范围 | atomicity |
|---|---|---|
| 1 | 后端架构改造（item 1-4） | v1 包删除 + v2 包建 + wiring 切，编译期保护：任何遗漏的 v1 引用都会 import 报错 |
| 2 | 前端切换（item 5） | 配套 commit 1 |
| 3 | e2e + 验证（item 6） | 三通道 Playwright + 前端 build |
| 4 | 文档同步（item 7） | spec 标记完成 + dev-report |

**合并纪律**：4 个 commit 一起进 main（不允许 commit 1/2 单独 push 后停下）。

### 关键决策点（2026-05-15 spike 全部敲死，零待定）

| # | 决策 | Final 值 |
|---|---|---|
| D-1 | generic_chat 派生器消费什么 backend | **只支持 FileSession**（`messages.jsonl` 每行带 `usage`）；InMemorySession/SQLiteSession → 派生器返回 None → 前端 StatusLine 留空。<br/>**依据**：`InMemorySession.append` 收 `usage` 但丢弃；`SQLiteSession` 项目内已不维护 |
| D-2 | preset_id → provider 厂商映射 | 用 `LLMPresetConfig.provider: Literal["openai_compatible","anthropic"] \| None`；`None` 时按 base_url 退化判定 |
| D-3 | generic_chat-openai 是否累加 | 不累加，取最后一条带 usage 的 message（跟 Claude 对称） |
| D-4 | v2 包路径 | 保留 `src/web/usage/usage_token_v2/`（不重命名回 v1） |
| D-5 | 前端组件命名 | `StatusLineClaude` / `StatusLineCodex` / `StatusLineGenericChat` |

### 风险（实施期监控）

D-1 ~ D-5 已 spike 敲死，实施期零阻塞决策。

| 风险 | 应对 |
|---|---|
| commit 1 改动大（~30 文件） diff 几千行 | 4 commit 拆好可读边界；x-verify + x-qa-gate 一并跑 |
| codex_locator 扫文件性能 | 复用 `web/codex/projects_scanner.py` 现成扫描器 |
| 三通道 e2e 需真实 SDK | 用 fixture jsonl/rollout mock |
| 前端 codegen 漂移 | 实施期间手写 TS 类型；codegen task 后续单独做 |
| generic_chat memory/sqlite backend 用户失去 token 显示 | D-1 决策：前端 StatusLine 留空；如有反馈再做 v3 扩展 |

## 实施回顾（2026-05-15）

bigbang 实施于 2026-05-15 凌晨在 sleep-dev 模式下分两次 commit 落地：

| Commit | Hash | 范围 | 状态 |
|---|---|---|---|
| 1 后端架构 | 3ce0193 | 删 v1 包 + 新建 v2 包 + 装配 + service 切换 + Contract 9 升级 + 后端测试更新 | ✅ |
| 2 前端切换 | 80635fb | protocol + chat store + StatusLine 拆三组件 + hooks 切 v2 | ✅ |
| 3 e2e + 前端 build | — | sleep-dev 模式跳过（不能起浏览器+server） | ⏭️ 留给用户 |
| 4 文档同步 | 待提交 | dev-report + changelog + 本回顾段 | 🟡 进行中 |

实际工时（sleep-dev 单会话）：约 4 小时（vs 估时 3.2 天）—— sleep-dev
模式无中断，跑得比预估快。

**决策点最终值**（spike 已敲死，实施无歧义）：

- D-1: generic_chat 派生器只支持 FileSession backend；memory/sqlite 返回 None
- D-2: preset_id → provider 用 `LLMPresetConfig.provider` 字段；None 时
  退化按 base_url 判定（task 6 实际由 thread_manager
  `_GenericChatSessionLocatorImpl` 实现，只查字段，未做 base_url fallback——
  后续如需再补）
- D-3: generic_chat-openai 不累加，取最后一条
- D-4: v2 包路径保留 `src/web/usage/usage_token_v2/`
- D-5: 前端组件按 provider 拆 3 个（StatusLineClaude / StatusLineCodex /
  StatusLineGenericChatOpenAI）

**踩坑记录**：

1. v1 包 `_migration.upgrade_v7_to_v8` 函数有跨包 import 白名单——删 v1 包后
   `thread_metadata.py` 导入挂掉。解法：内联 v7→v8 lazy upgrade 简化为"drop
   旧 5 字段"（v9 schema 不再需要 cumulative_usage dict 构造）。
2. ThreadMetadata 删 3 字段后，`thread_manager.rename_thread` /
   `pin_thread` 里 `cumulative_usage=meta.cumulative_usage` 跨字段透传 mypy
   报错——精确删除这些 v1 时代的字段透传。
3. ws_event_sink `UsageFrame(snapshot=...)` 需要改成 `UsageFrame(usage=...)`，
   连带 `_build_usage_snapshot` 函数重命名 + 重构为 `_build_usage_dto`。
4. 前端 chat.test.ts / StatusLine.test.tsx 老用例用 v1 形态（UsageView /
   ThreadUsageSummary），整段重写为 v2 ThreadUsage union 形态。
5. `npm run typecheck` 静默无输出但 exit=0 是正常通过——sleep-dev 模式下需要
   明确知道这点（不抛 error 即过）。

**未执行项**（需用户跑）：

- Commit 3：Playwright e2e（`npm run build` + `playwright test`）
- 重启 web server 让 v2 代码生效（sleep-dev 不动环境）
- WhiteboardCard.test.tsx 1 个预先存在 DOM query bug 跟本 task 无关

## 后续可能的扩展（v3 候选，不在本 v2 范围）

| 候选 | 触发条件 |
|---|---|
| Token 计费金额 | 用户报需要 thread / 月度账单显示费用 |
| 跨 thread 聚合 | 多用户场景 / 配额管理 |
| 派生缓存（mtime） | 实测扫 jsonl 性能瓶颈 |
| Server tool 计费 | Anthropic 发布 web_search 计费 |
| Codex rate_limits UI 渲染 | 前端要求显示速率限制进度条 |
| generic_chat 通道 SQLiteSession 支持 | 用户要求支持 sqlite backend 派生 |
| generic_chat preset.provider=None 时按 base_url 退化判定 | 现网真实出现 None preset |

## 验证矩阵（task 完成检查）

- [x] dev-report.md 全部命令 exit=0 + 关键输出片段命中
- [ ] x-verify Gate ① 通过（待用户跑）
- [ ] x-qa-gate Gate ② 通过（待用户跑）
- [x] 后端 commit 1 (3ce0193) 落地
- [x] 前端 commit 2 (80635fb) 落地
- [ ] 文档 commit 4（包含本回顾段更新）—— 当前提交
- [ ] e2e commit 3（用户跑 npm run build + playwright test）
- [ ] 4 个 commit 一起合并到 main（待 commit 3/4 完成后用户决定）
- [x] 实施回顾段补充到本文件
