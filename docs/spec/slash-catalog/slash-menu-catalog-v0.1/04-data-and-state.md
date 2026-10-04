# 数据模型与状态

## 核心实体

```python
@dataclass(frozen=True)
class SlashCatalogContext:
    home: Path  # Kongming home，用于加载用户级 skills
    workspace: Path  # 当前 workspace 根目录，用于加载工作区 skills
    thread_id: str | None = None  # 当前 Web thread ID，用于 workflow 历史分区
    config: Config | None = None  # Web 配置对象，用于 workflow viewer 解析 session root
    workflow_manager: AgentWorkflowManager | None = None  # 已绑定 workflow manager，用于读取 strategy catalog


class SlashCatalogProvider(Protocol):
    group_id: str  # 分组稳定 ID，例如 workflow、command、skill
    group_title: str  # 分组中文标题

    async def list_items(self, context: SlashCatalogContext) -> tuple["SlashCatalogItemDTO", ...]:
        """读取分组子项，输入为 catalog 上下文，输出统一 item DTO。"""


class SlashCatalogGroupDTO(BaseModel):
    id: str  # 分组稳定 ID，例如 workflow、command、skill
    title: str  # 分组中文标题
    description: str  # 分组说明，用于首层菜单辅助文本
    order: int  # 展示顺序，数值越小越靠前
    item_count: int | None = None  # 子项数量；未加载或昂贵计算时为 None
    diagnostics: list[str] = []  # 分组级诊断摘要，正常为空


class SlashCatalogItemDTO(BaseModel):
    id: str  # 分组内稳定项 ID，例如 workflow:parallel 或 command:/clear
    group_id: str  # 所属分组 ID
    section_id: str | None = None  # 分组内分区，例如 registered、completed
    kind: str  # item 类型：workflow_strategy、workflow_run、command、skill
    title: str  # 展示标题
    description: str  # 展示说明
    slash: str | None = None  # command/skill 兼容 slash 文本
    insert_text: str | None = None  # 选择后插入 Composer 的文本
    action: str  # 选择动作提示：insert_text、bind_reference、guide_payload、open_viewer
    enabled: bool = True  # 是否可选择；planned workflow 可展示但禁用
    status: str | None = None  # 来源状态，例如 available、planned、completed
    source_ref: str  # 来源引用，例如 CommandRegistry:/clear
    reference_template: ConversationReferenceTemplate | None = None  # 选择后生成的引用模板
    metadata: dict[str, object] = {}  # 扩展元数据，例如 mode、workflow_id、finished_at


class ConversationReferenceTemplate(BaseModel):
    kind: str  # 引用类型：skill、command、workflow_strategy、workflow_run
    ref: str  # 稳定引用，例如 skill:skill-creator
    label: str  # UI 展示标签，例如 Skill Creator
    activation: str  # 语义动作：inject_context、execute_command、guide_payload、open_viewer
    source_ref: str | None = None  # catalog provider 生成的来源引用
    args: dict[str, object] = {}  # 命令参数、workflow payload 或后续引导参数
    metadata: dict[str, object] = {}  # tooltip、icon、source 等前端辅助字段


class ConversationReferenceDTO(ConversationReferenceTemplate):
    id: str  # 单条消息内稳定引用 ID，由前端生成并随 user.input 提交


class UserInputFrame(BaseModel):
    frame_type: Literal["user.input"] = "user.input"
    text: str  # 用户可见文本，reference chip 复制为 fallback 文本后参与该字段
    request_id: str
    references: list[ConversationReferenceDTO] | None = None  # 本轮显式引用
```

## 实体关系

`SlashCatalogManager` 持有多个 `SlashCatalogProvider`。每个 provider 对应一个首层 `SlashCatalogGroupDTO`，并按请求上下文生成多个 `SlashCatalogItemDTO`。workflow 组内同时包含 strategy 分区和 completed run 历史分区；command/skill 组只包含注册源子项。可选择 item 额外携带 `ConversationReferenceTemplate`，前端把 template 物化为 `ConversationReferenceDTO`，后端 `ConversationReferenceManager` 按真实注册源解析 DTO。实体关系图见 `diagrams.md` 的“provider 聚合局部图”和“conversation reference 注入流程图”。

## 状态流转

SlashMenu 前端状态：

```text
closed → loading_groups → showing_groups → loading_items → showing_items → item_selected
             ↓                  ↓                ↓
           failed             empty            failed
```

Catalog item 状态：

```text
source_registered → projected → delivered → selected
                          ↓
                     disabled_or_empty
```

Conversation reference 状态：

```text
template_projected → chip_inserted → frame_submitted → metadata_persisted
                                            ↓
                                      resolved_for_prompt → injected
```

状态图见 `diagrams.md` 的“前端交互流程图”“catalog item 状态流转图”和“conversation reference 注入流程图”。

## 持久化方案

| 数据 | 存储方式 | 位置 | 备注 |
|------|---------|------|------|
| workflow strategy catalog | 运行时注册表 | `AgentWorkflowManager` / `AgentWorkflowStrategyManager` | 请求期读取，展示已注册 mode。 |
| command catalog | 运行时注册表 | `CommandRegistry` / `BUILTIN_COMMANDS` | Web host 过滤使用 `list_commands("web")`。 |
| skill catalog | 文件扫描 + loader 输出 | `<kongming_home>/skills` + workspace skills | 请求期或短 TTL 读取，来源为 `load_skill_specs(home, workspace)`。 |
| completed workflow runs | 只读文件投影 | `<session_root>/<thread_id>/agent-workflows/<workflow_id>/` | 复用 `WorkflowRunViewerManager`，只返回轻量 projection。 |
| SlashCatalog DTO | 内存响应对象 | Web request scope | 不建立持久化表。 |
| 前端菜单状态 | React state | `SlashMenu` / `Composer` | thread 切换时刷新，避免跨 thread 历史污染。 |
| Composer reference nodes | React state | Rich Composer | 提交后转成 `text + references`，不单独持久化。 |
| conversation references | Session message metadata | `Message.metadata["conversation_references"]` | 跟随 user message 持久化，用于 prompt 注入和 history chip 还原。 |
| resolved reference fragments | 每轮内存对象 | `InputAssembler` request scope | 每轮按最新 user message 解析，不写回磁盘。 |

## 共享数据结构

```typescript
export type SlashCatalogGroupId = "workflow" | "command" | "skill"; // 首层分组 ID

export type SlashCatalogItemKind =
  | "workflow_strategy" // 已注册 workflow mode
  | "workflow_run" // 当前 thread 历史 workflow run
  | "command" // Web 可见 slash command
  | "skill"; // 已加载 skill spec

export type SlashCatalogAction =
  | "insert_text" // 选择后插入 insertText
  | "bind_reference" // 选择后生成 ConversationReferenceDTO
  | "guide_payload" // 选择后进入后续 payload 引导
  | "open_viewer"; // 选择后打开 workflow viewer

export type ConversationReferenceActivation =
  | "inject_context" // 注入模型上下文
  | "execute_command" // 调用 command service
  | "start_workflow" // 创建 workflow run
  | "guide_payload" // 引导补齐 workflow payload
  | "open_viewer"; // 打开 workflow viewer

export interface SlashCatalogGroupDTO {
  id: SlashCatalogGroupId; // 分组稳定 ID
  title: string; // 分组中文标题
  description: string; // 分组说明
  order: number; // 展示顺序
  item_count: number | null; // 子项数量；未知时为 null
  diagnostics: string[]; // 分组诊断
}

export interface SlashCatalogItemDTO {
  id: string; // 分组内稳定项 ID
  group_id: SlashCatalogGroupId; // 所属分组 ID
  section_id?: "registered" | "completed"; // workflow 组内分区
  kind: SlashCatalogItemKind; // item 类型
  title: string; // 展示标题
  description: string; // 展示说明
  slash?: string; // slash 文本，command/skill 使用
  insert_text?: string; // 选择后插入文本
  action: SlashCatalogAction; // 前端动作提示
  enabled: boolean; // 是否可选择
  status?: string; // 来源状态
  source_ref: string; // 来源引用
  reference_template?: ConversationReferenceTemplate | null; // 选择后生成引用的模板
  metadata: Record<string, unknown>; // 扩展元数据
}

export interface ConversationReferenceTemplate {
  kind: "skill" | "command" | "workflow_strategy" | "workflow_run"; // 引用来源类型
  ref: string; // 稳定引用，例如 skill:skill-creator
  label: string; // chip 展示文本
  activation: ConversationReferenceActivation; // 选择后的语义动作
  source_ref?: string | null; // provider 来源诊断
  args?: Record<string, unknown>; // 命令或 workflow 参数
  metadata?: Record<string, unknown>; // tooltip、icon、source 等 UI 字段
}

export interface ConversationReferenceDTO extends ConversationReferenceTemplate {
  id: string; // 单条消息内稳定引用 ID
}

export type ComposerNode =
  | { type: "text"; text: string }
  | { type: "reference"; id: string; reference: ConversationReferenceDTO };
```

## 投影规则

| 来源 | item kind | section | id 规则 | insert/action |
|------|-----------|---------|---------|---------------|
| `WorkflowStrategyCatalogEntry` | `workflow_strategy` | `registered` | `workflow:<mode>` | `bind_reference`，activation 为 `guide_payload` 或 `start_workflow`；保留兼容 `insert_text=/workflow <mode> `。 |
| `CommandDefinition` | `command` | 空 | `command:<slash>` | `bind_reference`，activation 为 `execute_command`；保留兼容 `insert_text=<slash> `。 |
| `SkillSpec` | `skill` | 空 | `skill:<name>` | `bind_reference`，activation 为 `inject_context`，label 来自 skill title/name。 |
| `WorkflowListItemDTO` completed | `workflow_run` | `completed` | `workflow-run:<workflow_id>` | `bind_reference`，activation 为 `open_viewer`；保留兼容 `insert_text=/workflow-run <workflow_id> `。 |

## 错误与空态

| 场景 | 后端行为 | 前端行为 |
|------|----------|----------|
| provider 返回空列表 | 返回空 `items` 和 group 诊断 | 显示空态文本，允许返回首层。 |
| skill loader 失败 | group 诊断记录错误摘要，其他 group 正常返回 | skill 组显示错误态，其他组可用。 |
| workflow manager 缺失 | workflow strategy 分区返回诊断，历史分区仍可按 thread 读取 | workflow 组显示可恢复错误，保留返回操作。 |
| `thread_id` 缺失 | completed run 分区为空 | workflow 组只显示 strategy 分区。 |
| `group_id` 未注册 | 404 或 422 Web error | 菜单显示错误态并返回首层。 |
| reference template 缺失 | item 仍可作为 legacy insert_text 使用 | 前端按 `insert_text` 降级。 |
| skill reference 解析失败 | `ConversationReferenceManager` 生成诊断片段或返回 Web error，trace 记录 `source_ref` | chip 保留，发送后显示错误反馈。 |
| history metadata 缺失 | 后端只返回普通 message 文本 | 前端按纯文本渲染。 |
