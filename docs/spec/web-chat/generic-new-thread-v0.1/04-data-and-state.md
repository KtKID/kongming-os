# 数据模型与状态

## 核心实体

```typescript
export interface PendingNewSession {
  // 通道类型；generic_chat 表示通用频道空白新页
  backendKind: "generic_chat" | "claude_code" | "codex";
  // 选择项目后的 cwd；空字符串交给后端解析为用户 home
  cwd: string;
  // 项目展示名；generic_chat 可为空
  projectName: string;
}

export interface ThreadProjectOption {
  // cwd 绝对路径，选择后作为新 thread cwd
  cwd: string;
  // UI 展示名，默认取路径 basename
  label: string;
  // 完整路径，作为 tooltip 和消歧信息
  title: string;
  // 有多少个已有 thread 指向该 cwd
  threadCount: number;
}

export interface CreateGenericThreadFromFirstMessageRequest {
  // 用户第一句话，trim 后必须非空
  text: string;
  // 通用频道模型 preset id
  preset_id: string;
  // 选择项目后的绝对 cwd；空字符串表示后端使用用户 home
  cwd?: string;
  // Composer 的 reasoning 选项
  reasoning_effort?: "low" | "medium" | "high" | null;
  // 预留字段；MVP 空白页首发附件入口保持禁用
  attachments?: UserInputAttachment[];
}

export interface CreateGenericThreadFromFirstMessageResponse {
  // 创建完成后的真实 thread metadata
  thread: ThreadMetadataDTO;
}
```

```python
class GenericFirstMessageCreateResult(NamedTuple):
    # 创建完成后的 metadata
    meta: ThreadMetadata
    # 后续 run 是否已经启动或排队
    run_started: bool
```

## 实体关系

`PendingNewSession` 是前端临时状态；`ThreadProjectOption` 从现有 `ThreadMetadataDTO` 派生；`CreateGenericThreadFromFirstMessageRequest` 把用户首条消息、preset 和 cwd 交给后端；后端持久化 `ThreadMetadata` 与 session 第一条 `Message.user` 后返回 `ThreadMetadataDTO`。ER 图见 `diagrams.html` §数据。

## 状态流转

状态图见 `diagrams.html` §状态。

```text
idle
  -> pending_generic_blank
  -> first_message_submitting
  -> thread_created
  -> existing_generic_thread

first_message_submitting
  -> create_failed
  -> pending_generic_blank
```

## 持久化方案

| 数据 | 存储方式 | 位置 | 备注 |
|------|---------|------|------|
| pending generic 状态 | 前端内存 store | `useThreadsStore.pendingNewSession` | 刷新页面后可回到普通 `/chat` 空态 |
| 项目候选 | 派生数据 | `useThreadsStore.threads` | 不落盘，不扫描磁盘 |
| thread metadata | JSON 文件 | `<kongming_home>/web/threads/<thread_id>/metadata.json` | 通过 `ThreadManager` 写入 |
| 第一条 user message | session backend | 默认 `<kongming_home>/sessions/<thread_id>/...jsonl` | 通过 session append 写入 |
| 后续 LLM 输出 | session backend + WS | 现有 generic run 链路 | 复用现有 runtime |

## 共享数据结构

### 项目候选派生规则

```typescript
export function deriveThreadProjectOptions(
  threads: ThreadMetadataDTO[],
): ThreadProjectOption[] {
  // 1. 只取 cwd.trim() 非空的 thread
  // 2. cwd 必须满足 isAbsoluteProjectPath
  // 3. 按规范化 cwd 去重
  // 4. updated_at 最新的项目靠前
  // 5. 老 thread 缺 cwd 或 cwd 无效时排除
}
```

### cwd 解析规则

| 输入 | 后端解析结果 | 说明 |
|------|--------------|------|
| 有效绝对路径 | 原路径规范化结果 | 用户选择已有项目 |
| 空字符串 / 未传 | `Path.home().resolve()` | 用户选择“不需要项目”或保持默认 |
| 相对路径 | 400 | 协议错误 |
| 不存在路径 | P1 可提示 | MVP 可先允许绝对路径，由后续 workspace 面板处理可用性 |

### thread 命名规则

MVP 建议用第一条用户消息生成名字：trim 后取前 40 个可显示字符，空文本由校验拒绝；后续可接 LLM 自动标题。
