# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|---|---|---|---|---|
| HardBlockGuard | 绝对禁止的路径/命令直接拒绝 | 无 | 方案确认 | 最高优先级 |
| BoundaryResolver | 计算请求落在哪个边界区域 | 无 | 方案确认 | 统一默认作用域 |
| ConsentResolver | 对需要问人的请求给出审批强度 | InteractiveApproval | 方案确认 | 两档 ask |
| TrustResolver | 汇总已有信任证据并做静默放行 | BoundaryResolver / GrantStore | 方案确认 | 三类证据 |
| GrantStore | 存储 session/config grants | config_loader / InteractiveApproval | 探索中 | 交互形态未定 |
| SafetyDecisionEngine | 装配主决策链 | 上述全部 | 方案确认 | 统一替换旧判定 |
| DecisionTrace | 记录决策类别/来源/命中规则 | observability | 方案确认 | 便于复盘 |
| ConfigSelfProtection | 保护 safety/config 行为边界 | HardBlockGuard / ConsentResolver | 方案确认 | 默认规则集子集 |

## 模块详情

### 模块 1：HardBlockGuard

**职责**：对明确不可执行的目标直接返回拒绝，不进入 ask。

**主要消费的规则表**：`hard_deny_commands`、`sensitive_paths(effect=block)`。

**包含范围**：

- secrets 路径：
  - `~/.ssh/`
  - `~/.gnupg/`
  - `~/.aws/credentials`
  - `~/.netrc`
- 系统破坏命令：
  - `rm -rf /`
  - `mkfs.*`
  - `dd if=... of=/dev/...`
  - `chmod -R 000 /`
- 全局 agent 配置与宿主级配置：
  - `~/.kongming/`
- 明确的自我提权入口：
  - 项目内 `.kongming/safety/` 的危险改写
  - 试图扩大默认边界到根目录或 home 目录的配置编辑

**不包含范围**：

- 项目内普通配置的合法调整。
- 工作区内普通命令与文件修改。
- “需要谨慎但仍然允许人工决策”的路径，这类进入 `ConsentResolver`。

**依赖**：无。

**风险与讨论点**：

- 路径匹配必须先 `expanduser + resolve + realpath`。
- 命令匹配需要按 command segment 扫描，防止 `pytest && rm -rf /` 逃逸。
- 自我提权要按“效果”判断，而不是只按文件名判断。

**task 建议**：

- 建议 task 名：`safety-hard-block`
- 是否进入 x-req：是
- 原因：边界明确，收益最高，独立可测。

### 模块 2：BoundaryResolver

**职责**：把每个请求归到 `trusted zone` / `approval zone` / `blocked zone`。

**主要消费的规则表**：`sensitive_paths`。

**包含范围**：

- `trusted zone`
  - git tracked 文件
  - `<project>/.kongming/work/`
  - `<project>/.kongming/tmp/`
  - 配置中声明的低风险 scratch 目录
- `approval zone`
  - 项目内 untracked 新文件
  - 工作区外路径
  - 项目 `.env*`
  - `AGENTS.md` / `CLAUDE.md`
  - `pyproject.toml [tool.kongming.safety]`
- `blocked zone`
  - `HardBlockGuard` 命中的区域

**不包含范围**：

- 不做用户审批。
- 不做 session/config grant 存储。
- 不自行放行命令。

**依赖**：git CLI、`pathlib`。

**风险与讨论点**：

- `tests/`、`docs/` 下的新文件应落 `approval zone`，避免默认静默放大。
- 非 git 项目要有稳定 fallback：只信任 `.kongming/work/` 和 `.kongming/tmp/`。
- 读取与写入必须分开建模；敏感读取不能借“read 全开”漏过。

**task 建议**：

- 建议 task 名：`safety-boundary-resolver`
- 是否进入 x-req：是
- 原因：它决定默认体验，是后续模块的共同输入。

### 模块 3：ConsentResolver

**职责**：对需要人决策的请求给出 `standard` 或 `elevated` 审批。

**主要消费的规则表**：`approval_required_commands`、`sensitive_paths(effect=elevated)`。

**包含范围**：

- `standard ask`
  - 工作区外写入
  - untracked 新文件首次创建
  - `git push`
  - `git reset --hard`
- `elevated ask`
  - `.kongming/config*`
  - `.kongming/safety/`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.env*`
  - `pyproject.toml [tool.kongming.safety]`
  - 敏感读取（如 `~/.aws/config`、`~/.docker/config.json`）

**不包含范围**：

- 不直接缓存授权。
- 不定义工作区边界。
- 不处理绝对拒绝。

**依赖**：`InteractiveApproval`。

**风险与讨论点**：

- 当前 `InteractiveApproval` 只返回 `bool`，不足以表达 `session grant` 和 `persist grant`。
- `elevated` 需要 typed confirm 或等价高摩擦交互。
- `standard` / `elevated` 的 UI 文案需要稳定区分“影响范围”和“授权持续时间”。

**task 建议**：

- 建议 task 名：`safety-consent-resolver`
- 是否进入 x-req：是
- 原因：规则清晰，只受审批交互协议影响。

### 模块 4：TrustResolver

**职责**：在不新增授权的前提下，消费已有信任证据并返回静默放行。

**包含范围**：

- `intrinsic`：tracked 文件、显式工作目录、确定安全的本地 scratch。
- `session`：本会话用户批准过的 grant。
- `config`：配置文件显式声明的静默规则。

**不包含范围**：

- 不负责创建 grant。
- 不覆盖 `HardBlockGuard`。
- 不做边界分类。

**依赖**：`BoundaryResolver`、`GrantStore`。

**风险与讨论点**：

- `intrinsic` 证据必须窄，tracked 文件比目录白名单更稳。
- `session` grant 的匹配粒度要限制在 capability + path prefix。
- `config` grant 不能表达“任意命令前缀”这种过宽授权。

**task 建议**：

- 建议 task 名：`safety-trust-resolver`
- 是否进入 x-req：是
- 原因：规则模型稳定，实现机械。

### 模块 5：GrantStore

**职责**：承载 session/config grant 的读写、匹配和失效。

**包含范围**：

- `session grants`
  - `(capability, path_prefix, scope=session)`
  - 生命周期到 session 结束
- `config grants`
  - `allow_writes`
  - `allow_tools_silent`
  - `allow_bash_patterns` 的收敛版替代

**不包含范围**：

- 不持久化完整审批历史。
- 不直接参与 UI。
- 不定义 `intrinsic` 信任证据。

**依赖**：`config_loader`、`InteractiveApproval`。

**风险与讨论点**：

- 当前 CLI 审批协议没有 `acceptForSession` / `acceptPersist` 结构化返回值。
- YAML 写回策略需要保留注释与顺序。
- `allow_bash_patterns` 需要收敛成 action/profile 级授权，否则过宽。

**task 建议**：

- 建议 task 名：`safety-grant-store`
- 是否进入 x-req：否
- 原因：交互协议和配置写回都未定型。

### 模块 6：SafetyDecisionEngine

**职责**：装配 `HardBlock → SilentAllow → ExplicitConsent` 的主链路。

**包含范围**：

- 固定顺序：
  1. `HardBlockGuard`
  2. `BoundaryResolver`
  3. `TrustResolver`
  4. `ConsentResolver`
- 对外仍以 `ApprovalProvider` 返回 `ApprovalDecision`
- 统一附加 `decision_class` / `decision_source`

**不包含范围**：

- 不改 `core.contracts.ApprovalProvider`
- 不改 `tools/` / `host/` / `cli/` 的接线方式

**依赖**：上述 guards / resolvers。

**风险与讨论点**：

- 旧 `stage=capability|permission|approval` 字段需要兼容一段时间。
- engine 本身不应再携带业务规则，规则应下沉到各 resolver。

**task 建议**：

- 建议 task 名：`safety-decision-engine`
- 是否进入 x-req：是
- 原因：是整体落地的装配层。

### 模块 7：DecisionTrace

**职责**：记录每次决策的类别、来源、命中证据。

**包含范围**：

- 关键字段：
  - `decision_class`
  - `decision_source`
  - `matched_rule`
  - `reason`
  - `tool_name`
  - `path_or_command`
- 关键事件：
  - `tool.denied`
  - `tool.approval_required`
  - `tool.silently_allowed`

**不包含范围**：

- 不做远端推送。
- 不做聚合分析。

**依赖**：`observability`。

**风险与讨论点**：

- T5 风格的 read 静默日志仍要受采样控制。
- `session` grant 命中必须打点，便于追溯“授权扩大”。

**task 建议**：

- 建议 task 名：`safety-decision-trace`
- 是否进入 x-req：是
- 原因：字段 schema 已稳定。

### 模块 8：ConfigSelfProtection

**职责**：防止 LLM 通过修改 safety/config 规则扩大自身权限。

**包含范围**：

- 保护对象：
  - `<project>/.kongming/config.yaml|yml|json|toml`
  - `<project>/.kongming/safety/`
  - `<project>/AGENTS.md`
  - `<project>/CLAUDE.md`
  - `<project>/pyproject.toml` 的 `[tool.kongming.safety]` 段
- 处理方式：
  - 明确提权效果的目标进 `HardBlock`
  - 合法但高风险的目标进 `elevated ask`

**不包含范围**：

- 不扩展到第三方 agent 配置目录。
- 不独立提供审批 UI。

**依赖**：`HardBlockGuard`、`ConsentResolver`。

**风险与讨论点**：

- `pyproject.toml` 需要段级定位，不能整文件一刀切。
- `.kongming/memory/` 不应被误伤到 elevated。

**task 建议**：

- 建议 task 名：随 `safety-hard-block` 和 `safety-consent-resolver` 一起落
- 是否进入 x-req：与对应模块同批
- 原因：它是默认规则集，不应单独拆成孤立实现。
