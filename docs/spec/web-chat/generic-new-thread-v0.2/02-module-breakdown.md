# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| `GenericPendingThreadEntry` | 通用频道加号入口和 pending 状态 | `ThreadList` + `useThreadsStore` + router | 可进入 x-req | 替代当前 `NewThreadDialog` 预创建路径 |
| `GenericEmptyThreadView` | 空白页 UI、居中 Composer、首发提交 | `ChatPage` + `Composer` + `ChatManager` | 可进入 x-req | 复用现有 Composer，新增项目按钮 |
| `ThreadProjectSelector` | 从已有 thread 派生项目候选，并支持选择新项目后输出 cwd | `ThreadMetadataDTO` + `DropdownMenu` + 宿主文件夹选择器 | 可进入 x-req | 老 thread 缺有效 cwd 时排除 |
| `FirstMessageThreadCreator` | 后端首发创建门户 | `ThreadManager` + session backend + runtime factory | 方案确认 | 最高风险模块 |
| `GenericFirstMessageProtocol` | 前后端首发创建 DTO 与错误语义 | `rest_models.py` + `protocol.ts` | 方案确认 | 需要 round-trip 和 TS 类型同步 |

## 现有资源调研

| 现有资源 | 当前职责 | 本 spec 复用方式 |
|----------|----------|------------------|
| `web/src/components/ThreadList.tsx` | 通用 thread 列表和加号入口 | 加号改为设置 generic pending 状态并跳转 `/chat` |
| `web/src/stores/threads.ts` | thread 列表、preset、pending provider session | 扩展 pending 类型以支持 `generic_chat` |
| `web/src/pages/Chat.tsx` | 三频道页面分流、generic WS、Composer 装配 | 增加 generic pending 分支，真实 thread 仍走现有 generic 分支 |
| `web/src/components/Composer.tsx` | 当前输入框、附件、reasoning、模型、发送按钮 | 增加空白页专属项目选择插槽 |
| `web/src/chat/ChatManager.ts` | 发送入口和 `ensureThread` 接缝 | generic pending 首发可复用 `ensureThread` 编排 |
| `src/hosts/web/routers/threads.py` | thread REST CRUD | 新增首发创建 route 或调用新的 manager 方法 |
| `src/hosts/web/threads/manager.py` | thread metadata 生命周期唯一门户 | 新增 `create_generic_thread_from_first_message` |
| `src/hosts/web/websocket/routes.py` | 已有 generic WS，需要已存在 thread_id | 首发创建成功后继续复用 |
| `src/core/runner.py` | `_seed_messages` 写入 user message 并启动 run | 首发创建时机要与该写入点对齐 |

## 模块详情

### 模块 1：`GenericPendingThreadEntry`

**职责**：把通用频道加号变成“进入空白新对话页”的入口。

**包含范围**：
- `ThreadList` 加号点击
- 设置 pending generic 状态
- 清理旧的 `initialMessage`
- 跳转 `/chat`

**不包含范围**：
- 创建 thread metadata
- 项目候选计算
- 首条消息发送

**依赖**：`useThreadsStore`、React Router。

**边界类 / 门户**：`useThreadsStore` 作为前端状态门户，新增方法建议命名 `startPendingGenericThread`。

**复用/新建**：复用 `ThreadList`，替换 `NewThreadDialog` 在通用 tab 的入口；`NewThreadDialog` 可保留给管理或后续调试入口。

**数据结构/接口**：

```typescript
export interface PendingNewSession {
  // 通道类型；generic_chat 表示通用空白新页
  backendKind: "generic_chat" | "claude_code" | "codex";
  // 选择项目后的 cwd；generic_chat 可为空，后端会解析为用户 home
  cwd: string;
  // 展示名；generic_chat 可为空，后端用首条消息生成 thread name
  projectName: string;
}
```

**风险等级**：低
**风险说明**：主要风险是影响 Claude / Codex 现有 pending 状态，类型扩展需要覆盖回归测试。

**task 建议**：
- 建议 task 名：`generic-new-thread-first-message`
- 对应 DoD：通用频道加号进入空白页
- 是否进入 x-req：是
- 原因：入口边界清楚，依赖少

### 模块 2：`GenericEmptyThreadView`

**职责**：渲染新页面的空白对话体验，提交首条消息。

**包含范围**：
- 居中布局
- 空历史状态
- 复用 `Composer`
- 注入项目选择按钮
- 调用首发创建接口
- 成功后跳转真实 thread
- 失败后保留输入

**不包含范围**：
- 现有 thread 的消息渲染
- workspace tabs
- whiteboard cards
- Claude / Codex pending view

**依赖**：`ChatPage`、`Composer`、`ThreadProjectSelector`、`useThreadsStore`、`useModelProvidersStore`。

**边界类 / 门户**：前端新增组件 `GenericEmptyThreadView`，由 `ChatPage` 在 `pendingNewSession?.backendKind === "generic_chat"` 时唯一调用。

**复用/新建**：新建薄组件，Composer、ModelSwitcher、reasoning 控件继续复用。

**数据结构/接口**：

```typescript
export interface GenericEmptyThreadViewProps {
  // 默认模型 preset，来自当前 model provider store
  defaultPresetId: string;
  // 首发创建成功后的跳转回调
  onCreated(threadId: string): void;
}
```

**风险等级**：中
**风险说明**：当前 `Composer` 的附件上传依赖 `threadId`，空白页首发图片需要后续专门设计。MVP 让附件入口保持禁用，文本首发先闭环。

**task 建议**：
- 建议 task 名：`generic-new-thread-first-message`
- 对应 DoD：空白页居中 Composer、项目按钮只在新页出现
- 是否进入 x-req：是
- 原因：UI 结构明确

### 模块 3：`ThreadProjectSelector`

**职责**：从当前已存在 thread 派生项目候选，并提供“选择新项目 / 不需要项目”两个操作项，用户选择后输出 cwd。

**包含范围**：
- 去重 cwd
- 排除空 cwd、相对路径、缺字段老 thread
- 展示项目名和路径 tooltip
- “选择新项目”打开系统文件夹选择器，成功选择后把目录绝对路径作为 cwd
- “不需要项目”选项
- 把空选择映射为后端用户 home

**不包含范围**：
- 扫描磁盘项目
- 修改已有 thread metadata

**依赖**：`ThreadMetadataDTO.cwd`、`isAbsoluteProjectPath`、`DropdownMenu`、宿主文件夹选择能力。

**边界类 / 门户**：`ThreadProjectSelector` 组件；候选计算抽成纯函数 `deriveThreadProjectOptions(threads)`。

**复用/新建**：新建组件，复用当前 UI `DropdownMenu` 和 lucide `Folder` 图标。

**数据结构/接口**：

```typescript
export interface ThreadProjectOption {
  // cwd 绝对路径，选择后直接传后端
  cwd: string;
  // UI 展示名，默认取路径 basename
  label: string;
  // 完整路径 tooltip
  title: string;
  // 候选来源 thread 数量，展示重复项目来源
  threadCount: number;
  // 候选来源：已有 thread、用户选择的新目录、不需要项目
  source: "existing_thread" | "file_picker" | "none";
}
```

**风险等级**：低
**风险说明**：路径展示可能遇到同名目录，UI 需要 tooltip 或二级路径消歧。

**task 建议**：
- 建议 task 名：`generic-new-thread-first-message`
- 对应 DoD：项目候选从有效 cwd 派生、选择新项目可打开文件夹选择器、未选择项目走 home
- 是否进入 x-req：是
- 原因：纯前端派生，可用单测覆盖

### 模块 4：`FirstMessageThreadCreator`

**职责**：后端在首条 user message 持久化成功时创建业务可见 thread，并启动后续 generic run。

**包含范围**：
- 校验首发请求
- 校验 preset
- 解析 cwd
- 持久化第一条 user message
- 写入业务可见 thread metadata
- 启动或衔接 LLM run
- 失败回滚，避免空 thread
- 返回 `ThreadMetadataDTO`

**不包含范围**：
- 旧 session 迁移
- Claude / Codex provider session 创建
- thread 列表排序策略重写

**依赖**：`ThreadManager`、`write_thread_metadata`、session backend、`SessionBridge` / `SessionEngine`。

**边界类 / 门户**：`ThreadManager.create_generic_thread_from_first_message(...)`。路由层只调用这个门户方法。

**复用/新建**：复用 `ThreadManager.create_thread` 的 metadata 构造和路径校验；新增首发原子化门面，避免路由层散装写 metadata + session。

**数据结构/接口**：

```python
class CreateGenericThreadFromFirstMessageRequest(_FrameBase):
    text: Annotated[str, Field(min_length=1)]
    preset_id: Annotated[str, Field(min_length=1)]
    cwd: str = ""
    reasoning_effort: Literal["low", "medium", "high"] | None = None
    attachments: list[UserInputAttachment] | None = None

class CreateGenericThreadFromFirstMessageResponse(_FrameBase):
    thread: ThreadMetadataDTO
```

**风险等级**：高
**风险说明**：当前 generic WS 先要求已有 `thread_id`，而 `Runner._seed_messages` 内部负责 user message append。需要把“返回真实 thread 前 user message 已落盘”和“后续 LLM 流继续接入现有 WS”打通，建议先写后端单测固定时序。

**task 建议**：
- 建议 task 名：`generic-new-thread-first-message`
- 对应 DoD：返回 thread 前首条 user message 已落盘、失败不产生空 thread
- 是否进入 x-req：是
- 原因：业务规则已确认，技术风险可用 PoC 降低

### 模块 5：`GenericFirstMessageProtocol`

**职责**：统一前后端首发创建请求、响应、错误语义。

**包含范围**：
- Python DTO
- TS interface
- route path
- 错误码和 UI toast 映射
- 协议 round-trip 测试

**不包含范围**：
- 现有 `CreateThreadRequest` 的语义变更
- WS 帧 discriminated union 修改

**依赖**：`src/hosts/web/protocol/rest_models.py`、`web/src/protocol.ts`。

**边界类 / 门户**：REST endpoint 建议为 `POST /api/threads/generic/first-message`。

**复用/新建**：新增 DTO，不改 `CreateThreadRequest`，让旧创建入口和首发创建入口语义清晰分离。

**数据结构/接口**：

```typescript
export interface CreateGenericThreadFromFirstMessageRequest {
  // 用户第一句话，trim 后必须非空
  text: string;
  // 通用频道模型 preset
  preset_id: string;
  // 选择项目后的绝对 cwd；空字符串表示后端使用用户 home
  cwd?: string;
  // Composer 的 reasoning 选项
  reasoning_effort?: "low" | "medium" | "high" | null;
  // 预留，MVP 空白页首发附件暂不启用
  attachments?: UserInputAttachment[];
}

export interface CreateGenericThreadFromFirstMessageResponse {
  // 创建完成的真实 thread metadata
  thread: ThreadMetadataDTO;
}
```

**风险等级**：中
**风险说明**：需要同步 Python / TS 协议，避免字段名漂移。

**task 建议**：
- 建议 task 名：`generic-new-thread-first-message`
- 对应 DoD：协议类型同步、失败提示正确
- 是否进入 x-req：是
- 原因：可独立测试
