# 核心流程

本文档描述 v0.1.5 重构后 `HardBlockGuard.evaluate(...)` shell 通路的完整决策流程，并把每条分支的 trace 字段写法、fail-safe 策略、与 v0.1.4 路径通路的衔接点固定下来。

## 0. 总览

```
ApprovalRequest(capability=SHELL_EXEC)
  │
  ▼
HardBlockGuard.evaluate(request)
  │
  ├─ 路径通路（v0.1.4，本期不动）
  │     └─ _match_path(...) → SensitivePathRule(effect=block) 命中 → deny
  │
  └─ shell 通路（v0.1.5 重构，本文聚焦）
        └─ _match_command_v015(command) ───── 详见下文 4 步流水线
              └─ 任一步命中 → ApprovalDecision(deny, source=intrinsic, decision_class=hard_block)
              └─ 全部 miss → return None（让 BoundaryResolver / ConsentResolver / TrustResolver 接力）
```

不变量：

- shell 通路只能输出 `hard_block` 或 `None`，不能直接 `allow`；
- 所有 deny 都带 `decision_source = intrinsic` + `matched_rule != ""` + `boundary_kind = host`；
- 任意层抛异常 → fail-safe deny + `failure_reason` 字段；不允许"异常被吞 → silent allow"。

## 1. 主流水线（4 步）

### Step 1 — Normalize

```
raw_command = request.metadata[ApprovalMetadataKeys.SHELL_COMMAND]
normalized  = InputNormalizer.normalize(raw_command)
```

行为：

- 输入：CLI / Tool 透传的原始 shell 字符串，可能含 ANSI 转义、全角字符、NULL 字节、奇异引号；
- 输出：UTF-8 normalized 字符串；
- trace 写入：`shell_raw=raw[:200]`、`shell_normalized=normalized[:200]`，仅取前 200 字节避免 trace 爆炸。

异常处理：

- `normalize` 任何异常都 catch 后转 `fail-safe deny`，`failure_reason="normalize_error"`；
- 实操中 normalize 是纯字符串变换，不预期抛错。

### Step 2 — Parse

```
intents = ShellIntentParser.parse(normalized)
```

行为：

- 输出 `list[ShellIntent]`，每个 segment 对应一条或多条 intent；
- 解析失败的 segment emit `ShellIntent(verb=Verb.UNKNOWN, target=None, flags={"raw": <segment>})`；
- 整段 regex 命中（如 fork-bomb）emit `Verb.FORK_BOMB`，不再切 segment。

trace 写入（每条 intent 一行）：

- `intent_verb=<verb_name>`
- `intent_target=<target or null>`（NoneType 序列化为 null）
- `intent_flags=<sorted list[str]>`

### Step 3 — Match path-target intents

```
for intent in intents:
    if intent.target is None:
        continue
    op = _VERB_TO_OPS_KEY.get(intent.verb)   # delete/write → "write"
    if op is None:
        continue
    decision = _match_path(intent.target, op=op, request=request)
    if decision and decision.is_block():
        return _emit_hard_block(rule=decision.matched_rule,
                                intent=intent,
                                source="sensitive_path")
```

要点：

- 复用 v0.1.4 `_match_path` —— path 通路已稳，shell 通路靠"verb→op 归一"借力；
- `_VERB_TO_OPS_KEY` 仅 `DELETE→write` / `WRITE→write` 两条，避免 `sensitive_paths` schema 改动；
- 只命中 `effect=block` 的规则，`elevated` 由 ConsentResolver 处理（不在 hard_block 流水线内拒绝）。

### Step 4 — Match mechanism intents

```
for intent in intents:
    if intent.verb in MECHANISM_VERBS:    # FORMAT_DISK / FORK_BOMB / CHMOD_ZERO ...
        rule = _lookup_mechanism_rule(intent)
        if rule is not None:
            return _emit_hard_block(rule=rule.rule_id,
                                    intent=intent,
                                    source="mechanism_rule")
```

要点：

- `MECHANISM_VERBS` 是 verb 集合常量，与 `DEFAULT_MECHANISM_RULES` 表是 1:1 映射；
- `--no-preserve-root` 是横切 flag，触发逻辑：发现任意 intent 的 `flags` 含 `--no-preserve-root` 即按 `mechanism-no-preserve-root` 拒绝。

### Step 5 — Fallback

```
needs_fallback = (
    not_matched_yet and
    any(i.verb is Verb.UNKNOWN for i in intents)
)
if needs_fallback:
    legacy = _match_command_legacy(normalized)   # v0.1.4 完整 regex 表
    if legacy is not None:
        return _emit_hard_block(rule=legacy.rule_id,
                                intent=None,
                                source="legacy_regex",
                                extra_metadata={LEGACY_REGEX_FALLBACK: True})
```

要点：

- 仅当"上面所有 intent 都 miss" + "存在 UNKNOWN intent"才走 fallback；
- 全 KNOWN intent 但 miss → 允许放行，因为 parser 已经"看懂"了，是策略表本身没规则；
- fallback 命中要打 `legacy_regex_fallback=true`，方便 audit 脚本统计哪些 regex 还在被需要。

### 终态

```
return None    # 让出决策权，下游 BoundaryResolver / ConsentResolver / TrustResolver 接力
```

## 2. parser 内部分派流程

```
ShellIntentParser.parse(normalized) -> list[ShellIntent]:
  segments = _split_shell_segments(normalized)
  out = []
  for seg in segments:
      seg = _strip_quote_chars(seg)
      if seg in WHOLE_SEGMENT_REGEXES:        # fork-bomb 整段
          out.append(ShellIntent(Verb.FORK_BOMB, None, frozenset()))
          continue
      tokens = _tokenize(seg)
      if not tokens:
          continue
      head = tokens[0]
      handler = _HEAD_TOKEN_DISPATCH.get(head)
      if handler is None:
          # 头 token 不在白名单 → 检测重定向算子
          for redirect in _REDIRECT_TOKENS:
              if redirect in tokens:
                  out.extend(_parse_redirect(tokens, redirect))
                  break
          else:
              out.append(ShellIntent(Verb.UNKNOWN, None, frozenset({"raw": seg})))
          continue
      try:
          out.extend(handler(tokens))
      except Exception:
          # 单个 handler 失败不影响其他 segment，但本 segment 必须降级为 UNKNOWN
          out.append(ShellIntent(Verb.UNKNOWN, None, frozenset({"raw": seg, "handler_error": "1"})))
  return out
```

每个 handler 是纯函数：`(tokens: list[str]) -> list[ShellIntent]`，闭合白名单见 02-module-breakdown.md §模块 2。

## 3. Unknown / 未识别意图的兜底

| 情形 | parser 输出 | 主流水线行为 |
|---|---|---|
| 头 token 不在白名单（如 `awk`） | `Verb.UNKNOWN` | 进 fallback 跑旧 regex |
| `bash -c "rm -rf /"` 这类内嵌 | `Verb.UNKNOWN`（不解 `-c` 体内） | 进 fallback；旧 regex 仍能整段命中 |
| `$(rm -rf /)` 命令替换 | `Verb.UNKNOWN`（不展开） | 进 fallback |
| heredoc / 多行脚本 | `Verb.UNKNOWN` | 进 fallback |
| alias `rm='rm -rf'` 后跟 `rm /` | parser 看到 `rm /` 直接命中 | 不需要 fallback |
| 完全空字符串 / 注释行 | 0 个 intent | 直接 return None（流水线无害） |

兜底原则：**parser 不会"乐观吃下"自己看不懂的东西**——任何模糊性都升级成 UNKNOWN，由 fallback 或 ConsentResolver 接力。

## 4. 失败模式与 fail-safe

| 失败点 | 现象 | 处理 |
|---|---|---|
| Step 1 normalize 异常 | 极少发生 | catch 后 fail-safe deny，metadata `failure_reason=normalize_error` |
| Step 2 parser 内部异常 | 单 segment | 该 segment 降级为 UNKNOWN，其它 segment 正常解析；不让单条 bug 拒绝整个流程 |
| Step 2 parser 外部异常 | 整体崩溃 | catch 后 fail-safe deny，`failure_reason=parser_error` |
| Step 3 path 匹配抛错 | 极少 | catch 后 fail-safe deny，`failure_reason=path_match_error` |
| Step 4 mechanism 匹配抛错 | 极少 | catch 后 fail-safe deny |
| Step 5 fallback 命中 | 正常路径 | 拒绝 + `legacy_regex_fallback=true` |
| Step 5 fallback 也 miss + 有 UNKNOWN intent | 输出 None，让下游接力 | 等价于 v0.1.4 的"放行进 ConsentResolver"行为 |

`fail-safe deny` 统一形态：

```python
return ApprovalDecision.deny(
    reason="hardblock_internal_failure",
    matched_rule="<empty>",
    metadata={
        ApprovalMetadataKeys.DECISION_CLASS: "hard_block",
        ApprovalMetadataKeys.DECISION_SOURCE: "intrinsic",
        ApprovalMetadataKeys.BOUNDARY_KIND: "host",
        ApprovalMetadataKeys.FAILURE_REASON: failure_reason,
    },
)
```

## 5. 与 path 通路的衔接

shell 通路借用 path 通路时遵守"借力，不污染"：

- 调用 `_match_path(target, op="write", request=request)` 时复用 v0.1.4 实现，不为 shell 通路新加 `_match_path_for_shell` 分叉；
- shell 命中 path 表时，trace 中 `matched_rule` 仍是 `SensitivePathRule.rule_id`，`decision_source=intrinsic`，但额外补 `intent_verb` / `intent_target` 字段，便于运营脚本区分"原生 write_file 命中"还是"shell 归一命中"；
- path 通路本身的输入仍由 `WriteFile` 等工具自己的 capability 提供，不受 v0.1.5 影响。

## 6. 决策顺序固定（与原则文一致）

```
hard_block (本流水线)
   │ None
   ▼
silent_allow  (TrustResolver)
   │ miss
   ▼
explicit_consent (ConsentResolver, 受 SmartApprovalHook 影响)
```

shell 通路的所有"非 deny"输出都意味着"流水线认为没触线"，**不是**"放行"——放行决策仍由 TrustResolver / ConsentResolver 综合 boundary 与 grant 评估。

## 7. trace 字段一览（v0.1.5 新增/扩展）

| key | 写入时机 | 类型 | 说明 |
|---|---|---|---|
| `shell_raw` | 总是（shell 通路） | str ≤ 200 | normalize 前原始字符串 |
| `shell_normalized` | 总是（shell 通路） | str ≤ 200 | normalize 后字符串 |
| `intent_verb` | 命中时 | str | 命中 intent 的 verb 名 |
| `intent_target` | 命中时 | str / null | 命中 intent 的 target，若 verb 是机制类则 null |
| `intent_flags` | 命中时 | sorted list[str] | 命中 intent 的 flags |
| `match_source` | 命中时 | enum | `sensitive_path` / `mechanism_rule` / `legacy_regex` |
| `legacy_regex_fallback` | 仅 fallback 命中 | bool | 用于 audit 脚本统计 |
| `failure_reason` | 仅 fail-safe 路径 | str | `normalize_error` / `parser_error` / `path_match_error` ... |

## 8. 不变量清单（让 reviewer 一目了然）

1. shell 通路只有两种输出：`hard_block` 或 `None`；
2. `decision_source` 永远是 `intrinsic`，shell 通路不消费 grant；
3. `decision_class=hard_block` 的请求永远不能被 SmartApprovalHook 翻盘；
4. 任何异常 fail-safe deny，绝不 silent allow；
5. parser 是闭合白名单，用户 yaml 不能注册新 verb；
6. `SensitivePathRule` schema 在 v0.1.5 不变（不新增 `delete` op）；
7. fallback 仅在"全 miss + 有 UNKNOWN intent"时触发；
8. v0.1.4 的 yaml 配置零改动可继续工作（regex 表只是搬迁，不删）。
