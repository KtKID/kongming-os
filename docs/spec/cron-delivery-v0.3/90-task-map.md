# Task Map

## 推荐 task 拆分（8 个）

按依赖顺序排列。建议在 dev-pipeline/tasks/ 下创建对应目录，逐个走 x-req → x-plan → x-dev。

| 顺序 | 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 工作量 | 当前状态 |
|------|------|--------------|----------------|----------|--------|----------|
| 1 | M1 | `cron-delivery-v0.3-m1-schema` | ✅ | 无 | 1.5h | 可进入 x-req |
| 2 | M2 | `cron-delivery-v0.3-m2-fresh-session-persist` | ✅ | 无 | 1.5-2h | 可进入 x-req |
| 3 | M3 | `cron-delivery-v0.3-m3-bridge-route` | ✅ | M1, M2 | 1.5h | 可进入 x-req |
| 4a | M4 | `cron-delivery-v0.3-m4-web-sink` | ✅ | M1, M3 | 1.5h | 可进入 x-req |
| 4b | M5 | `cron-delivery-v0.3-m5-cli-sink` | ✅ | M1, M3 | 0.5h | 可进入 x-req |
| 5 | M6 | `cron-delivery-v0.3-m6-web-rest` | ✅ | M1, M4 | 1.5h | 可进入 x-req |
| 6 | M7 | `cron-delivery-v0.3-m7-web-frontend` | ✅ | M6 | 3-4h | 可进入 x-req |
| 7 | M8 | `cron-delivery-v0.3-m8-tool-schema` | ✅ | M1, M3 | 1h | 可进入 x-req |

**总工作量：12-13.5h**（比 README 初估 10-14h 的中位数）

## 依赖图

```
M1 schema ─┬─→ M3 bridge ─┬─→ M4 web sink ─→ M6 REST ─→ M7 frontend
           │               │
M2 session ┘               └─→ M5 cli sink
                           
                           └─→ M8 tool schema (依赖 M1 + M3 完成后协议稳定)
```

并行机会：M4 ∥ M5 ∥ M8（依赖 M3 后，三者互不影响）

## 推荐合并方案

**保持 8 个 task 不合并**的优点：

- 单 task 工作量都 ≤ 4h，单次 x-dev 可完成
- 失败回滚单位小
- 单测覆盖范围明确
- M2 fresh session 修复独立 commit 后立即提升 cron 调试性

**可选合并方案 A**（更激进，5 个 task）：

| 合并 task | 包含模块 | 工作量 |
|---|---|---|
| `cron-delivery-v0.3-foundation` | M1 + M2 | 3-3.5h |
| `cron-delivery-v0.3-delivery-core` | M3 + M4 + M5 | 3.5h |
| `cron-delivery-v0.3-web-rest` | M6 | 1.5h |
| `cron-delivery-v0.3-web-frontend` | M7 | 3-4h |
| `cron-delivery-v0.3-tool-schema` | M8 | 1h |

合并后总时长不变但单 task 更大。推荐**新手或不熟悉模块的 agent 走 8 task 方案**；**熟悉这套代码的 agent 可走 5 task 方案**。

## 建议执行顺序（对应 sleep-dev / 并行 agent）

### Wave 1（基础层，串行）
- M1 schema（必先）
- M2 fresh session 修复（独立可并行 M1）

### Wave 2（投递核心）
- M3 bridge route

### Wave 3（投递实现，可并行 3 子 agent）
- M4 web sink
- M5 cli sink
- M8 tool schema

### Wave 4（API 层）
- M6 web REST

### Wave 5（前端，最大头）
- M7 web frontend

## 每个 task 的产出物

每个 task 进 x-req → x-plan → x-dev 后应产出：

- `dev-pipeline/tasks/cron-delivery-v0.3-mN-xxx/README.md` —— 需求报告（x-req）
- `dev-pipeline/tasks/cron-delivery-v0.3-mN-xxx/plan.md` —— 实施计划（x-plan）
- `dev-pipeline/tasks/cron-delivery-v0.3-mN-xxx/dev-checklist.md` —— 开发清单（x-plan）
- `dev-pipeline/tasks/cron-delivery-v0.3-mN-xxx/changelog.md` —— 变更记录（x-dev 维护）
- `dev-pipeline/tasks/cron-delivery-v0.3-mN-xxx/dev-report.md` —— 自检报告（x-dev 完成时）
- `dev-pipeline/tasks/cron-delivery-v0.3-mN-xxx/reports/` —— x-verify / x-qua-gate / x-fix 产出

## 进入 x-req 的检查清单

每个模块进入 x-req 之前确认：

- [ ] 模块边界明确（02-module-breakdown.md 已列）
- [ ] 数据契约稳定（04-data-and-state.md 已列）
- [ ] 依赖模块状态：方案确认或更高
- [ ] 工作量估算 ≤ 4h（超过应再拆）
- [ ] 测试矩阵明确（05-validation-and-evolution.md 已列）

8 个模块全部满足上述清单 → **建议立即拆 task 进 x-req**。
