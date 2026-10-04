# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| Choice Tool | 暴露 `present_choices` 工具，校验参数并 emit 选择请求事件 | core EventSink、ToolContext | 可进入 x-req | 工具层保持 host 无关 |
| Choice Protocol | 定义 `choice.request` / `choice.submit` wire 帧和 DTO | Web protocol | 可进入 x-req | 双侧 TS/Python 同步 |
| Choice UI | 在 composer 上方展示逐题选择面板 | Chat 页、Composer 布局 | 可进入 x-req | 静态原型已存在 |
| Choice Submit Bridge | 接收确认结果并转为当前 session 的 user input | WebSocket routes、SessionBridge | 方案确认 | 关键链路风险中 |
| Prompt Guidance | 在 workflow/TOOLS 提示中说明调用场景 | prompts templates | 方案确认 | 让 LLM 自主判断调用 |

## 模块详情

### 模块 1：Choice Tool

**职责**：向 LLM 暴露 `present_choices`，接收选择请求参数，校验后向 EventSink 发出 `choice.requested` 事件。

**包含范围**：
- 工具名称、title、description、JSON schema。
- `questions` 数组校验。
- question id、option id 去重。
- 固定补充 custom option 的语义声明。
- 返回 ToolResult，提示 LLM 等待用户在 UI 中选择。

**不包含范围**：
- WebSocket 发送。
- 用户选择结果等待。
- UI 状态管理。

**依赖**：`core.contracts.EventSink`、`core.contracts.ToolContext`、`tools.runtime.base.BaseBuiltinTool`。

**复用/新建**：新增 `repo:src/tools/builtin/choice_tool.py`；在 `repo:src/tools/__init__.py` 注册进默认 registry。

**数据结构/接口**：

```python
class ChoiceTool(BaseBuiltinTool):
    name = "present_choices"  # LLM 调用的工具名
    title = "向用户展示方案选择"  # 工具短标题，用于模型理解和未来 UI 展示
    description = (
        "当需要用户在多个方案、范围、偏好或下一步动作之间做选择时调用。"
        "工具会在 Web 输入框上方展示多问题单选列表，每个问题固定包含一个自定义输入选项，"
        "用户确认后选择结果会回到当前对话。"
    )
```

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "选择面板标题，说明这组问题的主题。"
    },
    "description": {
      "type": "string",
      "description": "面板说明，描述为什么需要用户选择以及选择结果将用于什么场景。"
    },
    "questions": {
      "type": "array",
      "description": "问题列表，按数组顺序逐题展示。",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "description": "问题稳定 ID，同一次请求内唯一。"
          },
          "title": {
            "type": "string",
            "description": "问题标题，直接展示给用户。"
          },
          "description": {
            "type": "string",
            "description": "问题补充说明，可为空。"
          },
          "options": {
            "type": "array",
            "description": "LLM 提供的候选选项。系统会固定追加自定义输入选项。",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "选项稳定 ID，同一问题内唯一。"
                },
                "label": {
                  "type": "string",
                  "description": "选项标题，短文本。"
                },
                "description": {
                  "type": "string",
                  "description": "选项说明，描述适用场景、取舍或影响。"
                },
                "value": {
                  "type": "object",
                  "description": "可选结构化值，原样回传给 LLM。"
                }
              },
              "required": ["id", "label", "description"]
            },
            "minItems": 1
          }
        },
        "required": ["id", "title", "options"]
      },
      "minItems": 1
    }
  },
  "required": ["title", "description", "questions"]
}
```

**风险等级**：低

**风险说明**：工具本身只做参数校验和事件输出，风险集中在协议与 UI 回传。

**task 建议**：
- 建议 task 名：`web-chat-user-choice-tool-v0.1`
- 对应 DoD：工具列表、参数校验、事件输出
- 是否进入 x-req：是
- 原因：接口形态清晰

### 模块 2：Choice Protocol

**职责**：定义后端到前端的选择请求帧，以及前端确认后的提交帧。

**包含范围**：
- `choice.request` S2C 帧。
- `choice.submit` C2S 帧。
- Python Pydantic 模型和 TypeScript 类型。
- 协议漂移测试。

**不包含范围**：
- 工具参数业务校验。
- UI 渲染。
- session 写入策略。

**依赖**：`repo:src/hosts/web/protocol/ws_frames.py`、`repo:web/src/protocol.ts`。

**复用/新建**：复用现有 `frame_type` discriminated union。

**数据结构/接口**：

```typescript
interface ChoiceRequestFrame {
  frame_type: "choice.request";        // S2C 帧类型，前端按此分发到 Choice UI
  request_id: string;                  // 本次选择请求 ID，默认取 tool call_id
  title: string;                       // 面板标题
  description: string;                 // 功能和使用场景说明
  questions: ChoiceQuestionDTO[];      // 问题数组，按顺序展示
  turn: number;                        // 触发工具调用的 turn
  run_id: string;                      // 当前 run ID
  timestamp_ms: number;                // 服务端发送时间，Unix 毫秒
}

interface ChoiceQuestionDTO {
  id: string;                          // 问题稳定 ID
  title: string;                       // 问题标题
  description?: string | null;          // 问题补充说明
  options: ChoiceOptionDTO[];           // LLM 提供的选项，不含系统自定义选项
}

interface ChoiceOptionDTO {
  id: string;                          // 选项稳定 ID
  label: string;                       // 选项标题
  description: string;                 // 选项说明
  value?: Record<string, unknown>;      // 结构化值，原样回传
}

interface ChoiceSubmitFrame {
  frame_type: "choice.submit";         // C2S 帧类型
  request_id: string;                  // 对应 ChoiceRequestFrame.request_id
  answers: ChoiceAnswerDTO[];           // 用户确认后的答案列表
}

interface ChoiceAnswerDTO {
  question_id: string;                 // 对应问题 ID
  option_id: string;                   // LLM 选项 ID，或 "__custom__"
  option_label: string;                // 选项标题，便于 LLM 直接阅读
  custom_text?: string | null;          // 自定义输入文本，非自定义选项为空
  value?: Record<string, unknown>;      // LLM 选项 value，存在时原样回传
}
```

**风险等级**：中

**风险说明**：`choice.submit` 会触发下一轮对话，需要与现有 `user.input` 运行中状态、interrupt、approval 等帧互不干扰。

**task 建议**：
- 建议 task 名：`web-chat-user-choice-tool-v0.1`
- 对应 DoD：S2C/C2S 双侧合同、协议漂移测试
- 是否进入 x-req：是
- 原因：协议字段已经稳定

### 模块 3：Choice UI

**职责**：在 composer 上方展示当前选择请求，支持逐题选择、step 切换、自定义输入和确认提交。

**包含范围**：
- `ChoicePanel` 组件。
- `ChoiceManager.ts` 作为模块边界，处理 request、draft answers、validation、submit payload。
- 每个问题固定显示 LLM 选项 + 自定义输入选项。
- 上一步、下一步、step 切换、确定按钮状态。
- 移动端布局。

**不包含范围**：
- 持久化选择请求。
- 多个同时选择请求队列。
- 消息气泡内渲染。

**依赖**：`repo:web/src/pages/Chat.tsx`、`repo:web/src/components/Composer.tsx`、`repo:web/src/protocol.ts`。

**复用/新建**：复用当前静态原型视觉方向：`repo:docs/choice-list-prototype.html`。

**数据结构/接口**：

```typescript
class ChoiceManager {
  receive(frame: ChoiceRequestFrame): ChoiceState;          // 接收后创建当前选择状态
  select(questionId: string, optionId: string): ChoiceState; // 选择某个问题的选项
  setCustomText(questionId: string, text: string): ChoiceState; // 设置自定义答案文本
  canSubmit(state: ChoiceState): boolean;                   // 全部问题有效时返回 true
  buildSubmitFrame(state: ChoiceState): ChoiceSubmitFrame;   // 生成确认提交帧
}
```

**风险等级**：中

**风险说明**：composer 区域空间有限，需要保证不遮挡输入框、不影响 Stop/ModelSwitcher/AutoApprovalToggle。

**task 建议**：
- 建议 task 名：`web-chat-user-choice-tool-v0.1`
- 对应 DoD：UI 交互、移动端、可见状态测试
- 是否进入 x-req：是
- 原因：静态原型已验证基本布局

### 模块 4：Choice Submit Bridge

**职责**：接收 `choice.submit`，把答案转为当前 thread 的下一轮 user input，并复用既有 run loop。

**包含范围**：
- WebSocket route 处理 `choice.submit`。
- 将 answers 格式化为稳定 user message 文本。
- 调用现有 `SessionBridge.run_once`。
- 运行中状态处理：当前 run active 时拒绝提交并发 error。

**不包含范围**：
- 新建第二套等待用户输入的 runner。
- 让 tool 同步等待确认。
- 修改 LLM provider。

**依赖**：`repo:src/hosts/web/websocket/routes.py`、`repo:src/hosts/shared/session_bridge.py`。

**复用/新建**：复用 `user.input` 分发链路，新增一个 `choice.submit` 到 `run_once` 的转换函数。

**数据结构/接口**：

```python
def format_choice_submit_as_user_input(frame: ChoiceSubmitFrame) -> str:
    """把结构化选择结果转成模型可读文本，输出作为下一轮 user input。"""
```

输出格式：

```text
用户已完成选择：
request_id: <request_id>

1. <question_id>
- 选项：<option_id> / <option_label>
- 自定义：<custom_text>
```

**风险等级**：中

**风险说明**：提交时机必须避免和仍在运行的 run 并发；首版按“active run 时拒绝提交”处理。

**task 建议**：
- 建议 task 名：`web-chat-user-choice-tool-v0.1`
- 对应 DoD：确认后继续对话、并发拒绝、错误帧
- 是否进入 x-req：是
- 原因：可用现有 run loop 实现

### 模块 5：Prompt Guidance

**职责**：让 LLM 知道何时使用 `present_choices`，并约束问题与选项写法。

**包含范围**：
- `repo:src/prompts/templates/TOOLS.md` 增加工具说明。
- workflow 相关提示中加入“需要用户决策时调用选择工具”。
- 说明 title/description/questions 的写法。

**不包含范围**：
- 强制所有方案讨论都调用工具。
- 替代用户正常文本输入。

**依赖**：prompt templates、tool schema。

**复用/新建**：复用现有 TOOLS 模板。

**风险等级**：低

**风险说明**：提示过强会导致模型频繁打断用户；文案需强调“需要用户明确选择时使用”。

**task 建议**：
- 建议 task 名：`web-chat-user-choice-tool-v0.1`
- 对应 DoD：提示词覆盖、prompt loader 测试
- 是否进入 x-req：是
- 原因：小范围模板更新
