# 数据模型与状态

## 核心实体

```typescript
interface ChoiceRequest {
  requestId: string;                // 选择请求 ID，默认等于 tool call_id
  title: string;                    // 面板标题
  description: string;              // 功能与使用场景说明
  questions: ChoiceQuestion[];       // 问题列表，按顺序展示
  runId: string;                    // 触发请求的 run ID
  turn: number;                     // 触发请求的 turn
  createdAtMs: number;              // 请求创建时间，Unix 毫秒
}

interface ChoiceQuestion {
  id: string;                       // 问题稳定 ID
  title: string;                    // 问题标题
  description?: string | null;       // 问题补充说明
  options: ChoiceOption[];           // LLM 提供的选项，不含系统自定义选项
}

interface ChoiceOption {
  id: string;                       // 选项稳定 ID
  label: string;                    // 选项标题
  description: string;              // 选项说明
  value?: Record<string, unknown>;   // 结构化值，确认时原样回传
}

interface ChoiceAnswer {
  questionId: string;               // 对应问题 ID
  optionId: string;                 // 选项 ID，系统自定义选项固定为 "__custom__"
  optionLabel: string;              // 选项标题，便于回传文本阅读
  customText?: string | null;        // 自定义答案文本
  value?: Record<string, unknown>;   // 选项结构化值
}

interface ChoiceState {
  request: ChoiceRequest;            // 当前选择请求
  currentQuestionIndex: number;      // 当前展示的问题下标，从 0 开始
  answersByQuestionId: Record<string, ChoiceAnswer>; // 草稿答案字典
  status: "active" | "submitting" | "submitted" | "failed"; // UI 状态
}
```

## 实体关系

数据关系图见 `./diagrams.md#choice-ui`。

## 状态流转

```text
idle → active → submitting → submitted
                 ↓
               failed → active
```

- `idle`：当前无选择请求。
- `active`：展示请求，允许选择和修改。
- `submitting`：用户点击确定，等待发送结果。
- `submitted`：发送成功，清空面板。
- `failed`：发送失败或后端拒绝，保留草稿答案。

状态图见 `./diagrams.md#choice-ui`。

## 持久化方案

| 数据 | 存储方式 | 位置 | 备注 |
|------|---------|------|------|
| ChoiceRequest | 内存 | 前端 ChoiceManager | 首版不持久化 |
| ChoiceState | 内存 | React state / hook | thread 切换时清空 |
| ChoiceSubmitFrame | WebSocket | 当前 generic channel | 不单独落盘 |
| 选择结果文本 | Session history | 现有 session 存储 | 作为普通 user message |

## 共享数据结构

```typescript
const CUSTOM_OPTION_ID = "__custom__"; // 系统自定义选项 ID，所有问题固定使用
```

```python
CUSTOM_OPTION_ID = "__custom__"  # 系统自定义选项 ID，后端校验和格式化共用
```
