# 数据与状态

## DecisionClass / DecisionSource

```python
from enum import Enum


class DecisionClass(str, Enum):
    HARD_BLOCK = "hard_block"
    SILENT_ALLOW = "silent_allow"
    EXPLICIT_CONSENT = "explicit_consent"


class DecisionSource(str, Enum):
    INTRINSIC = "intrinsic"
    SESSION = "session"
    CONFIG = "config"
    STANDARD = "standard"
    ELEVATED = "elevated"
```

## BoundaryZone

```python
class BoundaryZone(str, Enum):
    TRUSTED = "trusted"
    APPROVAL = "approval"
    BLOCKED = "blocked"
```

## BoundaryKind / BoundaryScope

```python
class BoundaryKind(str, Enum):
    HOST = "host"
    SANDBOX = "sandbox"


class BoundaryScope(str, Enum):
    ANY = "any"
    HOST = "host"
    SANDBOX = "sandbox"
```

## SafetyRule

统一表达路径和命令规则。

```python
@dataclass(frozen=True)
class SafetyRule:
    name: str
    target: Literal["path", "command", "toml_section"]
    matcher: str
    ops: frozenset[Literal["read", "write", "exec"]]
    effect: Literal["block", "standard", "elevated", "allow"]
    reason: str
```

## 三张规则表的数据形态

### `hard_deny_commands`

适用场景：宿主破坏、数据擦除、自我提权、边界扩张。  
运行时逻辑：按 command segment 匹配，命中即 `decision_class=hard_block`。

```python
@dataclass(frozen=True)
class HardDenyCommand:
    name: str
    matcher: str  # regex or action profile id
    match_mode: Literal["segment_regex", "profile"]
    boundary_scope: BoundaryScope
    reason: str
```

### `approval_required_commands`

适用场景：命令动作合理，但影响面大，需要用户确认。  
运行时逻辑：命中后进入 `ConsentResolver`，由 `severity` 决定 `standard` 或 `elevated`。

```python
@dataclass(frozen=True)
class ApprovalRequiredCommand:
    name: str
    matcher: str
    match_mode: Literal["segment_regex", "profile"]
    severity: Literal["standard", "elevated"]
    boundary_scope: BoundaryScope
    reason: str
```

### `sensitive_paths`

适用场景：路径目标的风险依赖 `read/write` 操作类型。  
运行时逻辑：路径命中后先于默认边界生效，决定 `block` / `elevated` / `allow`。

```python
@dataclass(frozen=True)
class SensitivePathRule:
    name: str
    matcher: str  # absolute prefix, project-relative path, glob
    match_mode: Literal["path_prefix", "project_relative", "glob"]
    ops: frozenset[Literal["read", "write", "exec"]]
    effect: Literal["block", "elevated", "allow"]
    boundary_scope: BoundaryScope
    reason: str
```

## BoundaryDecision

```python
@dataclass(frozen=True)
class BoundaryDecision:
    zone: BoundaryZone
    matched_rule: str | None
    reason: str | None
```

## Grant 数据结构

```python
@dataclass(frozen=True)
class GrantKey:
    capability: str
    matcher: str  # path prefix 或 action profile
    boundary_kind: BoundaryKind


@dataclass(frozen=True)
class Grant:
    key: GrantKey
    scope: Literal["session", "config"]
    source: DecisionSource
    created_at: float
    request_id: str | None = None
```

`scope=session` 的生命周期到 session 结束。  
`scope=config` 由配置文件持久化。

## RuntimeBoundaryContext

```python
@dataclass(frozen=True)
class RuntimeBoundaryContext:
    boundary_kind: BoundaryKind
    runtime_root: Path | None
    sandbox_id: str | None
    network_policy: Literal["off", "allowlist", "full"]
    mounted_sensitive_paths: tuple[str, ...] = ()
```

约束：

- `boundary_kind=host` 时沿用当前默认 host 规则；
- `boundary_kind=sandbox` 时三张规则表允许按 runtime 条件重新匹配；
- `session/config` grant 必须带上 `boundary_kind`，防止 sandbox grant 漏到 host。

## ResolvedBoundary

```python
@dataclass(frozen=True)
class ResolvedBoundary:
    runtime: RuntimeBoundaryContext
    project_root: Path
    trusted_write_trie: PathTrie
    trusted_read_trie: PathTrie
    approval_read_trie: PathTrie
    approval_write_trie: PathTrie
    blocked_trie: PathTrie
    snapshot_at: float
    git_available: bool
```

默认建议：

- `trusted_write_trie`
  - tracked files
  - `.kongming/work/`
  - `.kongming/tmp/`
- `approval_read_trie`
  - `.env*`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `pyproject.toml [tool.kongming.safety]`
- `blocked_trie`
  - `~/.ssh/`
  - `~/.gnupg/`
  - `~/.aws/credentials`
  - `~/.netrc`
  - `~/.kongming/`

## ApprovalDecision 字段扩展

现有：

```python
@dataclass(frozen=True)
class ApprovalDecision:
    outcome: Literal["approved", "rejected", "cancelled"]
    reason: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
```

新增 metadata 字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `decision_class` | `str` | `hard_block` / `silent_allow` / `explicit_consent` |
| `decision_source` | `str` | `intrinsic` / `session` / `config` / `standard` / `elevated` |
| `matched_rule` | `str` | 命中的规则或 grant |
| `reason` | `str` | 人读理由 |
| `grant_scope` | `str` 或缺省 | `session` / `config` |
| `boundary_kind` | `str` | `host` / `sandbox` |
| `suggested_alternatives` | `list[str]` 或缺省 | 仅 `hard_block` 时携带，给 LLM 的备选建议（如"改写到 ~/.kongming/work/"） |
| `stage` | `str` | 兼容旧字段（v0.1.3 → v0.1.4 平滑迁移） |

## 配置 schema

建议增加 `safety` section：

```yaml
safety:
  hard_deny_commands:
    - name: "host-root-delete"
      matcher: "rm\\s+-[a-z]*r[a-z]*\\s+/"
      match_mode: "segment_regex"
      boundary_scope: "host"
      reason: "删除宿主根目录"

    - name: "raw-disk-write"
      matcher: "dd\\s+.*of=/dev/"
      match_mode: "segment_regex"
      boundary_scope: "any"
      reason: "写块设备"

  approval_required_commands:
    - name: "git-push"
      matcher: "git_push"
      match_mode: "profile"
      severity: "standard"
      boundary_scope: "any"
      reason: "向远端发布变更"

    - name: "workspace-external-write"
      matcher: "workspace_external_write"
      match_mode: "profile"
      severity: "standard"
      boundary_scope: "any"
      reason: "写入工作区外路径"

    - name: "config-boundary-edit"
      matcher: "kongming_config_write"
      match_mode: "profile"
      severity: "elevated"
      boundary_scope: "any"
      reason: "修改 agent 安全边界"

  sensitive_paths:
    - name: "ssh-material"
      matcher: "~/.ssh/"
      match_mode: "path_prefix"
      ops: ["read", "write"]
      effect: "block"
      boundary_scope: "host"
      reason: "SSH 凭据与主机信任关系"

    - name: "project-env"
      matcher: ".env*"
      match_mode: "glob"
      ops: ["read", "write"]
      effect: "elevated"
      boundary_scope: "any"
      reason: "项目密钥与运行时配置"

    - name: "kongming-workdir"
      matcher: ".kongming/work/"
      match_mode: "project_relative"
      ops: ["write"]
      effect: "allow"
      boundary_scope: "any"
      reason: "低风险工作目录"

  trusted_workdirs:
    - ".kongming/work/"
    - ".kongming/tmp/"

  allow_writes:
    - "/tmp/kongming-*/"

  allow_tools_silent:
    - "read_file"
    - "list_dir"
```

收敛原则：

- `boundary_scope` 是三张规则表的必填字段；
- `boundary_kind` 是 runtime 和 grant 的必填字段；
- `hard_deny_commands` 只收必拒绝动作，不收灰区命令；
- `approval_required_commands` 只收命令动作，不复写路径规则；
- `sensitive_paths` 统一表达路径级 `read/write` 风险；
- `allow_bash_patterns` 暂停开放宽 regex；
- shell 命令优先走 action/profile 级授权。

## 事件模型

新增事件：

| EventKind | 触发时机 | 关键字段 |
|---|---|---|
| `tool.denied` | `hard_block` 或用户拒绝 | decision_class, decision_source, matched_rule, reason |
| `tool.approval_required` | 进入 `standard` / `elevated` ask | decision_class, decision_source, matched_rule |
| `tool.silently_allowed` | 命中 intrinsic / session / config trust | decision_class, decision_source, matched_rule |

## 状态生命周期

| 状态 | 持有者 | 生命周期 | 失效条件 |
|---|---|---|---|
| `ResolvedBoundary` | `BoundaryResolver` | session（TTL 60s） | TTL 到期 / git 状态变化 |
| `session grants` | `GrantStore` | session | session 结束 / reset |
| `config grants` | `GrantStore` | 进程 + 配置文件 | config reload |
| `blocked/elevated rules` | safety ruleset | 进程 | 进程重启 / config reload |

## 装配点变更

`build_safety_chain()` 建议形态：

```python
def build_safety_chain(
    config: Config,
    *,
    interactive_approval: ApprovalProvider,
    boundary_resolver: BoundaryResolver | None = None,
    grant_store: GrantStore | None = None,
) -> SafetyDecisionEngine:
    boundary_resolver = boundary_resolver or BoundaryResolver.from_project_root()
    grant_store = grant_store or GrantStore.from_config(config)

    return SafetyDecisionEngine(
        hard_block=HardBlockGuard.from_config(config),
        boundary=boundary_resolver,
        trust=TrustResolver(boundary_resolver, grant_store),
        consent=ConsentResolver(interactive_approval),
        trace=DecisionTrace(),
    )
```
