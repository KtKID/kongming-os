# 40 · 协议帧 v0.5 演进

> 本文档定义 v0.5 协议帧（向 v2-inbox 的 `approval.inbox.*` 4 帧的扩展），保证：
> - v2-inbox 客户端（已发布）继续工作（向后兼容）
> - generic_chat 等新通道字段语义清晰，不再有"v1 字段半数 null"问题
> - 三态 resolve（ACCEPT_ONCE / ACCEPT_FOR_SESSION / REJECT）有协议表达
>
> ⚠️ **阶段 1-4 不上协议演进**；仅在阶段 5 落地（v0.5 协议 release）。
> 阶段 1 generic_chat 仍走 v2-inbox 帧 + 字段半数 null（前端 Card 已兜底）。

---

## 1. 演进原则

| 原则 | 落地 |
|---|---|
| 向后兼容 | v0.5 帧字段在 v2-inbox 帧基础上**追加**，不重命名 / 不删除 |
| 通道无关字段优先 | 把当前 claude_code specific 字段（autoApproveAtMs 等）改成通道通用语义 |
| 三态 resolve 显式 | resolve 帧加 `decision_kind` 字段表达三态 |
| 旧客户端忽略新字段 | v2-inbox 前端遇到未知字段静默丢；不会因为 v0.5 新字段而崩 |
| 字段命名规范统一 | camelCase（与现有 v2-inbox 帧一致）|

---

## 2. v0.5 vs v2-inbox 协议帧对比

### S2C: `approval.inbox.add`

| 字段 | v2-inbox | v0.5 演进 | 备注 |
|---|---|---|---|
| `kind` | `"approval.inbox.add"` | 不变 | broadcaster 自动补 |
| `requestId` | string | 不变 | 路由 key |
| `threadId` | string | 不变 | 通道内 thread 标识 |
| `toolName` | string | 不变 | 工具名 |
| `toolInput` | object | 不变 | 工具参数 |
| `autoApproveAtMs` | int \| null | **重命名 → `autoDecisionAtMs`** | 通道通用：到点自动决策 |
| `autoRejectAtMs` | int \| null | **删除**（合并到 `autoDecisionAtMs` + `autoDecisionKind`）| - |
| - | - | **新增 `autoDecisionKind`**: `"approve"` \| `"reject"` \| null | 标明倒计时方向 |
| `blockedByRule` | string \| null | 不变 | 命中危险规则 ID |
| `isElevated` | bool | 不变 | 严重度 |
| `channel` | string | 不变 | 通道 |
| `cwd` | string | 不变 | 工作目录 |
| `arrivedAtMs` | int | 不变 | 到达后端时间 |
| - | - | **新增 `severity`**: `"standard"` \| `"elevated"` | 显式 severity（替代 isElevated 暗示）|
| - | - | **新增 `supportedActions`**: array | `["accept_once", "accept_for_session", "accept_persistent", "reject"]`；前端按此渲染按钮 |
| - | - | **新增 `matchedRule`**: string \| null | 替代 blockedByRule，含义更宽 |

**向后兼容**：
- v2-inbox 客户端读 `autoApproveAtMs` / `autoRejectAtMs` → 服务端阶段 5 同时发新旧两组字段（旧字段废弃但保留）
- 旧 `blockedByRule` 保留作 alias；新 `matchedRule` 推荐用
- 旧 `isElevated` 保留；新 `severity` 推荐用

### S2C: `approval.inbox.remove`

| 字段 | v2-inbox | v0.5 演进 |
|---|---|---|
| `kind` | `"approval.inbox.remove"` | 不变 |
| `requestId` | string | 不变 |
| `reason` | `"user_decided"` \| `"timeout"` \| `"cancelled"` | 不变 |
| - | - | **新增 `decision`**: object \| null | 用户决策内容（reason="user_decided" 时含），含 `kind: "accept_once" \| "accept_for_session" \| ...` + `rememberEntry?` |

### S2C: `approval.inbox.snapshot`

| 字段 | v2-inbox | v0.5 演进 |
|---|---|---|
| `kind` | `"approval.inbox.snapshot"` | 不变 |
| `items` | array of add payload (without kind) | 不变；item 字段升级到 v0.5 add 字段集 |

### C2S: `approval.inbox.resolve`（**三态**）

| 字段 | v2-inbox | v0.5 演进 |
|---|---|---|
| `kind` | `"approval.inbox.resolve"` | 不变 |
| `threadId` | string | 不变 |
| `requestId` | string | 不变 |
| `allow` | bool | **保留**（兼容 v2-inbox 二态）|
| - | - | **新增 `decisionKind`**: `"accept_once"` \| `"accept_for_session"` \| `"accept_persistent"` \| `"reject"` |
| `message` | string \| null | 不变 |
| `rememberEntry` | string \| null | 不变（仅 claude_code 通道用，写 allow_list 退化语义）|
| - | - | **新增 `rememberScope`**: `"session"` \| `"persistent"` \| null | 通用语义（替代 rememberEntry 字符串隐式表达）|

**前端发帧时**：
- v2-inbox 老前端：发 `{allow, rememberEntry}` 二态 → 后端阶段 5 转成 `decisionKind="accept_once"` 或 `"accept_for_session"`
- v0.5 新前端：发 `{decisionKind, rememberScope}` 三态 + 显式 scope

---

## 3. 三态映射详细规则

### 用户操作 → 前端 → 后端

| 用户点的按钮 | v2-inbox 前端发的帧 | v0.5 前端发的帧 | 后端 ApprovalDecision |
|---|---|---|---|
| 拒绝 | `{allow:false, message:"user denied"}` | `{decisionKind:"reject", message:"user denied"}` | outcome="rejected" |
| 单次同意 | `{allow:true}` | `{decisionKind:"accept_once"}` | outcome="allowed", remember_*=False |
| 本 session 都同意 | `{allow:true, rememberEntry:"<toolName>"}` (claude_code) <br/> 无（generic_chat v0.1 隐藏此按钮） | `{decisionKind:"accept_for_session", rememberScope:"session"}` | outcome="allowed", remember_for_session=True |
| 永久同意（v0.5 新增）| ❌ 不支持 | `{decisionKind:"accept_persistent", rememberScope:"persistent"}` | outcome="allowed", remember_persistent=True |

### 后端 ApprovalDecision → ApprovalAction / PermissionResult

```python
def to_approval_action(decision: ApprovalDecision) -> ApprovalAction:
    """ApprovalDecision → ApprovalAction（兼容 InteractiveApproval / SafetyGatedApproval）。
    
    映射表：
    - outcome=allowed + remember_persistent=True → ACCEPT_PERSIST（v0.5 新；阶段 5 加）
    - outcome=allowed + remember_for_session=True → ACCEPT_FOR_SESSION
    - outcome=allowed + remember_*=False → ACCEPT_ONCE
    - outcome=rejected → REJECT
    """
    ...


def to_permission_result(decision: ApprovalDecision) -> PermissionResult:
    """ApprovalDecision → PermissionResult（兼容 claude_code SDK can_use_tool）。
    
    SDK PermissionResult 只支持 Allow / Deny 二态；ACCEPT_FOR_SESSION / ACCEPT_PERSIST
    在调用前由 manager 自己写 GrantStore，对 SDK 透明返回 Allow。
    """
    ...
```

---

## 4. 通道字段填法（manager 内 InboxEventSink 构造 payload）

### claude_code 通道（阶段 2 接入）

```python
# manager.request(channel="claude_code", ...) 被 ApprovalBridge thin wrapper 调
# InboxEventSink.emit_approval_required(pending) 构造 add payload：

{
    "kind": "approval.inbox.add",
    "requestId": pending.request_id,
    "threadId": pending.thread_id,
    "toolName": pending.tool_name,
    "toolInput": pending.tool_input,
    
    # v2-inbox 兼容字段
    "autoApproveAtMs": pending.auto_approve_at_ms,      # 安全路径有值
    "autoRejectAtMs": pending.auto_reject_at_ms,        # 危险路径有值
    "blockedByRule": pending.matched_rule,
    "isElevated": pending.severity == "elevated",
    
    # v0.5 新字段
    "autoDecisionAtMs": pending.auto_approve_at_ms or pending.auto_reject_at_ms,
    "autoDecisionKind": "approve" if pending.auto_approve_at_ms else ("reject" if pending.auto_reject_at_ms else None),
    "severity": pending.severity,
    "matchedRule": pending.matched_rule,
    "supportedActions": ["accept_once", "accept_for_session", "reject"],
    
    "channel": "claude_code",
    "cwd": pending.cwd,
    "arrivedAtMs": pending.arrived_at_ms,
}
```

### generic_chat 通道（阶段 1 接入）

```python
{
    "kind": "approval.inbox.add",
    "requestId": pending.request_id,
    "threadId": pending.thread_id,
    "toolName": pending.tool_name,
    "toolInput": pending.tool_input,
    
    # v2-inbox 兼容字段（generic_chat 永远 None）
    "autoApproveAtMs": None,
    "autoRejectAtMs": None,
    "blockedByRule": None,
    "isElevated": pending.severity == "elevated",
    
    # v0.5 新字段
    "autoDecisionAtMs": None,
    "autoDecisionKind": None,
    "severity": pending.severity,
    "matchedRule": None,
    
    # 阶段 1 仅 ACCEPT_ONCE / REJECT（前端 Card 按此隐藏第三按钮）
    # 阶段 5 协议 v0.5 落地后可以含 accept_for_session（generic_chat 也支持 GrantStore.put_session）
    "supportedActions": ["accept_once", "reject"],
    
    "channel": "generic_chat",
    "cwd": pending.cwd,
    "arrivedAtMs": pending.arrived_at_ms,
}
```

### cron / evolution 通道（阶段 3 接入）

`auto_allow` 路径**不进 inbox**（rules.classify 直接返回 is_immediate=True）。

只有 `fail_closed` cron task 走 ask 时才发 inbox 帧（极少数情况）。

---

## 5. 前端 Card 渲染逻辑（v0.5 协议落地后）

```typescript
// ApprovalToastCard.tsx v0.5 改造

const supportedActions = item.supportedActions ?? ["accept_once", "accept_for_session", "reject"];  // v2-inbox 兼容默认

return (
  <Card>
    {/* 拒绝按钮永远显示 */}
    {supportedActions.includes("reject") && <Button onClick={() => onReject()}>拒绝</Button>}
    
    {/* 单次同意 */}
    {supportedActions.includes("accept_once") && <Button onClick={() => onAcceptOnce()}>同意一次</Button>}
    
    {/* 本 session 同意（generic_chat 阶段 1 不在 supportedActions 里，自动隐藏）*/}
    {supportedActions.includes("accept_for_session") && (
      <Button onClick={() => onAcceptForSession()}>本 session 同意</Button>
    )}
    
    {/* 永久同意（v0.5 新增；仅在用户启用 GrantStore.persist backend 时） */}
    {supportedActions.includes("accept_persistent") && (
      <Button onClick={() => onAcceptPersistent()}>永久同意</Button>
    )}
  </Card>
);
```

**关键设计**：UI **不再 hardcode channel-specific 渲染逻辑**；服务端通过 `supportedActions` 字段告诉前端"这条审批支持哪些按钮"。

---

## 6. 双轨期协议（阶段 1-4）

阶段 1 generic_chat 接入时，**仍发 v2-inbox 老帧**（不上 v0.5 新字段），但**前端 Card 已经按 channel 渲染按钮**（详见 50-migration-plan stage 1）。

阶段 5 服务端开始发 v0.5 字段；老 v2-inbox 客户端读不到新字段也不崩（前端做了字段防御）。

---

## 7. 协议帧字段约束（兼容性 contract）

| 约束 | 实现 |
|---|---|
| 新字段必须 optional | 前端默认值兜底（如 `supportedActions ?? [...]`）|
| 旧字段不能删（仅废弃）| autoApproveAtMs / autoRejectAtMs / blockedByRule / isElevated 阶段 5 后仍保留发 |
| 旧字段语义不能改 | autoApproveAtMs 仍是"到点自动通过"语义 |
| 新字段命名 camelCase | 与现有 v2-inbox 一致 |
| 字段不能矛盾 | `autoApproveAtMs ≠ null` 与 `autoDecisionKind="reject"` 不能同时（服务端校验）|

---

## 8. 协议版本号

```yaml
# WebSocket 握手帧（阶段 5 引入）
{
    "kind": "approval.protocol.version",
    "version": "v0.5",
    "supportedKinds": [
        "approval.inbox.add",
        "approval.inbox.remove", 
        "approval.inbox.snapshot",
        "approval.inbox.resolve",
        "approval.inbox.cancel"   // v0.5 新增（用户主动撤回未发送）
    ]
}
```

阶段 5 前**不需要协议版本号**——v2-inbox 是 v0.1 隐式版本，v0.5 通过兼容字段做了 backward compat。

---

## 9. 不在本协议演进范围

- 跨进程协议（manager 是 per-process；分布式协议留 v1.0）
- 二进制协议（仍 JSON）
- WebSocket 之外的传输（仅 ws + stdin 两种）
- 国际化（按钮文案）

---

## 下一步阅读

- [20-data-model.md](20-data-model.md) — ApprovalDecision DTO 字段与协议帧映射
- [50-migration-plan.md](50-migration-plan.md) — 阶段 5 协议落地的步骤
