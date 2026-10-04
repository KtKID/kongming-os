# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| M1 scheduler domain/store contract | 定义任务与执行上下文的 thread 绑定字段，完成兼容读写 | 现有 `src/scheduler/domain.py`、`src/scheduler/store.py` | 可进入 x-req | 保持 scheduler schema 版本 |
| M2 scheduler manager/provisioning | 收口“先建 thread，再建 task，失败补偿”的业务入口 | M1 + M4 | 可进入 x-req | Web 和 schedule_tool 共享边界 |
| M3 execution bridge session binding | cron run 使用绑定 thread session，投递层保留广播并避免重复追加 | M1 + `ExecutionBridge` + `DeliveryDispatcher` | 可进入 x-req | 这是执行语义核心 |
| M4 web thread metadata/REST contract | thread metadata v11 和 REST/DTO 协议升级 | `ThreadManager` + routers | 可进入 x-req | 新增 `thread_kind` 作为业务类型 |
| M5 frontend navigation | 前端任务模型、左侧分组、scheduler 行打开 thread | M4 + scheduler API | 可进入 x-req | 用户可见入口 |
| M6 validation | 后端、前端、smoke/e2e 验证闭环 | M1-M5 | 可进入 x-req | x-req 必须展开命令 |

## 模块详情

### M1 scheduler domain/store contract

**职责**：把 cron 与专属 thread 的绑定提升为 scheduler 领域模型的一等字段。

**边界类或公共入口**：`ScheduledTask`、`TaskExecutionContext`、`Store`

**包含范围**：
- `ScheduledTask.thread_id: str = ""`
- `TaskExecutionContext.thread_id: str = ""`
- `_task_to_dict()` 写出 `thread_id`
- `_dict_to_task()` 使用 `payload.get("thread_id", "")` 读取，缺失时从 `target.metadata["thread_id"]` 或 `delivery.target` 回填

**范围外**：
- scheduler `SCHEMA_VERSION` bump
- 重置旧任务文件
- 多任务共享 thread

**依赖**：现有 scheduler domain/store。

**复用/新建**：复用 `src/scheduler/domain.py` 和 `src/scheduler/store.py`；新增字段和回填纯函数。

**数据结构/接口**：

```python
@dataclass(frozen=True)
class ScheduledTask:
    thread_id: str = ""  # 绑定的专属 thread id；空字符串表示历史任务或创建失败前的未绑定状态

@dataclass(frozen=True)
class TaskExecutionContext:
    task_id: str  # 定时任务 id
    scheduled_for: str  # 本次预定触发时间，ISO8601 字符串
    trigger_type: TriggerType  # 触发器类型，来自任务 trigger
    origin: TaskOrigin  # 任务来源，区分 web、tool 等创建入口
    is_scheduled_run: bool  # 是否由 scheduler 触发执行
    thread_id: str = ""  # 本次执行绑定的 thread id；用于 audit、事件和运行 payload

def recover_task_thread_id(payload: dict[str, object]) -> str:
    """从新字段、target metadata 或 delivery target 兼容恢复 thread id。"""
```

**风险等级**：低

**风险说明**：字段升级路径清晰，主要风险是漏掉旧任务回填导致历史任务在前端缺少打开入口。

**task 建议**：
- 建议 task 名：`scheduled-task-thread`
- 对应 DoD：DoD#3、DoD#4
- 是否进入 x-req：是
- 原因：边界明确，字段和兼容规则已确认。

### M2 scheduler manager/provisioning

**职责**：提供创建定时任务的业务门户，统一 Web 和 schedule_tool 的 provisioning 流程。

**边界类或公共入口**：`SchedulerManager` 或 `ScheduleThreadProvisioner` Protocol

**包含范围**：
- 创建 `thread_kind="scheduled_task"` 的 thread
- 写入 `source_kind="scheduled_task"` 和 `source_id=<task_id>`
- 创建 `ScheduledTask(thread_id=..., delivery.target="thread:<thread_id>")`
- 创建失败时补偿删除已创建 thread 或返回明确错误
- default preset 在同一装配边界收口

**范围外**：
- Web router 直接拼接 thread metadata
- schedule_tool import web 模块
- task 创建路径各自复制 provisioning 逻辑

**依赖**：M1、M4、现有 store、现有 thread manager。

**复用/新建**：建议新增 `src/scheduler/manager.py::SchedulerManager`；也可先用 Protocol 注入 thread provisioner，后续演进为 Manager。

**数据结构/接口**：

```python
class ScheduleThreadProvisioner(Protocol):
    async def create_scheduled_task_thread(
        self,
        *,
        task_id: str,  # 定时任务 id；用于 source_id 和 thread 命名关联
        name: str,  # thread 展示名，默认取 cron 任务名
        preset_id: str,  # 任务默认 preset；generic_chat thread 创建时使用
        cwd: str,  # thread 工作目录；来自 Web 当前上下文或 schedule_tool ctx
    ) -> str:  # 返回创建好的 thread id
        ...

class SchedulerManager:
    async def create_task_with_thread(
        self,
        request: CreateScheduledTaskCommand,  # 已校验的创建命令
    ) -> ScheduledTask:  # 返回落盘后的任务，含 thread_id 和 delivery target
        ...
```

**风险等级**：中

**风险说明**：补偿删除 thread 需要与 ThreadManager 的删除语义对齐。并发创建同名任务时以 task_id 为 source_id 保证关联唯一。

**task 建议**：
- 建议 task 名：`scheduled-task-thread`
- 对应 DoD：DoD#1、DoD#2
- 是否进入 x-req：是
- 原因：这是创建链路的唯一业务门户。

### M3 execution bridge session binding

**职责**：cron 触发执行时使用绑定 thread 作为 session，把执行输入输出落到专属历史，并整理投递语义。

**边界类或公共入口**：`ExecutionBridge`、`DeliveryDispatcher`

**包含范围**：
- `session_id = task.thread_id or _fresh_session_id(task.task_id)`
- `TaskExecutionContext.thread_id = task.thread_id`
- run audit 和 payload 增加 `thread_id`
- `task.thread_id == run.session_id` 时保留 WebDeliverySink 广播，跳过 ThreadTargetSink append
- run_now 和 ticker dispatcher 行为统一

**范围外**：
- Runner 写消息逻辑调整
- closed cell 自动恢复策略
- delivery 重试机制

**依赖**：M1、现有 `Runner.run`、`DeliveryDispatcher`、`ThreadTargetSink`。

**复用/新建**：复用 `src/application/scheduled_runs/execution_bridge.py`；在 `_apply_delivery()` 或 DeliveryDispatcher 调用前构造无 target task copy。

**数据结构/接口**：

```python
class ExecutionBridge:
    async def execute(self, reservation: DueTaskReservation) -> ScheduledRun:
        # 当 task.thread_id 有值时，Runner.run 的 session_id 使用该 thread id。
        ...

    async def _apply_delivery(self, *, task: ScheduledTask, run: ScheduledRun) -> ScheduledRun:
        # 当 task.thread_id == run.session_id 时，对 delivery 做 broadcast-only 处理。
        # 可构造无 target 的 task copy，或在当前调用点显式跳过 target append。
        ...
```

**风险等级**：高

**风险说明**：重复 append 会造成同一回答在 thread history 出现两份，closed cell 追加失败会把成功 run 标成 delivery failed。建议先用测试复现绑定 thread 成功执行、广播保留和 target append 跳过三件事。

**task 建议**：
- 建议 task 名：`scheduled-task-thread`
- 对应 DoD：DoD#4、DoD#5
- 是否进入 x-req：是
- 原因：风险可通过 focused pytest 先锁住。

### M4 web thread metadata/REST contract

**职责**：把 thread 的业务类型写入 metadata 和 REST DTO，让 Web 后端能识别 scheduled_task thread。

**边界类或公共入口**：`ThreadManager`

**包含范围**：
- `ThreadMetadata.schema_version` 升级到 11
- 新增 `thread_kind: Literal["chat", "scheduled_task"] = "chat"`
- 新增 `source_kind: str = ""`
- 新增 `source_id: str = ""`
- `CreateThreadRequest` / `ThreadMetadataDTO` / TS DTO 同步字段
- `ThreadManager.create_thread()` 接收可选业务类型字段，或新增 `create_scheduled_task_thread()` 门户方法
- `CreateCronTaskRequest` / `CronTaskDTO` 增加 `thread_id`

**范围外**：
- 用 `backend_kind` 过滤业务分组
- 改动 claude_code/codex 传输语义
- 批量 rewrite 旧 metadata 文件

**依赖**：现有 Web thread manager、routers、protocol.ts。

**复用/新建**：复用 `src/hosts/web/threads/metadata.py`、`manager.py`、`routers/threads.py`、`routers/cron.py` 和 `web/src/protocol.ts`。

**数据结构/接口**：

```python
class ThreadMetadata(BaseModel):
    thread_kind: Literal["chat", "scheduled_task"] = "chat"  # 业务类型；chat 为普通对话，scheduled_task 为定时任务专属 thread
    source_kind: str = ""  # 来源业务对象类型；定时任务固定为 scheduled_task
    source_id: str = ""  # 来源业务对象 id；定时任务为 task_id

class CreateCronTaskRequest(BaseModel):
    preset_id: str | None = None  # 创建任务和专属 thread 时使用的 preset id

class CronTaskDTO(BaseModel):
    thread_id: str  # 绑定 thread id；前端用它打开历史
```

```typescript
export type ThreadKind = "chat" | "scheduled_task";

export interface ThreadMetadataDTO {
  thread_kind: ThreadKind; // 业务类型；用于前端分组和筛选
  source_kind: string; // 来源业务对象类型；定时任务为 scheduled_task
  source_id: string; // 来源业务对象 id；定时任务为 task_id
}

export interface CronTaskDTO {
  thread_id: string; // 绑定 thread id；scheduler row 打开历史时使用
}
```

**风险等级**：中

**风险说明**：metadata lazy migration 需要覆盖 v1-v10 文件，DTO 变更需要前后端 fixture 防止协议漂移。

**task 建议**：
- 建议 task 名：`scheduled-task-thread`
- 对应 DoD：DoD#1、DoD#6
- 是否进入 x-req：是
- 原因：字段和默认值已明确。

### M5 frontend navigation

**职责**：把专属 thread 变成用户可见入口，支持从 scheduler 和左侧列表打开历史。

**边界类或公共入口**：`ThreadList`、scheduler API/store、scheduler task row component

**包含范围**：
- `ThreadMetadataDTO.thread_kind`
- `SchedulerTaskVM.threadId`
- 左侧 thread 列表增加“定时任务”分组，图标使用 Clock
- scheduler row 增加打开 thread 动作
- 创建任务成功后刷新 tasks 和 threads

**范围外**：
- 新增独立 scheduler 路由页面
- 修改 chat composer 主交互
- 常驻 `/ws/cron` 作为前端 P0 依赖

**依赖**：M4、现有 `web/src/components/ThreadList.tsx`、`web/src/modules/scheduler/api.ts`、`types.ts`。

**复用/新建**：复用现有 ThreadList 与 scheduler module；新增分组 selector 和 row action。

**数据结构/接口**：

```typescript
export interface SchedulerTaskVM {
  id: string; // 定时任务 id
  name: string; // 用户可见任务名
  threadId: string; // 绑定 thread id；为空时隐藏打开历史动作
  presetId: string; // 任务绑定 preset id
}

export interface ThreadGroupVM {
  kind: "chat" | "scheduled_task"; // 前端分组类型
  label: string; // 分组标题；scheduled_task 显示为“定时任务”
  threads: ThreadMetadataDTO[]; // 分组内 thread 列表
}
```

**风险等级**：低

**风险说明**：主要风险是老 thread 缺 `thread_kind` 时被过滤；前端默认值和后端 lazy migration 要同步。

**task 建议**：
- 建议 task 名：`scheduled-task-thread`
- 对应 DoD：DoD#7
- 是否进入 x-req：是
- 原因：UI 入口明确，现有组件可复用。

### M6 validation

**职责**：提供本 spec 的最低验证闭环。

**边界类或公共入口**：pytest、vitest、Web smoke/e2e 脚本或手工验收记录

**包含范围**：
- scheduler store roundtrip/backfill 测试
- ThreadManager metadata v11 lazy migration 测试
- Web cron create route 测试
- ExecutionBridge session binding 和 delivery skip 测试
- schedule_tool create path 测试
- frontend API mapping、ThreadList 分组、scheduler row 打开 thread 测试
- smoke/e2e 验收步骤

**范围外**：
- 外部 LLM 真实调用要求
- 长周期 cron soak test
- repo-wide flaky 用例治理

**依赖**：M1-M5。

**复用/新建**：复用 `tests/unit/web/`、`tests/unit/`、`web/src/modules/scheduler/__tests__/` 和 `web/src/components` 测试模式。

**数据结构/接口**：

```python
class ScheduledTaskThreadValidationCase(TypedDict):
    name: str  # 测试场景名称
    entrypoint: str  # pytest 或 vitest 命令入口
    expected: str  # 关键断言或通过标准
```

**风险等级**：中

**风险说明**：跨前后端 smoke 需要稳定本地 Web 环境。x-req 需要把真实启动方式和验收路径写清楚。

**task 建议**：
- 建议 task 名：`scheduled-task-thread`
- 对应 DoD：DoD#8
- 是否进入 x-req：是
- 原因：验证范围可直接映射到实现切片。
