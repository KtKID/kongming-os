# Task Map

## 任务一览

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|---|---|---|---|---|
| InputNormalizer | `safety-input-normalize` | 是 | 无 | 可进入 x-req |
| ShellIntentParser（第一批 5 verb） | `safety-shell-intent-parser` | 是 | InputNormalizer | 可进入 x-req |
| MechanismRule 表 + Legacy Fallback 切分 | `safety-mechanism-rule-split` | 是 | 无（仅改 default_rules.py） | 可进入 x-req |
| HardBlockGuard 重构 | `safety-hardblock-intent-integration` | 是 | parser + 机制表切分 | 可进入 x-req |
| ShellIntentParser（第二批 8 verb） | `safety-shell-intent-extend` | 是 | hardblock-intent-integration | 方案确认 |
| SmartApprovalHook（仅接口） | `safety-smart-approval-hook` | 否 | ConsentResolver（v0.1.4） | 探索中 |

> 跨任务约束：v0.1.5 期内 v0.1.4 yaml 零改动可继续工作；任何 task 不允许改 `core.contracts.ApprovalProvider` 协议形状。

## 推荐推进顺序

```text
批次 1（基础设施）：
  ├─ safety-input-normalize
  └─ safety-mechanism-rule-split          # 可与 input-normalize 并行

批次 2（核心抽象）：
  └─ safety-shell-intent-parser           # 第一批 5 verb：rm / > / cp / mv / dd of=

批次 3（闭环装配）：
  └─ safety-hardblock-intent-integration  # 主入口替换 + Legacy Fallback 接线

批次 4（覆盖扩展）：
  └─ safety-shell-intent-extend           # 第二批 8 verb + 同步标记 deprecated regex

批次 5（v0.2 占位）：
  └─ safety-smart-approval-hook           # 协议占位，不接 LLM
```

批次 1 → 批次 3 完成即满足 v0.1.5 主要收益（用户加目标 1 条规则、加机制 1 个 case）。批次 4 是覆盖率打满。批次 5 在 v0.1.5 内只占位。

## 依赖图

```
                  ┌─────────────────────────┐
                  │ safety-input-normalize  │  纯函数模块
                  └────────────┬────────────┘
                               │
      ┌────────────────────────┼─────────────────────────┐
      │                        ▼                         │
      │         ┌─────────────────────────────┐          │
      │         │ safety-shell-intent-parser  │          │
      │         │   (第一批 5 verb)            │          │
      │         └─────────────┬───────────────┘          │
      │                       │                          │
      │                       ▼                          │
      │  ┌──────────────────────────────────────┐        │
      │  │ safety-hardblock-intent-integration  │ ───────┘
      │  └──────────────────┬───────────────────┘
      │                     │
      │                     ▼
      │   ┌──────────────────────────────────┐
      │   │ safety-shell-intent-extend       │
      │   │  (第二批 8 verb + audit 删表)     │
      │   └──────────────────────────────────┘
      │
      │   ┌─────────────────────────────────┐
      └──▶│ safety-mechanism-rule-split     │  与 input-normalize 并行
          └─────────────────────────────────┘
                │ 产出 DEFAULT_MECHANISM_RULES + DEFAULT_LEGACY_FALLBACK_RULES
                ▼
          (被 hardblock-intent-integration 消费)
```

## 各 task 的 x-req 准入条件

### `safety-input-normalize`

- ✅ ANSI / NFKC / NULL 处理需求已确定（[02-module-breakdown.md § 模块 1](./02-module-breakdown.md#模块-1inputnormalizer)）
- ✅ 与 v0.1.4 `_strip_quote_chars` 行为兼容
- ✅ idempotent 不变量已写入设计原则
- ⚠️ x-req 阶段需补：模糊测试矩阵（fuzz raw bytes ≤ 4KB）+ 性能基线（< 50µs / KB）

### `safety-shell-intent-parser`

- ✅ `ShellIntent` 数据形态已定（[04-data-and-state.md](./04-data-and-state.md)）
- ✅ 第一批 5 verb 与 dispatch 表已定（[02-module-breakdown.md § 模块 2](./02-module-breakdown.md#模块-2shellintentparser)）
- ✅ Unknown 兜底语义已定（[03-core-workflows.md § 3](./03-core-workflows.md#3-unknown--未识别意图的兜底)）
- ⚠️ x-req 阶段需补：parser 单测矩阵（每 verb 至少 5 个正例 + 3 个负例 + 1 个混淆例）

### `safety-mechanism-rule-split`

- ✅ 拆分清单已定（[02-module-breakdown.md § 模块 3](./02-module-breakdown.md#模块-3mechanismrule-表)）
- ✅ `match_mode="intent_verb"` 与 matcher `"VERB:<name>"` 形态已定
- ✅ `DEFAULT_LEGACY_FALLBACK_RULES` 与 `DEFAULT_MECHANISM_RULES` 互斥规则已定
- ⚠️ x-req 阶段需补：迁移脚本（自动从 v0.1.4 表生成两张新表的初始 diff）

### `safety-hardblock-intent-integration`

- ✅ 流水线 4 步已定（[03-core-workflows.md § 1](./03-core-workflows.md#1-主流水线4-步)）
- ✅ fail-safe 异常路径已定（[03-core-workflows.md § 4](./03-core-workflows.md#4-失败模式与-fail-safe)）
- ✅ trace 字段扩展已定（[03-core-workflows.md § 7](./03-core-workflows.md#7-trace-字段一览v015-新增扩展)）
- ⚠️ x-req 阶段需补：v0.1.4 现有 24 项 parametrize 在新流水线下的全通过证据
- ⚠️ x-req 阶段需补：feature flag（默认开启，环境变量可强制走旧路径用于回退演练）

### `safety-shell-intent-extend`

- ✅ 第二批 8 verb 清单已定（tee / sed -i / truncate / find -delete / install / rsync / chmod / chown / mkfs.* / fork-bomb / `--no-preserve-root`）
- ✅ audit 脚本目标输出已定（[02-module-breakdown.md § 模块 5](./02-module-breakdown.md#模块-5legacy-regex-fallback)）
- ⚠️ x-req 阶段需补：每 verb 与对应 v0.1.4 旧 regex 的对照测试（确保新覆盖 ⊇ 旧覆盖）
- ⚠️ x-req 阶段需补：deprecation 标记的执行清单（哪些旧 regex 在 v0.1.6 删）

### `safety-smart-approval-hook`

- ✅ 协议形状已定（[02-module-breakdown.md § 模块 6](./02-module-breakdown.md#模块-6smartapprovalhook)）
- ✅ 不可覆盖 hard_block 的不变量已定
- ⚠️ 当前仅占位，不进 x-req；v0.2 与 sandbox-runtime 一起升级
- ⚠️ 未来准入条件：LLM 接入策略（model 选型、超时、fail-closed 策略）

## 与 v0.1.4 任务的依赖关系

| v0.1.4 任务 | v0.1.5 何时依赖 | 说明 |
|---|---|---|
| `safety-hard-block` | 全程依赖 | parser 仅替换其内部 `_match_command` |
| `safety-boundary-resolver` | 不依赖 | shell 通路不消费 boundary |
| `safety-consent-resolver` | hook 占位时依赖协议 | SmartApprovalHook 仅在 ConsentResolver 内挂位 |
| `safety-trust-resolver` | 不依赖 | hard_block 不消费 trust |
| `safety-decision-engine` | 不依赖（装配层不动） | DecisionEngine 仍按既有顺序调 hard_block |
| `safety-decision-trace` | 增量扩展 trace | v0.1.5 加新可选字段，旧 key 不动 |
| `safety-grant-store` | 完全不依赖 | hard_block 永远不查 grant |

## 验收标准（v0.1.5 整体出口）

完成下列条件视为 v0.1.5 可发布：

1. **零回归**：v0.1.4 所有现有 `tests/unit/test_safety_hard_block_guard.py`（含 24 项 parametrize）全绿；
2. **抽象成立**：把"保护一个新目录 `notdeltest_v015/`"的全部测试代价压到 ≤ 1 条 sensitive_paths 配置 + 0 行 guard 测试新增；
3. **可观测**：每条 hard_block 决策的 trace 含 `match_source` 之一（`sensitive_path` / `mechanism_rule` / `legacy_regex`）；
4. **可审计**：audit 脚本能列出最近 N 天里仅靠 `legacy_regex_fallback=true` 命中的规则集合；
5. **fail-safe**：注入 parser 异常 / normalizer 异常的演练用例触发 `hard_block` + `failure_reason`，无 silent allow；
6. **协议稳定**：`core.contracts.ApprovalProvider` 协议字段不变；CLI / tools / host 接线零改动；
7. **用户兼容**：v0.1.4 yaml 零改动跑通完整 e2e（`test_e2e/test_safety_decision_engine.py` 等）。

## 后续 v0.1.6 / v0.2 路线（不在本期 task 列表）

- v0.1.6：
  - 删除被 audit 标记可删的 legacy regex；
  - 重写用户文档，从"10 条 regex 保护一个目录"改为"1 条 sensitive_paths"；
  - parser 第三批 verb（git 子命令家族 / docker rm / kubectl delete）。
- v0.2：
  - `safety-sandbox-runtime`：docker / podman / colima 后端 + bind-mount `:ro` 凭据；
  - `safety-smart-approval`（升级 hook）：接 LLM，参考 hermes `_smart_approve` 的 prompt 形态；
  - `safety-audit-pipeline`：把 audit 脚本接成定时任务，自动产 deprecation issue。
