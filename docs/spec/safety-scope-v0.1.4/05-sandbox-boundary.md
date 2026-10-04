# Sandbox Boundary

## 目标

这份文档描述 `host` 与 `sandbox` 的边界差异，以及 v0.1.4 三张规则表如何扩展到 sandbox。  
当前主文档仍以 host 规则为主，这里提供后续演进的独立设计面。

## 差异总览

同一条命令、同一路径、同一份 grant，在 `host` 和 `sandbox` 里的风险不同。  
差异的根因是伤害半径、持久化范围、网络能力、挂载面不同。

| 维度 | Host | Sandbox |
|---|---|---|
| 文件系统 | 真实宿主根目录、真实用户家目录 | 隔离根目录、工作区副本、显式挂载 |
| 命令伤害半径 | 影响真实机器、真实账户、真实服务 | 影响容器、VM、临时工作区、挂载卷 |
| 敏感路径 | 用户凭据、宿主配置、agent 自身配置 | 注入凭据、共享卷、host 挂载、runtime 配置 |
| 网络能力 | 常见为真实外网和内网访问 | 常见为 `off / allowlist / full` |
| 持久化语义 | 长期状态 | 会话层、镜像层、挂载层 |
| 授权沉淀风险 | 高 | 中等，取决于 sandbox 生命周期与挂载 |

## 设计原则

### 1. 规则表保持三张

不新增第四张表。  
继续使用：

- `hard_deny_commands`
- `approval_required_commands`
- `sensitive_paths`

扩展点放在匹配条件里。

### 2. 运行时边界进入正式 schema

`RuntimeBoundaryContext` 是正式数据结构，每次审批请求都必须携带：

```python
@dataclass(frozen=True)
class RuntimeBoundaryContext:
    boundary_kind: BoundaryKind
    runtime_root: Path | None
    sandbox_id: str | None
    network_policy: Literal["off", "allowlist", "full"]
    mounted_sensitive_paths: tuple[str, ...] = ()
```

### 3. grant 绑定边界

`session` 和 `config` grant 都要带 `boundary_kind`。  
host grant 只在 host 命中，sandbox grant 只在同类 sandbox 边界命中。

### 4. 规则绑定边界

三张规则表都要带 `boundary_scope`。  
运行时匹配条件统一为：

- `boundary_scope=any`：host / sandbox 都命中
- `boundary_scope=host`：只在 host 命中
- `boundary_scope=sandbox`：只在 sandbox 命中

## 三张规则表如何扩展

### `hard_deny_commands`

适用场景：无论是否在 sandbox，都不应执行，或者命令会越过 sandbox 影响 host。

host 典型规则：

- `rm -rf /`
- `dd if=... of=/dev/...`
- `mkfs.*`
- `systemctl stop ...`

sandbox 典型规则：

- `dd if=... of=/mounted-host-volume/...`
- 改写 sandbox 中映射出来的 host 凭据目录
- 逃逸或扩大挂载面的命令

正式 schema：

```python
@dataclass(frozen=True)
class HardDenyCommand:
    name: str
    matcher: str
    match_mode: Literal["segment_regex", "profile"]
    boundary_scope: BoundaryScope
    reason: str
```

### `approval_required_commands`

适用场景：命令动作合理，但需要结合运行时边界确认。

host 典型规则：

- `git push` → `standard`
- 工作区外写入 → `standard`
- 改写 `.kongming/config*` → `elevated`

sandbox 典型规则：

- `apt install` 或系统包安装 → `standard` 或 `elevated`
- 请求开启网络 → `elevated`
- 写挂载卷外路径 → `standard`

正式 schema：

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

适用场景：路径风险强依赖当前 runtime。

host 典型规则：

- `~/.ssh/` + `read|write` → `block`
- `~/.aws/config` + `read|write` → `elevated`
- `.env*` + `read|write` → `elevated`

sandbox 典型规则：

- `/workspace/.tmp/` + `write` → `allow`
- `/mnt/host-home/.ssh/` + `read|write` → `block`
- `/sandbox-secrets/` + `read|write` → `elevated`

正式 schema：

```python
@dataclass(frozen=True)
class SensitivePathRule:
    name: str
    matcher: str
    match_mode: Literal["path_prefix", "project_relative", "glob"]
    ops: frozenset[Literal["read", "write", "exec"]]
    effect: Literal["block", "elevated", "allow"]
    boundary_scope: BoundaryScope
    reason: str
```

## BoundaryResolver 扩展

`BoundaryResolver` 继续负责默认边界推导。  
扩展到 sandbox 后，边界推导多一层 runtime 语义：

- `host`
  - `trusted zone` 来自 tracked files 和 `.kongming/work|tmp`
  - `blocked zone` 主要来自真实凭据和宿主配置
- `sandbox`
  - `trusted zone` 来自 sandbox workspace 和低风险临时目录
  - `blocked zone` 主要来自挂载出来的 host 敏感路径和 runtime 配置

建议接口：

```python
class BoundaryResolver:
    def resolve(
        self,
        request: ApprovalRequest,
        runtime: RuntimeBoundaryContext,
    ) -> BoundaryDecision:
        ...
```

## TrustResolver 与 GrantStore 扩展

### TrustResolver

命中条件从：

- capability
- path prefix / action profile

扩展为：

- capability
- path prefix / action profile
- boundary_kind

### GrantStore

grant 需要多一维：

```python
@dataclass(frozen=True)
class GrantKey:
    capability: str
    matcher: str
    boundary_kind: BoundaryKind
```

这条约束能避免：

- 在 sandbox 内批准的 `write tests/` 漏到 host
- 在 host 批准的外网命令漏到无网络 sandbox

## 典型例子

### 例子 1：`rm -rf /tmp/build`

- host：通常进入 `approval_required_commands` 或 `hard_deny_commands`，取决于路径策略
- sandbox：通常可降到 `standard`，前提是 `/tmp` 位于隔离根目录内

### 例子 2：读取 SSH 配置

- host：`~/.ssh/config` + `read` → `block`
- sandbox：`/mnt/host-home/.ssh/config` + `read` → `block`
- sandbox：普通工作区文件不受这条规则影响

### 例子 3：安装依赖

- host：`apt install ripgrep` → `elevated` 或 `block`
- sandbox：如果 runtime 明确允许系统包安装，可降到 `standard`

### 例子 4：工作区写入

- host：tracked 文件写入可由 intrinsic trust 静默放行
- sandbox：sandbox workspace 内写入同样可以静默放行
- host 挂载卷：如果映射到真实宿主敏感目录，仍要按 `sensitive_paths` 提升或阻断

## 当前建议

1. 主文档继续保持 host-first，不把 runtime 实现细节混进去。
2. `RuntimeBoundaryContext` 作为正式 schema 加入 `ResolvedBoundary` 输入。
3. 三张规则表统一使用必填 `boundary_scope`。
4. `GrantStore` 统一使用必填 `boundary_kind`。
