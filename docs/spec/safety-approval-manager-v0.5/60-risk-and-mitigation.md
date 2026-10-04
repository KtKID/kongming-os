# 60 · 风险登记与 mitigation

> 本文档登记本 spec 的所有已知风险 + 每个风险的 mitigation 策略 + 监控指标。
>
> 风险按 **严重度 × 阶段** 二维分类。

---

## 风险登记总表

| # | 风险 | 严重度 | 阶段 | 概率 | 影响范围 |
|---|---|---|---|---|---|
| R1 | 双轨期 contract 漂移 | 🔴 高 | 1-2 | 中 | 用户决策不一致 |
| R2 | v2-inbox 回归（306 后端 + 442 前端）| 🔴 高 | 2 | 中 | claude_code 通道功能挂 |
| R3 | SDK can_use_tool sync callback 兼容 | 🔴 高 | 2 | 中 | claude_code 通道完全不可用 |
| R4 | EventSink Protocol 设计不准 | 🟡 中 | 1 / 5 | 低 | 阶段 5 重审时改动量增加 |
| R5 | rules schema 跨通道命名冲突 | 🟡 中 | 5 | 中 | 用户配置不能加载 |
| R6 | 协议帧 v0.5 与 v2-inbox 兼容 | 🟡 中 | 5 | 低 | 老前端读不到新字段 |
| R7 | allow_list → GrantStore 数据迁移 | 🟢 低 | 2 | 0 | 无（allow_list 重启就丢，无历史数据）|
| R8 | 中文 docstring 漏写 | 🟢 低 | 1-5 | 中 | 代码质量；不影响功能 |
| R9 | 单例 manager 跨 thread 死锁 | 🟡 中 | 1-5 | 低 | 阻塞所有审批 |
| R10 | timeout task 内存泄漏 | 🟡 中 | 1 / 5 | 低 | 长跑后 OOM |
| R11 | 阶段 2 / 3 / 4 并行开发协调失败 | 🟡 中 | 2-4 | 中 | 合并冲突 / 重复改 manager |
| R12 | 协议帧 supportedActions 前端 hardcode 假设 | 🟡 中 | 5 | 中 | 升级协议时旧前端按钮不显示 |

---

## R1 · 双轨期 contract 漂移 🔴

### 现象
阶段 1-2 双轨期间，老 ApprovalBridge 和新 manager 对同一审批输入产生不同决策（例如倒计时行为微差异 / audit log 字段差异 / GrantStore 写入条件差异）。

### 影响
- 用户在 claude_code（老路径）和 generic_chat（新路径）下看到不一致 UX
- audit log 跨通道对比时数据漂移
- 阶段 2 完成时回归测试可能"看似过了"实际行为变了

### Mitigation
1. **共享 inbox_helpers**：to_inbox_payload + emit_remove_safe 必须由 manager 和 ApprovalBridge 都调（阶段 1 准备；阶段 2 ApprovalBridge 改 ~3 行调用）
2. **等价性测试**（阶段 2 完成必跑）：
   ```python
   # tests/integration/web/test_claude_code_v0.5_equivalence.py
   # 同样 input，对比老路径 vs 新路径输出 PermissionResult 字段是否完全一致
   ```
3. **audit log diff 工具**（阶段 2-5 期间）：每天跑 `kongming audit diff --channel claude_code --days 1` 比较新老路径产生的 audit log，发现漂移立即停止 rollout
4. **canary**：阶段 2 上线先只针对特定 thread / cwd 启用 manager 路径，全量切之前观察 24h

### 监控指标
- audit log 中同 request_id 不同路径的字段 diff 数量（阶段 2 期间）
- 用户报"决策跟预期不一致"工单数量

---

## R2 · v2-inbox 回归（306 后端 + 442 前端）🔴

### 现象
阶段 2 改 ApprovalBridge 后，v2-inbox 既有测试套（306 后端 + 442 前端）部分挂。

### 影响
- claude_code 通道完全不可用
- 阻塞所有 web 用户

### Mitigation
1. **阶段 2 PR 必须 100% 通过现有测试套**（不允许 skip / disable 任何测试）
2. **CI 加门禁**：v2-inbox 测试集独立 job，强制 required
3. **测试不修改原则**：阶段 2 只改源码，不改测试代码；如果测试因实现变化挂，要么修源码让测试过，要么明确"测试本身是 over-asserting，分阶段重构"（极少数）
4. **阶段 1 不动 v2-inbox 任何代码**（防御性，让阶段 1 完全 0 风险）

### 监控指标
- 阶段 2 PR 期间每次推送的测试通过率
- 上线后 24h 内 web claude_code 通道 error log 数量

---

## R3 · SDK can_use_tool sync callback 兼容 🔴

### 现象
Claude SDK 的 `can_use_tool` 是同步回调函数，必须立即（同步上下文内）返回 PermissionResult。manager 是 async 设计。阶段 2 改 ApprovalBridge 时如果 async 桥接没做好，SDK 会卡死。

### 影响
- claude_code 通道整个 hang
- 用户 web chat 跟 claude agent 聊一收到 tool_use 就卡住，无任何错误提示

### Mitigation
1. **保留 ApprovalBridge 的 Future 桥接**（阶段 2 thin wrapper 内部仍持 Future）：
   ```python
   async def can_use_tool(...) -> PermissionResultAllow | PermissionResultDeny:
       """SDK 同步回调，但 SDK 内部其实是 await（asyncio loop 跑着）。
       thin wrapper 内 await manager.request(...)。
       """
       decision = await manager.request(...)
       return decision.to_permission_result()
   ```
2. **阶段 2 集成测验证 SDK 完整 round-trip**：用真实 Claude SDK fake harness 跑一次 tool_use → can_use_tool → user resolve → 工具继续
3. **回滚预案极简**：ApprovalBridge.can_use_tool 单文件改动，可一行 revert

### 监控指标
- SDK round-trip 平均延迟（不应比阶段 1 前增加）
- 用户报"agent 卡住没反应"工单

---

## R4 · EventSink Protocol 设计不准 🟡

### 现象
阶段 1 把 ApprovalEventSink Protocol 放 manager 内部（不抽 core.contracts）。阶段 5 想抽到 core 时发现接口签名不对（缺字段 / 字段类型不一致 / 缺方法）。

### 影响
- 阶段 5 接口重构工作量增加（要改所有 EventSink 实现）

### Mitigation
1. **阶段 1 接口设计审 reviewer 必查**：dispatch opus reviewer 看 emit_approval_required / emit_approval_removed 签名是否满足所有可预见通道
2. **阶段 1 接口预留扩展**：所有方法用 keyword-only args（`def emit(*, pending, ...)`），未来加字段不破坏调用方
3. **阶段 5 抽 core 时按需重构**：不强求一次抽完，可分两步（先抽稳定字段，后补未稳定字段）

### 监控指标
- 阶段 1-4 期间 EventSink 接口被 PR 改动次数（应≤1）

---

## R5 · rules schema 跨通道命名冲突 🟡

### 现象
阶段 5 上 v0.5 完整 schema 后，用户写的 rules.yaml 因为命名歧义（如同样 pattern 在多通道下不同 action）加载失败。

### 影响
- 用户配置不能生效
- v0.5 上线后部分用户 fallback 到 default rules（功能降级）

### Mitigation
1. **阶段 5 提供 schema 校验工具**：`make rules-validate` 加载前校验
2. **提供 default 模板**：`kongming-rules.yaml.example` 含全 5 通道完整模板
3. **加载失败时友好报错**：明确指出哪行哪字段 + 建议改法
4. **向后兼容**：旧 `src/web/approvals/auto/default_rules.yaml` 阶段 5 仍能加载（fallback path）

### 监控指标
- 阶段 5 发布后用户报"rules.yaml 加载失败"工单数量

---

## R6 · 协议帧 v0.5 与 v2-inbox 兼容 🟡

### 现象
阶段 5 服务端开始发 v0.5 新字段（supportedActions / autoDecisionKind / severity）。如果前端没升级，按钮不显示 / 渲染错误。

### Mitigation
1. **新字段必须 optional**：前端默认值兜底（`supportedActions ?? ["accept_once", "accept_for_session", "reject"]`）
2. **阶段 5 PR 含前端升级**：服务端 + 前端同时 release，不要分两次
3. **兼容字段保留**：autoApproveAtMs / autoRejectAtMs / blockedByRule / isElevated 阶段 5 后仍发，旧前端继续读老字段
4. **协议版本 handshake**（阶段 5 引入）：服务端发 `approval.protocol.version` 帧，前端按版本号自适应

### 监控指标
- 阶段 5 发布后浏览器 console 中 inbox 帧解析错误日志

---

## R7 · allow_list → GrantStore 数据迁移 🟢

### 现象
ApprovalBridge._allow_list 是 per-process 内存 list，重启就丢。阶段 2 改成走 GrantStore。

### 影响
**0 影响**——allow_list 是临时状态，用户无任何持久化数据需要迁移。

### Mitigation
N/A（无需迁移）

### 监控指标
- 阶段 2 发布后用户报"allow_list 失效"工单数量 = 0（用户感知不到，因为本来重启也丢）

---

## R8 · 中文 docstring 漏写 🟢

### 现象
新建 / 改动函数没写中文 docstring。代码质量下降，但不影响功能。

### Mitigation
1. **每个 dev-checklist 项都标 "中文 docstring 强制"**
2. **pre-commit hook 检查**（阶段 5 加）：
   ```yaml
   # .pre-commit-config.yaml
   - id: chinese-docstring-check
     name: check 中文 docstring
     entry: bin/check-chinese-docstring
     files: ^src/safety/.*\.py$
   ```
3. **R3 reviewer 必查**：x-qa-gate R3 reviewer 检查每个新函数有中文 docstring（明确写进 R3 prompt）

### 监控指标
- pre-commit hook 拦下"无中文 docstring"提交的次数

---

## R9 · 单例 manager 跨 thread 死锁 🟡

### 现象
ApprovalManager 单例持 `_lock: asyncio.Lock`。如果某条 pending 在 lock 内 await future（错误用法），所有审批 hang。

### Mitigation
1. **lock 内只做 dict 增删 + subscriber 拷贝**（不 await future / 不 await IO）：
   ```python
   async with self._lock:
       self._pending[req_id] = pending
       sinks = list(self._event_sinks)  # 拷贝快照
   # lock 外做 await
   await asyncio.gather(*(s.emit_approval_required(pending=pending) for s in sinks))
   future = pending.future
   result = await future  # ← lock 外！
   ```
2. **阶段 1 设计 review 检查所有 lock 内代码**
3. **集成测验证并发 1000 个 pending**

### 监控指标
- 阶段 1 上线后审批延迟 P99（应 < 100ms 不含用户决策时间）

---

## R10 · timeout task 内存泄漏 🟡

### 现象
manager 内 `_timeout_tasks: dict[req_id, asyncio.Task]` 如果不及时清理，pending future done 后 task 仍持引用，长跑 OOM。

### Mitigation
1. **每个 pending 退出路径都清 timeout task**：
   ```python
   # resolve / cancel / timeout 三路径都必须 pop _timeout_tasks
   finally:
       task = self._timeout_tasks.pop(req_id, None)
       if task and not task.done():
           task.cancel()
   ```
2. **加 manager.pending_count + manager.timeout_task_count 监控接口**
3. **集成测验证**：跑 1000 次 request 后断言 pending_count == 0 + timeout_task_count == 0

### 监控指标
- 长跑 24h 后 manager.pending_count 不应增长 > 0

---

## R11 · 阶段 2 / 3 / 4 并行开发协调失败 🟡

### 现象
不同 contributor 同时改 manager 内部代码（如 register_event_sink 时机 / rules 注入方式），导致合并冲突 / 重复改。

### Mitigation
1. **阶段 1 PR 把 manager 公开 API 定死**（request / resolve / cancel / register_event_sink 签名）
2. **阶段 2/3/4 各自只动各自的通道 adapter + manager 内部 channel 分支**（不改 manager 公开接口）
3. **协调 issue**：开 GitHub issue 列每个 contributor 负责的阶段；改 manager 公开接口前要 issue 内沟通

### 监控指标
- 阶段 2-4 期间 manager 公开接口被改动次数（应 = 0）

---

## R12 · 协议帧 supportedActions 前端 hardcode 假设 🟡

### 现象
阶段 5 前端 Card 改成按 `supportedActions` 渲染按钮，但写代码时前端开发者可能 hardcode 假设（如 `if (supportedActions.includes("xxx"))` 漏 case）。

### Mitigation
1. **阶段 5 前端测试**：所有 4 种 supportedActions 组合都有测试
2. **schema 校验**：服务端发 supportedActions 时校验值是预定义 enum
3. **前端 fallback 默认完整 4 按钮**：`supportedActions ?? ["accept_once", "accept_for_session", "accept_persistent", "reject"]`

### 监控指标
- 阶段 5 发布后用户报"按钮少了 / 多了"工单数量

---

## 监控仪表盘（阶段 5 落地后）

建议加 `kongming admin dashboard` 命令展示：

```
[ApprovalManager]
pending_count: 3       <- 应稳态接近 0
timeout_task_count: 3  <- 应等于 pending_count
total_requests_24h: 142
avg_decision_latency_ms: 245   <- 不含用户思考时间
audit_log_diff_count: 0  <- 双轨期老路径 vs 新路径决策差异
```

---

## 风险接受声明

以下风险经用户拍板接受，不阻塞 spec 通过：

1. ✅ 双轨期 1-3 周（阶段 1 完到阶段 2 完）期间 inbox UI 仅服务 generic_chat web
2. ✅ 协议帧 v0.5 阶段 5 才落地；阶段 1-4 字段半数 null 由前端兜底
3. ✅ rules.yaml 完整 schema 阶段 5 才落地；阶段 1-4 ApprovalRules 用 hardcode
4. ✅ CLI 通道阶段 4 才接入；阶段 1-3 内 CLI 用户走老 prompt 路径

---

## 下一步阅读

- [90-task-map.md](90-task-map.md) — 5 task 名 + 状态 + 依赖
- [50-migration-plan.md](50-migration-plan.md) — 每阶段范围与回滚预案
