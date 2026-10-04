# 核心流程

## 主决策链

```text
ApprovalRequest
  │
  ├─ tool_name / capability / path_or_command / args
  │
  ▼
HardBlockGuard
  ├─ 命中 secrets / destructive / self-escalation
  └─ rejected (decision_class=hard_block)
  │
  ▼
BoundaryResolver
  ├─ blocked zone
  ├─ approval zone
  └─ trusted zone
  │
  ▼
TrustResolver
  ├─ intrinsic evidence  → approved (decision_source=intrinsic)
  ├─ session grant       → approved (decision_source=session)
  ├─ config grant        → approved (decision_source=config)
  └─ miss
  │
  ▼
ConsentResolver
  ├─ standard ask  → InteractiveApproval
  ├─ elevated ask  → InteractiveApproval (typed confirm)
  └─ rejected / approved
```

短路语义：

- `HardBlockGuard` 命中后直接结束。
- `TrustResolver` 只在 `BoundaryResolver` 返回 `trusted zone` 或 `approval zone` 且存在 grant 时生效。
- `ConsentResolver` 是唯一的新授权入口。

## 三张规则表

决策顺序：

1. 先看 `hard_deny_commands`
2. 再看 `sensitive_paths`
3. 再看 `BoundaryResolver + TrustResolver`
4. 最后看 `approval_required_commands`

这四步的职责分工很稳定：

- `hard_deny_commands` 解决“这条命令本身就不能执行”
- `sensitive_paths` 解决“这个目标路径的 read/write 风险如何分流”
- `BoundaryResolver + TrustResolver` 解决“默认边界内能否静默做”
- `approval_required_commands` 解决“命令动作本身是否需要 ask”

### 1. `hard_deny_commands`

回答“哪些命令片段直接拒绝”。

适用场景：

- 破坏宿主
- 擦除或重写关键数据
- 修改安全边界本身
- 明确自我提权

匹配逻辑：

- 按 command segment 匹配，不能按整条 shell 字符串粗糙判断
- 规则只表达 `effect=block`
- 命中后直接结束，不进入 ask

示例：

- `rm -rf /`
- `mkfs.*`
- `dd if=... of=/dev/...`
- `chmod -R 000 /`
- `curl ... | sh` 且目标是系统安装脚本

### 2. `sensitive_paths`

回答“路径目标在当前操作下应该 block、ask，还是 allow”。

适用场景：

- 同一条路径对 `read` 和 `write` 风险不同
- 文件工具和命令工具需要共享同一份路径风险判断
- 配置文件、自身规则文件、凭据文件需要统一建模

匹配逻辑：

- 路径规则必须带 `ops = read | write | exec`
- 路径规则必须带 `effect = block | elevated | allow`
- `BoundaryResolver` 先消费这张表，再补 git/workdir 推导出的默认边界

示例：

- `~/.ssh/` + `read|write` → `block`
- `~/.gnupg/` + `read|write` → `block`
- `~/.aws/config` + `read|write` → `elevated`
- `.env*` + `read|write` → `elevated`
- `AGENTS.md` + `write` → `elevated`
- `<project>/.kongming/work/` + `write` → `allow`

### 3. BoundaryResolver

回答“默认边界在哪”。

- `trusted zone`
  - git tracked 文件
  - `<project>/.kongming/work/`
  - `<project>/.kongming/tmp/`
- `approval zone`
  - untracked 新文件
  - 工作区外写入
  - `sensitive_paths` 中 `effect=elevated` 的目标
- `blocked zone`
  - `sensitive_paths` 中 `effect=block` 的目标

### 4. `approval_required_commands`

回答“哪些命令动作需要 ask，以及 ask 的强度”。

适用场景：

- 命令动作超出默认静默边界
- 命令自身合理，但影响范围广
- 文件路径本身安全，动作 profile 仍然需要人工确认

匹配逻辑：

- 每条规则都带 `severity = standard | elevated`
- 只有前面没被 `hard_deny_commands` 或 `sensitive_paths=block` 命中时才会执行
- 命中后直接进入 `ConsentResolver`

- `standard`
  - 工作区外写入
  - `git push`
  - `tests/`、`docs/` 首次新建文件对应的 shell 命令
- `elevated`
  - `.kongming/config*`
  - `.kongming/safety/`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `pyproject.toml [tool.kongming.safety]`
  - 申请扩大边界的命令

### 5. Silent allow 的来源

静默放行来自两种来源：

- `sensitive_paths` 明确给出的 `allow`
- `BoundaryResolver + TrustResolver` 推导出的 intrinsic / session / config 信任

## 典型场景

### 场景 1：修改 tracked 文件

请求：`Edit src/cli/main.py`

```text
HardBlockGuard      → miss
BoundaryResolver    → trusted zone
TrustResolver       → intrinsic 命中（tracked file）
Decision            → silent allow
Trace               → decision_class=silent_allow, decision_source=intrinsic
```

### 场景 2：读取项目 `.env`

请求：`Read .env.production`

```text
HardBlockGuard      → miss
SensitivePaths      → .env* + read 命中 elevated
BoundaryResolver    → approval zone
TrustResolver       → miss
ConsentResolver     → elevated ask
Decision            → explicit consent
Trace               → decision_class=explicit_consent, decision_source=elevated
```

### 场景 3：创建 `tests/` 下新文件

请求：`Write tests/integration/test_foo.py`

```text
HardBlockGuard      → miss
SensitivePaths      → miss
BoundaryResolver    → approval zone（untracked new file）
TrustResolver       → miss
ConsentResolver     → standard ask
用户选择本会话允许
GrantStore          → 记录 (file_write, tests/integration/, session)
后续同目录写入      → TrustResolver 命中 session grant
```

### 场景 4：修改 `.kongming/config.yaml`

请求：`Edit .kongming/config.yaml`

```text
HardBlockGuard      → 若改动效果是扩大边界到 / 或 HOME，直接拒绝
SensitivePaths      → .kongming/config* + write 命中 elevated
BoundaryResolver    → approval zone
TrustResolver       → miss
ConsentResolver     → elevated ask
Decision            → 只有 typed confirm 才能通过
```

### 场景 5：命令中夹带破坏动作

请求：`pytest tests/ && rm -rf /`

```text
HardBlockGuard      → destructive command segment 命中
Decision            → rejected
Trace               → decision_class=hard_block
```

### 场景 6：`git push origin main`

请求：执行工作区内正常发布命令

```text
HardBlockGuard      → miss
SensitivePaths      → miss
BoundaryResolver    → trusted zone
TrustResolver       → miss（命令 profile 不属于 intrinsic allow）
ApprovalCmdTable    → git push 命中 standard
ConsentResolver     → standard ask
```

## TrustResolver 命中语义

`TrustResolver` 不看“层级”，只看“证据”：

- `intrinsic`
  - tracked 文件
  - `.kongming/work/`
  - `.kongming/tmp/`
- `session`
  - 本会话批准的 `(capability, path_prefix)` grant
- `config`
  - 配置显式写下的低风险 allow 规则

匹配规则：

- 先按 capability 匹配；
- 再按 path prefix 或 action profile 匹配；
- `session/config` grant 都不能覆盖 `HardBlockGuard`。

## 与现有 SafetyGatedApproval 的迁移

```text
v0.1.3
  capability_policy.check()
  → permission_policy.check()
  → interactive approval

v0.1.4
  hard_block_guard()
  → boundary_resolver()
  → trust_resolver()
  → consent_resolver()
  → interactive approval
```

迁移原则：

- 外部仍返回 `ApprovalDecision`
- `metadata.stage` 保留兼容
- 新增 `decision_class` / `decision_source`
