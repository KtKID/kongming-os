# Task Map

## 任务一览

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|---|---|---|---|---|
| HardBlockGuard | `safety-hard-block` | 是 | 无 | 可进入 x-req |
| BoundaryResolver | `safety-boundary-resolver` | 是 | 无 | 可进入 x-req |
| ConsentResolver | `safety-consent-resolver` | 是 | BoundaryResolver | 可进入 x-req |
| TrustResolver | `safety-trust-resolver` | 是 | BoundaryResolver | 可进入 x-req |
| SafetyDecisionEngine | `safety-decision-engine` | 是 | HardBlock / Boundary / Consent / Trust | 可进入 x-req |
| DecisionTrace | `safety-decision-trace` | 是 | SafetyDecisionEngine | 可进入 x-req |
| GrantStore | `safety-grant-store` | 否 | ConsentResolver / TrustResolver | 探索中 |
| ConfigSelfProtection | 并入 `safety-hard-block` + `safety-consent-resolver` | 否 | 无 | 方案确认 |

## 推荐推进顺序

```text
批次 1（安全闭环）：
  ├─ safety-hard-block
  ├─ safety-boundary-resolver
  └─ safety-consent-resolver

批次 2（默认体验）：
  ├─ safety-trust-resolver
  └─ safety-decision-engine

批次 3（观测与复盘）：
  └─ safety-decision-trace

批次 4（授权沉淀）：
  └─ safety-grant-store
```

批次 1 + 批次 2 完成即可形成可用版本：

- secrets / destructive 直接拒绝
- tracked 文件与工作目录静默放行
- 越界写、敏感读统一 ask

## 各 task 的 x-req 准入条件

### `safety-hard-block`

- ✅ `hard_deny_commands` 表已作为核心规则表确定
- ✅ secrets 路径清单已定
- ✅ destructive command 清单已定
- ✅ self-escalation 目标已定
- ⚠️ 需在 x-req 阶段补充 command segment 解析策略与用例矩阵

### `safety-boundary-resolver`

- ✅ `sensitive_paths` 表已作为路径规则主表确定
- ✅ `trusted / approval / blocked zone` 已定
- ✅ tracked 文件与 `.kongming/work|tmp` 的 trusted 范围已定
- ✅ `.env*` / `AGENTS.md` / `CLAUDE.md` 的 approval 范围已定
- ⚠️ 需在 x-req 阶段补充非 git 场景 fallback 与性能基线

### `safety-consent-resolver`

- ✅ `approval_required_commands` 表已作为命令审批主表确定
- ✅ `standard` / `elevated` 两档已定
- ✅ `ConfigSelfProtection` 已能归并到 `elevated`
- ⚠️ 需在 x-req 阶段定义审批 UI 的结构化返回值

### `safety-trust-resolver`

- ✅ 三类 trust source 已定：`intrinsic / session / config`
- ✅ `HardBlock` 不能被 trust 覆盖的原则已定
- ⚠️ 需在 x-req 阶段确定 session grant 的 capability + path prefix 粒度

### `safety-decision-engine`

- ✅ 主链路顺序已定：`HardBlock → SilentAllow → ExplicitConsent`
- ✅ 旧 `ApprovalProvider` 外部协议保持不变
- ⚠️ 需在 x-req 阶段列出回归矩阵和兼容字段保留策略

### `safety-decision-trace`

- ✅ 新事件种类已定
- ✅ `decision_class` / `decision_source` schema 已定
- ⚠️ 需在 x-req 阶段补充 sink 协作验证

### `safety-grant-store`

阻塞项：

1. **审批结果协议未定**
   - 当前 `InteractiveApproval` 只能表达 approve/reject
   - session/persist grant 需要结构化 action
2. **配置写回策略未定**
   - 是否允许 agent 自动写回 config
   - YAML 保注释写回采用什么库
3. **命令授权模型需收敛**
   - path prefix 型 grant 适合文件
   - shell command 更适合 action/profile 级授权

完成上述阻塞项后再进入 x-req。

## 当前建议

1. 先把三张规则表补完整：`hard_deny_commands`、`approval_required_commands`、`sensitive_paths`。
2. 再做 `HardBlock / Boundary / Consent`，这是安全收益和体验收益都最高的组合。
3. `GrantStore` 继续停留方案层，等审批交互协议稳定后再进入 x-req。
4. 方案文档保存路径：`docs/safety-scope-v0.1.4/`
