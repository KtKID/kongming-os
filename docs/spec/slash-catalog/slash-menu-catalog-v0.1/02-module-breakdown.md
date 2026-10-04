# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| SlashCatalogManager | Web slash catalog 门户，聚合 group/items 并提供兼容投影。 | Catalog Providers | 可进入 x-req | 新建 `src/hosts/web/slash_catalog/manager.py`。 |
| Catalog Providers | 将 workflow/command/skill 注册源转换成统一 item DTO。 | workflow manager、command registry、skill loader | 可进入 x-req | 三个 provider 均从真实注册源读取。 |
| Slash Catalog REST | 暴露 catalog/group items API，处理 query 和错误映射。 | SlashCatalogManager | 可进入 x-req | 新建 router，旧 route 调 manager 投影。 |
| SlashMenu Frontend | Web 两级菜单，处理 group/item 状态、加载态、空态、键盘导航和 reference activation。 | Slash Catalog REST + Rich Composer Reference UI | 可进入 x-req | 改 `web/src/components/SlashMenu.tsx` 和 `Composer.tsx`。 |
| Workflow History Projection | 将当前 thread completed workflow run 投影为 workflow 组历史分区。 | WorkflowRunViewerManager | 方案确认 | read-only，复用 session root 路径约束。 |
| Conversation Reference Contract | 定义选择 catalog item 后进入对话的引用合同。 | SlashCatalogItemDTO + WebSocket Protocol | 方案确认 | 新增 `ConversationReferenceDTO` 与 activation 模板。 |
| Rich Composer Reference UI | 在 Composer 中渲染 text/reference node 序列和不可编辑 chip。 | Conversation Reference Contract | 方案确认 | 新增前端 `ConversationReferenceManager.ts` 或同等门户。 |
| Conversation Reference Manager | 后端解析 references，生成 prompt 注入片段或后续动作计划。 | skill loader、command registry、workflow manager/viewer | 方案确认 | 新增 `prompting/context_sources/conversation_reference_manager.py`。 |

## 模块详情

### 模块 1：SlashCatalogManager

**职责**：作为 `src/hosts/web/slash_catalog/` 唯一门户，注册 provider，聚合首层 group 摘要和 group items，并为旧 `/api/slash-candidates` 输出 command+skill flat projection。

**包含范围**：
- `SlashCatalogManager.list_groups(context)`：返回 `workflow`、`command`、`skill` 的 group 摘要，顺序稳定。
- `SlashCatalogManager.list_group_items(group_id, context)`：按 group 调 provider。
- `SlashCatalogManager.list_legacy_candidates(context)`：投影 command+skill，保留 `slash/title/description/source`。
- provider 注册、去重、错误诊断收敛。

**不包含范围**：
- 注册源内部创建和业务执行。
- 前端 UI 状态机。
- workflow run 详情读取。

**依赖**：Catalog Providers、`SlashCatalogContext`、FastAPI app state 或工厂注入的 registry/manager。

**复用/新建**：新建 `src/hosts/web/slash_catalog/manager.py`；迁移 `src/hosts/web/app_support/slash_candidates_loader.py` 的 command/skill 投影规则。

**数据结构/接口**：

```python
class SlashCatalogProvider(Protocol):
    group_id: str  # 分组稳定 ID，例如 workflow、command、skill
    group_title: str  # 分组中文标题，用于首层菜单展示

    async def list_items(self, context: SlashCatalogContext) -> tuple[SlashCatalogItemDTO, ...]:
        """读取当前上下文下的分组子项，输出统一 item DTO。"""


@dataclass(frozen=True)
class SlashCatalogManager:
    providers: tuple[SlashCatalogProvider, ...]  # 已注册 provider，顺序决定首层展示顺序

    async def list_groups(self, context: SlashCatalogContext) -> tuple[SlashCatalogGroupDTO, ...]:
        """读取首层分组摘要，输入为请求上下文，输出稳定排序的 group DTO。"""

    async def list_group_items(
        self,
        group_id: str,
        context: SlashCatalogContext,
    ) -> tuple[SlashCatalogItemDTO, ...]:
        """读取指定分组子项，输入为 group_id 和上下文，输出 item DTO。"""

    async def list_legacy_candidates(
        self,
        context: SlashCatalogContext,
    ) -> list[dict[str, str]]:
        """生成旧 flat 候选，输入为上下文，输出兼容 /api/slash-candidates 的字典列表。"""
```

**风险等级**：中
**风险说明**：workflow manager 当前在 Web runtime 中通过 `AgentWorkflowHandle` late-bound 到 thread；route 要拿到注册表视图，需要选择 app state 暴露 handle、只读 registry factory 或 lifecycle 预构造 manager。

**task 建议**：
- 建议 task 名：`slash-catalog-core`
- 对应 DoD：DoD#1、DoD#2、DoD#3、DoD#4、DoD#6、DoD#7
- 是否进入 x-req：是
- 原因：边界和注册源明确，可独立实现和测试。

### 模块 2：Catalog Providers

**职责**：把 workflow、command、skill 三类真实注册源适配成统一 catalog group/item。

**包含范围**：
- `WorkflowCatalogProvider`：从 `AgentWorkflowManager.list_workflow_strategies()` 或等价策略注册表工厂读取 `WorkflowStrategyCatalogEntry`。
- `CommandCatalogProvider`：从 `CommandRegistry.list_commands("web")` 读取 `CommandDefinition`。
- `SkillCatalogProvider`：从 `load_skill_specs(home, workspace)` 读取 `SkillSpec`。
- 为每个 item 生成 `reference_template`，描述选择后的 `kind/ref/label/activation/source_ref`。
- command/skill 名称冲突沿用旧 flat list 优先级：command 先占用 slash key，skill 冲突时跳过兼容投影。
- provider 内生成 `source_ref`，便于测试和调试。

**不包含范围**：
- 前端过滤和搜索排序。
- workflow payload 的参数采集。
- skill body 读取和 prompt 注入。

**依赖**：`commands.registry.CommandRegistry`、`prompting.skills.skill_loader.load_skill_specs`、`application.agent_workflows.manager.AgentWorkflowManager` 或策略注册表工厂。

**复用/新建**：新建 `src/hosts/web/slash_catalog/providers.py`；复用 `slash_candidates_loader.py` 的 command/skill 字段投影；复用 `WorkflowStrategyCatalogEntry` 和 `WorkflowListItemDTO`。

**数据结构/接口**：

```python
@dataclass(frozen=True)
class WorkflowCatalogProvider:
    group_id: str = "workflow"  # 首层 workflow 分组 ID
    group_title: str = "Workflow"  # 首层 workflow 分组标题

    async def list_items(self, context: SlashCatalogContext) -> tuple[SlashCatalogItemDTO, ...]:
        """读取 workflow strategy 和历史 run，输出 mode 项与 completed run 项。"""


@dataclass(frozen=True)
class CommandCatalogProvider:
    registry: CommandRegistry  # Web 可见 command 注册表
    group_id: str = "command"  # 首层 command 分组 ID
    group_title: str = "Command"  # 首层 command 分组标题


@dataclass(frozen=True)
class SkillCatalogProvider:
    group_id: str = "skill"  # 首层 skill 分组 ID
    group_title: str = "Skill"  # 首层 skill 分组标题
```

**风险等级**：中
**风险说明**：skill loading 是 async 且受 `home/workspace` 影响，测试需要 fake home/workspace；workflow registry 的 route 可见性需要先定依赖注入路径。

**task 建议**：
- 建议 task 名：`slash-catalog-core`
- 对应 DoD：DoD#2、DoD#3、DoD#4、DoD#6、DoD#7
- 是否进入 x-req：是
- 原因：provider 合同稳定，数据源已存在。

### 模块 3：Slash Catalog REST

**职责**：FastAPI route 暴露 catalog 和 group items，并将旧 `/api/slash-candidates` 改为 manager 投影。

**包含范围**：
- `GET /api/slash-catalog`：返回 group 摘要，支持可选 `thread_id` query。
- `GET /api/slash-catalog/groups/{group_id}`：返回指定组 items，支持可选 `thread_id` query。
- `GET /api/slash-candidates`：内部调用 `SlashCatalogManager.list_legacy_candidates()`。
- 线程 ID 校验沿用 `THREAD_ID_RE` 或共用 helper。
- provider 异常映射成可诊断 DTO 或 Web error。

**不包含范围**：
- WebSocket 推送 catalog 更新。
- 长缓存和后台预热。
- workflow run detail route。

**依赖**：`SlashCatalogManager`、FastAPI `Request.app.state.config/workspace_root/thread_manager`、可选 workflow handle/registry factory。

**复用/新建**：新建 `src/hosts/web/routers/slash_catalog.py`；更新 `src/hosts/web/routers/slash_candidates.py` 的实现路径；在 `src/hosts/web/app.py` include 新 router。

**数据结构/接口**：

```python
@router.get("/slash-catalog")
async def list_slash_catalog(
    request: Request,
    thread_id: str | None = None,  # 当前 thread ID，用于加载 workflow 历史分区
) -> dict[str, object]:
    """返回首层 catalog groups，输入为可选 thread_id，输出 group DTO 列表。"""


@router.get("/slash-catalog/groups/{group_id}")
async def list_slash_catalog_group(
    group_id: str,  # 分组稳定 ID：workflow、command、skill
    request: Request,
    thread_id: str | None = None,  # 当前 thread ID，用于 workflow completed runs
) -> dict[str, object]:
    """返回指定分组 items，输入为 group_id 和上下文，输出 item DTO 列表。"""
```

**风险等级**：低
**风险说明**：主要风险是路由初始化和旧 lifespan `app.state.slash_candidates` 预加载逻辑重复。建议新 route 请求期调用 manager，旧预加载逻辑可收敛到兼容 manager。

**task 建议**：
- 建议 task 名：`slash-catalog-rest`
- 对应 DoD：DoD#1、DoD#3、DoD#4、DoD#5、DoD#7
- 是否进入 x-req：是
- 原因：接口清晰，能用 TestClient 覆盖。

### 模块 4：SlashMenu Frontend

**职责**：将当前 flat `SlashMenu` 改成 group → item 两级菜单，`Composer` 提供 `threadId` 并按 item action 生成 reference chip 或后续动作。

**包含范围**：
- `SlashCatalogGroup`、`SlashCatalogItem` TS 类型。
- 首层 group 列表、二层 item 列表。
- 搜索 query 过滤：首层按 group title，二层按 `slash/title/description/mode/workflow_id`。
- 键盘导航：上下移动、Enter 进入/选择、Escape 返回/关闭。
- loading、empty、error fallback。
- skill 选择调用 Rich Composer Reference UI 插入不可编辑 reference chip。
- command 选择可插入文本，也可按 `activation="execute_command"` 生成 command reference。
- workflow mode 选择生成 `guide_payload` reference 或插入兼容文本。
- completed run 选择生成 `open_viewer` reference 或插入 `/workflow-run <workflow_id> ` 兼容文本。

**不包含范围**：
- workflow 参数表单。
- viewer 详情页新 UI。
- 语义搜索排序。
- 后端 reference resolver。

**依赖**：`GET /api/slash-catalog`、`GET /api/slash-catalog/groups/{group_id}`、`Composer.threadId`、Rich Composer Reference UI。

**复用/新建**：修改 `web/src/components/SlashMenu.tsx`、`web/src/components/Composer.tsx`；可新增 `web/src/lib/slash-catalog.ts` 存放 API client 和类型。

**数据结构/接口**：

```typescript
export interface SlashCatalogGroup {
  id: string; // 分组稳定 ID，例如 workflow、command、skill
  title: string; // 分组中文标题
  description: string; // 分组说明，用于首层辅助文本
  itemCount: number | null; // 子项数量；未知时为 null
  order: number; // 展示顺序，数值越小越靠前
}

export interface SlashCatalogItem {
  id: string; // 分组内稳定项 ID
  groupId: "workflow" | "command" | "skill"; // 所属分组
  sectionId?: "registered" | "completed"; // workflow 内部分区
  title: string; // 展示标题
  description: string; // 展示说明
  slash?: string; // command/skill 兼容 slash 文本
  insertText?: string; // 选择后插入输入框的文本
  action: "insert_text" | "bind_reference" | "open_viewer" | "guide_payload"; // 前端选择动作提示
  sourceRef: string; // 后端来源引用，用于测试和诊断
  referenceTemplate?: ConversationReferenceTemplate; // 选择后生成的引用模板
}
```

**风险等级**：中
**风险说明**：现有 `Composer` 用 `menuFiltered` 管理 active index；两级状态机要避免 index 在 group/item 切换时越界，并保持输入 `/abc` 的过滤体验。

**task 建议**：
- 建议 task 名：`slash-menu-two-level-ui`
- 对应 DoD：DoD#1、DoD#8
- 是否进入 x-req：是
- 原因：前端行为明确，能通过 Vitest 覆盖。

### 模块 5：Workflow History Projection

**职责**：将当前 thread 的 completed workflow run 作为 workflow 组历史分区候选，保持 read-only viewer/API 投影边界。

**包含范围**：
- 复用 `WorkflowRunViewerManager.list_workflows(thread_id)`。
- 过滤 `status == "completed"` 的 `WorkflowListItemDTO`。
- 生成 `SlashCatalogItemDTO(kind="workflow_run", section_id="completed")`。
- 标题优先使用 `WorkflowListItemDTO.title`，描述包含 `mode`、`finished_at`、`report_count`。
- 选择 action 仅给 hint：`open_viewer` 或 `insert_text`。

**不包含范围**：
- 读取 workflow detail、reports、artifacts。
- 修改 workflow run 产物。
- 跨 thread 汇总历史。

**依赖**：`WorkflowRunViewerManager`、`WorkflowListItemDTO`、`thread_id` query。

**复用/新建**：可以作为 `CompletedWorkflowRunProvider` 单独实现，也可以作为 `WorkflowCatalogProvider` 的内部 helper；统一输出 workflow 组 item。

**数据结构/接口**：

```python
@dataclass(frozen=True)
class CompletedWorkflowRunProvider:
    viewer: WorkflowRunViewerManager  # 只读 workflow viewer 门户

    async def list_completed_runs(
        self,
        context: SlashCatalogContext,
    ) -> tuple[SlashCatalogItemDTO, ...]:
        """读取当前 thread 已完成 workflow，输入为 catalog context，输出 workflow 历史 item。"""
```

**风险等级**：低
**风险说明**：`thread_id` 缺失时只返回 workflow strategy 分区；历史分区需要 route 层校验 thread 存在性或沿用 viewer route 的 `_require_thread` 语义。

**task 建议**：
- 建议 task 名：`workflow-history-catalog-projection`
- 对应 DoD：DoD#5、DoD#7
- 是否进入 x-req：是
- 原因：只读投影，已有 viewer manager 提供路径保护。

### 模块 6：Conversation Reference Contract

**职责**：定义 catalog item 被用户选择后进入 Composer、WS payload、message metadata 和 prompt assembly 的统一引用合同。

**包含范围**：
- `ConversationReferenceDTO`：提交到后端的结构化引用。
- `ConversationReferenceTemplate`：catalog item 输出的选择模板。
- `UserInputFrame.references`：WebSocket 入站 payload 字段。
- `Message.metadata["conversation_references"]`：runtime 内部软合同。
- reference activation 枚举：`inject_context`、`execute_command`、`start_workflow`、`guide_payload`、`open_viewer`。

**不包含范围**：
- skill body 读取。
- command 执行。
- workflow payload wizard。

**依赖**：`SlashCatalogItemDTO`、`hosts.web.protocol.ws_frames.UserInputFrame`、`core.message.Message`。

**复用/新建**：扩展 `src/hosts/web/slash_catalog/models.py` 和 `src/hosts/web/protocol/ws_frames.py`；前端同步扩展 `web/src/lib/slash-catalog.ts` 与 `web/src/protocol.ts`。

**数据结构/接口**：

```python
class ConversationReferenceDTO(BaseModel):
    id: str  # 单条消息内稳定引用 ID，前端生成
    kind: Literal["skill", "command", "workflow_strategy", "workflow_run"]  # 来源类型
    ref: str  # 稳定引用，例如 skill:skill-creator
    label: str  # UI 展示名称，例如 Skill Creator
    activation: Literal[
        "inject_context",
        "execute_command",
        "start_workflow",
        "guide_payload",
        "open_viewer",
    ]  # 选择后的语义动作
    source_ref: str | None = None  # catalog provider 生成的诊断引用
    args: dict[str, object] = {}  # 后续 payload 或命令参数
    metadata: dict[str, object] = {}  # UI 与调试扩展字段
```

```typescript
export interface ConversationReferenceTemplate {
  kind: "skill" | "command" | "workflow_strategy" | "workflow_run";
  ref: string;
  label: string;
  activation:
    | "inject_context"
    | "execute_command"
    | "start_workflow"
    | "guide_payload"
    | "open_viewer";
  source_ref?: string | null;
  args?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
```

**风险等级**：中
**风险说明**：该合同横跨 REST DTO、WS DTO、session metadata 和前端类型，字段漂移会直接导致 chip 可见但后端无法注入。

**task 建议**：
- 建议 task 名：`slash-conversation-reference-contract`
- 对应 DoD：DoD#9、DoD#11、DoD#14
- 是否进入 x-req：是
- 原因：合同层是后续 UI 和 resolver 的前置。

### 模块 7：Rich Composer Reference UI

**职责**：在 Web Composer 中维护 text/reference node 序列，将 reference 渲染为不可编辑 chip，并在提交时序列化为 `text + references`。

**包含范围**：
- `ComposerNode`：`text` 与 `reference` 两类节点。
- reference chip 渲染：图标、label、tooltip、选中态。
- Backspace/Delete 一次删除整个 chip。
- 复制 chip 时落成 `$skill-name` 或 `/workflow <mode>` 等文本 fallback。
- 提交时输出纯文本 `text` 和结构化 `references`。
- history 回放时根据 `conversation_references` metadata 还原 chip。

**不包含范围**：
- 大段富文本格式。
- 多光标协同编辑。
- 后端 reference 解析。

**依赖**：SlashMenu Frontend、Conversation Reference Contract、现有 `Composer` 上传附件和 reasoning controls。

**复用/新建**：新增 `web/src/modules/conversation-references/ConversationReferenceManager.ts` 或同等门户；`Composer.tsx` 只调用门户方法，避免直接拼 DTO。

**数据结构/接口**：

```typescript
export type ComposerNode =
  | { type: "text"; text: string }
  | {
      type: "reference";
      id: string;
      reference: ConversationReferenceDTO;
    };

export interface ComposerSubmission {
  text: string;
  references: ConversationReferenceDTO[];
}
```

**风险等级**：中
**风险说明**：inline chip 需要 contenteditable 或受控富文本输入组件承载；键盘发送、附件上传、焦点、移动端输入体验必须保持稳定。

**task 建议**：
- 建议 task 名：`slash-rich-composer-references`
- 对应 DoD：DoD#10、DoD#11
- 是否进入 x-req：是
- 原因：UI 行为清晰，但需要专门交互测试。

### 模块 8：Conversation Reference Manager

**职责**：作为后端 reference 解析门户，按真实注册源解析 references，并生成 prompt 注入片段或后续动作计划。

**包含范围**：
- `ConversationReferenceManager.resolve_for_prompt(message, context)`：解析最新 user message 的 references。
- `SkillReferenceResolver`：按 `load_skill_specs(home, workspace)` 重新定位 skill，读取 `SKILL.md` 正文。
- `CommandReferenceResolver`：按 `CommandRegistry` 校验 command reference，并为 `execute_command` 输出执行计划。
- `WorkflowReferenceResolver`：按 workflow strategy registry 或 `WorkflowRunViewerManager` 校验 workflow reference。
- 输出 `<selected_skill>`、`<selected_command>`、`<selected_workflow>` 等可审计片段。

**不包含范围**：
- command 真正执行。
- workflow run 创建。
- provider token 预算裁剪。

**依赖**：skill loader、CommandRegistry、AgentWorkflowManager/StrategyManager、WorkflowRunViewerManager、InputAssembler。

**复用/新建**：新增 `src/prompting/context_sources/conversation_reference_manager.py`；`InputAssembler` 调用该 Manager 生成引用片段并插入最新 user message 前。

**数据结构/接口**：

```python
@dataclass(frozen=True)
class ConversationReferenceContext:
    home: Path
    workspace: Path
    thread_id: str | None = None


@dataclass(frozen=True)
class ResolvedConversationReference:
    reference_id: str
    kind: str
    label: str
    content: str  # 已渲染的 XML/markdown 注入片段
    source_ref: str | None
```

**风险等级**：中
**风险说明**：skill body 读取和安全检查需要沿用 skill loader 的路径约束；resolver 必须用服务端真源重查，只接受前端传来的稳定引用和参数。

**task 建议**：
- 建议 task 名：`slash-reference-context-injection`
- 对应 DoD：DoD#12、DoD#13、DoD#14
- 是否进入 x-req：是
- 原因：这是 reference 进入模型上下文的核心链路。
