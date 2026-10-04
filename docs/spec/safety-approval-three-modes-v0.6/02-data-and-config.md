# 02 数据模型与配置

## config schema（setting.yaml）

`setting.yaml` 保存全局审批策略，permissions 由每个 thread 的独立本子保存。

```yaml
safety:
  # 全局审批模式：user_approval（默认）| full_trust | auto（预留）
  approval_mode: user_approval

  # auto 模式预留配置位（本期仅校验不消费）
  auto_judge:
    model_preset: null
```

`safety.permissions` 不进入 config schema。下列旧字段进入一次性迁移通道，loader 遇到时返回带迁移命令的配置错误：

- `safety.approval_rules`
- `safety.trusted_workdirs`
- `safety.allow_writes`
- `safety.allow_tools_silent`
- 早期草案中的 `safety.permissions`

## thread permissions 落盘 schema

每个 thread 拥有一份独立文件：

```text
<kongming_home>/safety/thread_permissions/<sha256(thread_id)>.json
```

`sha256(thread_id)` 用于生成安全的单文件路径，真实 `thread_id` 保存在文件内并在每次读取时校验。Web `metadata.json` 继续保存 thread 描述信息，审批本子由 safety 模块独立持有，避免将安全规则暴露到 `ThreadMetadataDTO` 或让 safety 反向依赖 Web 宿主。

```json
{
  "schema_version": 1,
  "thread_id": "thread-797842f187aa",
  "revision": 3,
  "allow": [
    "read_file",
    "list_dir",
    "run_shell(git:*)"
  ],
  "deny": [
    "run_shell(curl:*)"
  ],
  "updated_at": "2026-07-16T12:00:00Z"
}
```

`allow` / `deny` 保存 canonical DSL 表达式。语法复用 `rule_parser.py` 的 7 种 matcher：`tool_exact`、`tool_glob`、`shell_prefix`、`path_prefix`、`path_glob`、`mcp_exact`、`mcp_glob`。文件缺失表示该 thread 的本子为空；第一次"记住"时延迟创建。

## 数据模型（`rule_models.py` 瘦身）

`ApprovalMode` 是全局配置值，唯一真源位于 `infrastructure.config.models`；
`rule_models.py` 复用并导出该枚举。其余 permissions 值对象属于 safety 内部合同。

```python
class ApprovalMode(StrEnum):
    USER_APPROVAL = "user_approval"
    FULL_TRUST = "full_trust"
    AUTO = "auto"


class Verdict(StrEnum):
    ALLOW = "allow"
    DENY = "deny"


@dataclass(frozen=True)
class PermissionEntry:
    expression: str
    verdict: Verdict
    matcher: RuleMatch


@dataclass(frozen=True)
class PermissionResolution:
    verdict: Verdict
    expression: str


@dataclass(frozen=True)
class ThreadPermissionsSnapshot:
    thread_id: str
    revision: int
    allow: tuple[str, ...]
    deny: tuple[str, ...]
    updated_at: str | None
    schema_version: int = 1
```

`RuleSource`、`RememberScope`、`RuleScope`、`RuleBehavior.ASK` 退出新合同。新合同用 `thread_id` 直接选择独立 snapshot，规则内部无需再保存 thread/session/cwd scope。

## 归属键与 Manager 边界

`PermissionsManager` 是 safety 模块对外的唯一门户：

```python
class PermissionsManager:
    async def resolve(
        self,
        thread_id: str,
        request: ApprovalRequest,
    ) -> PermissionResolution | None: ...

    async def snapshot(self, thread_id: str) -> ThreadPermissionsSnapshot: ...

    async def write_entry(
        self,
        thread_id: str,
        entry: PermissionEntry,
        *,
        expected_revision: int,
    ) -> ThreadPermissionsSnapshot: ...

    async def delete_entry(
        self,
        thread_id: str,
        entry: PermissionEntry,
        *,
        expected_revision: int,
    ) -> ThreadPermissionsSnapshot: ...

    async def delete_thread(self, thread_id: str) -> None: ...
```

`ThreadPermissionsStore` 作为 safety 模块的内部文件存储 helper，只由 `PermissionsManager` 调用。Manager 为每个 thread 维护独立 `asyncio.Lock`，文件锁、JSON 读写、`fsync` 与 `os.replace` 通过 `asyncio.to_thread` 执行。宿主、router、decision engine 和前端 API 都经过 Manager，遵守模块门户边界。

本子归属键的解析顺序固定为：

1. `ApprovalRequest.metadata["thread_id"]`：Web generic_chat / Claude Code 与顶层 thread 内的子 agent 都显式传递该值。Codex route 只透传 Kongming root thread 上下文；`codex exec --json` 内部工具权限继续由 provider 原生策略处理，后续 app-server transport 任务再接共享逐工具审批。
2. `ApprovalRequest.session_id`：CLI 等宿主使用稳定 session id 作为 thread 键。

子 agent 的执行 `session_id` 可以独立，它的 approval request 继续携带顶层 `thread_id`，因此同一 thread 内共享本子。记住动作只接受稳定 thread 键；瞬时连接可以执行"允许一次 / 拒绝一次"。

## 记忆写回

用户在审批卡选择"允许并记住 / 拒绝并记住"时：

1. `PermissionsManager.build_remember_expression(request)` 生成 canonical 表达式候选，UI 展示 `expression + displayText`。
2. pending approval 在创建时冻结 `thread_id`、candidate 和当时 `revision`。
3. resolve 帧携带 `remember=true` 后，`ApprovalManager` 校验 pending 身份与 candidate，再调用 `PermissionsManager.write_entry(thread_id, ..., expected_revision)`。
4. Store 对目标 thread 文件加锁、重读、校验 revision、写临时文件、`fsync` 并原子 `os.replace`。
5. 写入成功后更新该 thread 的内存 snapshot；其他 thread 的 snapshot 保持原值。

WS `remember` 字段退化为 `bool`：`true` 固定表示写入 pending 中冻结的当前 thread。`thread_id` 由 pending approval 和 resolve route 双重校验，前端无法在 resolve 时把规则切换到另一个 thread。

## thread 生命周期

- 创建 thread：本子视为空，首次记住时物化文件。
- 重命名、切换 preset、跨 run 恢复：`thread_id` 保持，本子继续生效。
- 归档 thread：保留本子，恢复归档后继续使用。
- 删除 thread：`ThreadManager` 先完成 thread 主状态删除，再通过 `PermissionsManager.delete_thread(thread_id)` 清理本子。清理失败会写 audit/event 并加入重试队列；启动时孤儿扫描以现存 thread id 集合为准补偿删除。无对应 thread 的孤儿本子不参与任何审批。
- 新建或克隆 thread：默认从空本子开始，任何复制操作都需用户显式确认目标 thread。

## 迁移方案（一次性脚本，无兼容 shim）

`scripts/migrate_permissions_v06.py` 使用显式目标：

```powershell
uv run python scripts/migrate_permissions_v06.py --thread-id thread-797842f187aa --dry-run
uv run python scripts/migrate_permissions_v06.py --thread-id thread-797842f187aa --apply
```

1. 读取旧 `safety.approval_rules[]`：`behavior=allow` 转入目标 thread `allow`，`behavior=deny` 转入目标 thread `deny`，`behavior=ask` 丢弃（新模型的未命中语义就是问用户）。
2. 全局旧规则需要 `--thread-id`，脚本不向所有已有 thread 扇出，避免将一份历史全局授权复制成 N 份隐式授权。
3. `trusted_workdirs` 只输出候选 `path_prefix` 表达式，由用户确认后写入指定 thread。
4. 遗留内存 session rules 随旧进程结束；已持久的 config rules 经显式目标迁移。
5. `<kongming_home>/web/auto_approval/` 下的 cwd 倒计时配置原地保留，作为 auto 模式后续输入。
6. 脚本支持 dry-run、幂等去重和 diff 摘要，写入时走同一 `PermissionsManager` 门户。
