# 数据与状态

> 本文档定义 v0.1.5 引入的全部数据结构与配置 schema 变更。所有实现实现以本文为契约面。

## 总览

v0.1.5 的数据形态**完全增量**于 v0.1.4：

| 来源 | 是否新增 | 是否变更 | 备注 |
|---|---|---|---|
| `core.contracts.ApprovalDecision` | 否 | 否 | 完全复用 |
| `core.contracts.ApprovalRequest` | 否 | 否 | 完全复用 |
| `safety.types.SensitivePathRule` | 否 | 否 | **不加新字段、不加新 op**；shell delete/move/redirect 全部归一到 `write` op |
| `safety.types.HardDenyCommand` | 否 | 否 | 完全复用，仅在 default_rules.py 中重新分组 |
| `safety.types.ApprovalMetadataKeys` | 否 | 是（追加） | 新增 `INTENT_VERB` / `INTENT_TARGET` / `LEGACY_REGEX_FALLBACK` 三个可选键 |
| `safety.shell_intent.Verb` | 是 | — | 新枚举 |
| `safety.shell_intent.ShellIntent` | 是 | — | 新 frozen dataclass |
| `safety.default_rules.DEFAULT_MECHANISM_RULES` | 是 | — | 从原 `DEFAULT_HARD_DENY_COMMANDS` 析出"无 target"子集 |
| `safety.default_rules.DEFAULT_HARD_DENY_COMMANDS` | 否 | 是（瘦身） | 移除已被 parser 覆盖的"机制 × 目标"组合；保留作为 fallback |
| 用户 yaml `safety.hard_deny_commands` | 否 | 否 | 行为不变；不鼓励再写"机制 × 目标"组合 |
| 用户 yaml `safety.sensitive_paths` | 否 | 否 | 行为不变；新写法见下文示例 |
| Trace event 字段 | 否 | 是（追加） | 新增 `intent_verb` / `intent_target` / `legacy_regex_fallback`（可选） |

**核心承诺**：用户 yaml 配置零改动可继续工作；所有变化对外通过新增可选字段表达。

## ShellIntent 数据结构

```python
# src/safety/shell_intent.py

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum

class Verb(str, Enum):
    """parser 能识别的动词集合。封闭白名单，用户不可扩展。"""

    # 有 target 的动词 —— 命中 SensitivePathRule.ops="write"
    DELETE = "delete"          # rm -r, rmdir, find -delete
    WRITE = "write"            # >, >>, cp dst, mv dst, tee, dd of=, sed -i, install, rsync, truncate

    # 无 target 的纯机制 —— 命中 MechanismRule
    EXEC = "exec"              # 管道接收方 sh / bash / zsh / dash / ksh
    FORMAT_DISK = "format_disk"  # mkfs / fdisk
    CHMOD_ZERO = "chmod_zero"  # chmod 0 / chmod -R 000
    FORK_BOMB = "fork_bomb"    # :(){ :|:& };:
    NO_PRESERVE_ROOT = "no_preserve_root"  # rm --no-preserve-root（与目标无关，单独成 verb）

    # 兜底
    UNKNOWN = "unknown"        # 解析失败 / 含 $() / heredoc 体内 / unparseable token


@dataclass(frozen=True)
class ShellIntent:
    """从 shell segment 解析出的单个意图。"""

    verb: Verb
    target: str | None          # 路径字符串（write/delete 时通常非 None）；mechanism 类恒为 None
    flags: frozenset[str] = field(default_factory=frozenset)
    raw_segment: str = ""       # 原始 segment 文本，留给 trace 与 fallback 使用

    # 解析时遇到 $VAR / $(...) 在 target 位置 → target=None, raw_segment 保留全文，
    # 让 policy 层选择"保守 ask"或"fallback regex"。
```

### Verb 选择理由

| Verb | 为什么单独成枚举 |
|---|---|
| `DELETE` vs `WRITE` | 解析层区分以保留语义（trace 复盘时能看到"删了 ssh"还是"覆写了 ssh"），但**策略层都查 ops="write"**——破坏式修改对凭据等同 |
| `EXEC` 单列 | "管道接收方是 sh/bash" 是机制不是目标，且不能折叠到 WRITE（exec 的 target 是 stdin 流而非文件） |
| `FORMAT_DISK` | mkfs/fdisk 的 target 是块设备节点，与文件路径同质；为减少 SensitivePathRule 表里的 `/dev/sd*` 与设备前缀重复，单独成 verb |
| `CHMOD_ZERO` | 权限置零是机制特性，不是路径风险（chmod 0 任何系统目录都危险） |
| `FORK_BOMB` | 经典 signature，无 target，单独 verb |
| `NO_PRESERVE_ROOT` | 解析 rm 时如发现 `--no-preserve-root`，**额外发射一个** Verb=NO_PRESERVE_ROOT 意图（不替换 DELETE 意图）。这样既能命中纯机制规则，也能正常做 target 匹配 |
| `UNKNOWN` | 是 fail-safe 必备出口，policy 层据此触发 legacy fallback |

### Verb → SensitivePathRule.ops 的映射

```python
_VERB_TO_OPS_KEY: dict[Verb, str] = {
    Verb.DELETE: "write",   # 破坏式修改 ≡ write 风险
    Verb.WRITE: "write",
}
# 其他 Verb 不查 path 表
```

**这是 v0.1.5 的关键 schema 决策**：不引入 `delete` op，让 v0.1.4 已写的所有规则（包括用户 yaml）零改动获得 shell 删除场景的覆盖。

> 反向选择（增加 `delete` op）的成本：所有现有 SensitivePathRule 都要审视一遍要不要加 `delete`，包括 default_rules.py 内 13 条与未知数量的用户配置。收益不明显（"允许删但不允许写"几乎不存在的真实场景）。

## MechanismRule（不引入新类型，复用 HardDenyCommand）

v0.1.4 的 `safety.types.HardDenyCommand` 已经有 `name / matcher / match_mode / boundary_scope / reason` 五字段，足以表达机制规则。v0.1.5 不引入新类型，只是在 `default_rules.py` 里**重新分组**：

```python
# src/safety/default_rules.py (v0.1.5 重组后)

# ① 纯机制规则 —— 由 ShellIntent 派发命中（无 target，按 verb 直接拒绝）
DEFAULT_MECHANISM_RULES: tuple[HardDenyCommand, ...] = (
    HardDenyCommand(name="format-disk-mkfs", matcher="VERB:format_disk", match_mode="intent_verb",
                    boundary_scope=BoundaryScope.ANY, reason="格式化文件系统"),
    HardDenyCommand(name="fork-bomb", matcher="VERB:fork_bomb", match_mode="intent_verb",
                    boundary_scope=BoundaryScope.ANY, reason="fork bomb"),
    HardDenyCommand(name="rm-rf-no-preserve-root", matcher="VERB:no_preserve_root", match_mode="intent_verb",
                    boundary_scope=BoundaryScope.ANY, reason="禁用根目录保护"),
    HardDenyCommand(name="pipe-to-shell", matcher="VERB:exec", match_mode="intent_verb",
                    boundary_scope=BoundaryScope.ANY, reason="执行经管道传入的远程脚本"),
    HardDenyCommand(name="chmod-zero", matcher="VERB:chmod_zero", match_mode="intent_verb",
                    boundary_scope=BoundaryScope.HOST, reason="把目录权限置零"),
    # 注：chmod-zero 是否拒绝由 target 路径决定 —— parser 出 chmod_zero verb + target 是系统路径
    # 时由两层规则共同判定：先 mechanism rule 走 elevated，再 path rule 走 block。
    # 这里给出的是 v0.1.4 chmod-zero-root + chmod-zero-system-dirs 二者塌缩后的形态。
)

# ② 仍然按 regex 匹配的"复杂条件"规则
DEFAULT_REGEX_HARD_DENY: tuple[HardDenyCommand, ...] = (
    HardDenyCommand(
        name="raw-disk-write",
        matcher=r"\bdd\s+.*of=/dev/(disk|sd|nvme|hd|mmc)",
        match_mode="segment_regex",
        boundary_scope=BoundaryScope.ANY,
        reason="写块设备",
    ),
    # config-self-escalation 这种"yaml 内容扫描"留在原位
)

# ③ 已被 parser 覆盖的 v0.1.4 老规则 —— deprecated 但保留作 fallback
DEFAULT_LEGACY_FALLBACK_RULES: tuple[HardDenyCommand, ...] = (
    # host-root-delete 等：parser 失败时使用
    # 命中时 trace 写 legacy_regex_fallback=true，便于后续清理
)
```

新增 `match_mode = "intent_verb"`：

```python
# src/safety/types.py 既有定义不变，仅扩展 match_mode 取值
MatchMode = Literal["segment_regex", "profile", "path_prefix", "glob",
                    "project_relative", "intent_verb"]  # 新增最后一项
```

`intent_verb` 类规则的 `matcher` 字段语义：`"VERB:<verb_name>"`，解析后与 `ShellIntent.verb` 比对。

## SensitivePathRule（零变更，新写法）

v0.1.4 的 schema 不动：

```python
@dataclass(frozen=True)
class SensitivePathRule:
    name: str
    matcher: str
    match_mode: Literal["path_prefix", "glob", "project_relative"]
    ops: frozenset[str]            # {"read", "write"}
    effect: Literal["block", "elevated", "allow"]
    boundary_scope: BoundaryScope
    reason: str
```

但 v0.1.5 起，**用户 yaml 添加 shell 保护目标的推荐写法**变化：

### v0.1.4 的写法（仍可工作，但不推荐）

```yaml
safety:
  hard_deny_commands:
    - {name: protect-notdeltest-rm,    matcher: "^rm\\s+(-[a-zA-Z]*r[a-zA-Z]*).*\\bnotdeltest", match_mode: segment_regex, boundary_scope: any, reason: 禁止 rm 删除 notdeltest}
    - {name: protect-notdeltest-mv,    matcher: "^mv\\s+.*\\bnotdeltest", match_mode: segment_regex, boundary_scope: any, reason: 禁止 mv}
    - {name: protect-notdeltest-cp,    matcher: "^cp\\s+.*\\bnotdeltest", match_mode: segment_regex, boundary_scope: any, reason: 禁止 cp}
    # ... 还要 7 条
```

### v0.1.5 的写法（推荐）

```yaml
safety:
  sensitive_paths:
    - name: protect-notdeltest
      matcher: notdeltest/
      match_mode: project_relative
      ops: [read, write]
      effect: block
      boundary_scope: any
      reason: 不准动 notdeltest 目录
```

**1 条规则**自动覆盖：

| Shell 命令 | parser 输出 | 命中规则 |
|---|---|---|
| `rm -rf notdeltest/` | `Intent(DELETE, "notdeltest/")` | protect-notdeltest（write op） |
| `echo x > notdeltest/foo` | `Intent(WRITE, "notdeltest/foo")` | protect-notdeltest |
| `dd of=notdeltest/x` | `Intent(WRITE, "notdeltest/x")` | protect-notdeltest |
| `cp src notdeltest/y` | `Intent(WRITE, "notdeltest/y")` | protect-notdeltest |
| `tee -a notdeltest/log` | `Intent(WRITE, "notdeltest/log")` | protect-notdeltest |
| `rsync -a stuff/ notdeltest/` | `Intent(WRITE, "notdeltest/")` | protect-notdeltest |
| `mv junk notdeltest/x` | `Intent(WRITE, "notdeltest/x")` | protect-notdeltest |

`read_file notdeltest/secret.txt` 也命中（read op）—— 自动获得双向保护，v0.1.4 写 10 条 regex 时反而漏了这个。

## ApprovalMetadataKeys 追加（向后兼容）

```python
# src/safety/types.py

class ApprovalMetadataKeys:
    # ... v0.1.4 已有键全部保留 ...
    INTENT_VERB = "intent_verb"                     # 新增（可选）：触发 hard_block 的 ShellIntent.verb
    INTENT_TARGET = "intent_target"                 # 新增（可选）：触发 hard_block 的 ShellIntent.target
    LEGACY_REGEX_FALLBACK = "legacy_regex_fallback" # 新增（可选）：True 表示走的是兼容期 fallback
```

只在 shell 通路命中时写入；path/file 工具命中时这三个键缺省。

## Trace 事件字段

JsonlTraceSink 落盘的事件格式追加：

```json
{
  "kind": "approval.decision",
  "outcome": "rejected",
  "metadata": {
    "decision_class": "hard_block",
    "decision_source": "intrinsic",
    "matched_rule": "protect-notdeltest",
    "reason": "不准动 notdeltest 目录",
    "boundary_kind": "host",
    "stage": "capability",
    "suggested_alternatives": [...],

    "intent_verb": "write",                  // 新增
    "intent_target": "notdeltest/x",         // 新增
    "legacy_regex_fallback": false           // 新增（true = 命中 v0.1.4 老 regex）
  }
}
```

## 配置文件 schema 形式化（pydantic）

`src/config_loader/models.py` 现有定义无变更：

```python
class SafetyHardDenyConfig(BaseModel):
    name: str
    matcher: str
    match_mode: Literal["segment_regex", "profile", "intent_verb"]  # ← 新增 intent_verb
    boundary_scope: Literal["any", "host", "sandbox"] = "any"
    reason: str

class SafetySensitivePathConfig(BaseModel):
    # 完全不变
    ...
```

## 不引入的字段（明确决策）

为避免方案漂移，以下都被显式拒绝：

- ❌ `SensitivePathRule.ops` 增加 `delete` / `move_target` —— 复杂度不值
- ❌ `ShellIntent.severity` —— 严重度由匹配的策略规则决定，不下放到 parser
- ❌ `ShellIntent.user_extensible_verbs` —— parser verb 表是封闭白名单
- ❌ `ApprovalDecision` 字段变更 —— 全部通过 metadata 表达
- ❌ 新顶层配置段 `safety.shell_intent.*` —— v0.1.5 不暴露新配置面
