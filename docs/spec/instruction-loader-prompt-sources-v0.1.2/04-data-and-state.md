# Data And State

> 当前状态说明：当前主链还没有集成 `InputAssembler`
> 阅读约定：标注“当前代码”的段落描述现状；未标注“当前代码”的 build / assemble / metadata / compactor 行为都按 `v0.1.2` 目标状态理解

## 核心数据结构

### 1. InstructionSource

当前建议保持最小结构：

```python
@dataclass(frozen=True)
class InstructionSource:
    origin: str
    content: str
```

字段语义：

| 字段 | 类型 | 说明 |
|------|------|------|
| `origin` | `str` | 来源标识，如 `agent_spec` / `file:rules.md` / `env:KONGMING_EXTRA_INSTRUCTIONS` |
| `content` | `str` | 原始文本内容 |

当前不引入：
- `kind`
- `status`
- `metadata`

### InstructionSource 示例

#### 来源 1：`agent_spec`

```python
InstructionSource(
    origin="agent_spec",
    content="You are kongming agent.\n优先给出直接答案，再补必要上下文。",
)
```

按唯一 render 规则导出的 prompt 片段：

```text
# agent_spec
You are kongming agent.
优先给出直接答案，再补必要上下文。
```

#### 来源 2：`extra_files`

假设 CLI 传入：

```bash
--instructions-file rules.md
```

文件内容：

```text
涉及 shell 命令时，先解释意图，再给命令。
输出保持中文。
```

加载后的完整字段：

```python
InstructionSource(
    origin="file:rules.md",
    content="涉及 shell 命令时，先解释意图，再给命令。\n输出保持中文。\n",
)
```

按唯一 render 规则导出的 prompt 片段：

```text
# file:rules.md
涉及 shell 命令时，先解释意图，再给命令。
输出保持中文。
```

#### 来源 3：`environment`

假设环境变量：

```bash
export KONGMING_EXTRA_INSTRUCTIONS="回答里不要省略风险和前置条件。"
```

加载后的完整字段：

```python
InstructionSource(
    origin="env:KONGMING_EXTRA_INSTRUCTIONS",
    content="回答里不要省略风险和前置条件。",
)
```

按唯一 render 规则导出的 prompt 片段：

```text
# env:KONGMING_EXTRA_INSTRUCTIONS
回答里不要省略风险和前置条件。
```

#### 三类来源合并后的 `InstructionSource[]`

```python
[
    InstructionSource(
        origin="agent_spec",
        content="You are kongming agent.\n优先给出直接答案，再补必要上下文。",
    ),
    InstructionSource(
        origin="file:rules.md",
        content="涉及 shell 命令时，先解释意图，再给命令。\n输出保持中文。\n",
    ),
    InstructionSource(
        origin="env:KONGMING_EXTRA_INSTRUCTIONS",
        content="回答里不要省略风险和前置条件。",
    ),
]
```

### 2. AssembledInput

```python
@dataclass(frozen=True)
class AssembledInput:
    system_message: Message | None
    messages: list[Message]
    metadata: dict[str, Any]
```

字段语义：

| 字段 | 类型 | 说明 |
|------|------|------|
| `system_message` | `Message \| None` | 本次是否新增了一条 system |
| `messages` | `list[Message]` | 最终传给 provider 的完整消息序列 |
| `metadata` | `dict[str, Any]` | 装配统计和调试信息 |

### 2.1 InputAssembler 当前签名

当前代码签名：

```python
async def assemble(
    history: Sequence[Message],
    instructions: Sequence[InstructionSource] = (),
    *,
    instruction_loader: InstructionLoader | None = None,
) -> AssembledInput
```

参数语义：

| 参数 | 类型 | 当前语义 |
|------|------|----------|
| `history` | `Sequence[Message]` | 当前 session 历史 |
| `instructions` | `Sequence[InstructionSource]` | 已加载好的来源列表 |
| `instruction_loader` | `InstructionLoader \| None` | 只借用 `render(...)`，不在 assemble 阶段重新做 `load()` I/O |

设计原因：

- 调用方传 `InstructionSource[]`，装配阶段继续持有 render 能力
- `InputAssembler` 自己决定何时真正需要 `system_text`
- render 规则仍然集中在一处，调用方不需要先预渲染再传字符串
- assemble 阶段避免重新做文件和环境变量 I/O

### 3. SessionBootstrap

与 prompt build 直接相关的字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `instruction_sources` | `list[str]` | 本次 build 参与来源的 origin 列表 |
| `instruction_text_hash` | `str` | 渲染后完整 system 文本的 sha256 |

补充约束：

- hash 输入文本是“按唯一 render 规则导出的完整 system prompt”
- hash 算法固定为 `sha256`
- 编码固定为 UTF-8
- 当前 CLI 代码等价于 `sha256(rendered_text.encode("utf-8"))`
- 当前执行位置在 CLI
- 目标状态要求的是“render 规则一致”，不要求“只有 InputAssembler 自己计算 hash”

## 完整 build 示例

下面的例子展示的是**`v0.1.2` 目标状态**下的一轮完整 build 中间态和最终态。

### Step 1：输入来源

```python
sources = [
    InstructionSource(
        origin="agent_spec",
        content="You are kongming agent.\n优先给出直接答案，再补必要上下文。",
    ),
    InstructionSource(
        origin="file:rules.md",
        content="涉及 shell 命令时，先解释意图，再给命令。\n输出保持中文。\n",
    ),
    InstructionSource(
        origin="env:KONGMING_EXTRA_INSTRUCTIONS",
        content="回答里不要省略风险和前置条件。",
    ),
]
```

### Step 2：按唯一规则渲染后的完整 system prompt

这里的关键约束是：这段文本虽然可以由 helper 渲染出来做 hash，但规则定义只属于 `InputAssembler`，不能在 CLI 侧另写一套拼接逻辑。

按唯一 render 规则导出的结果：

```text
# agent_spec
You are kongming agent.
优先给出直接答案，再补必要上下文。

# file:rules.md
涉及 shell 命令时，先解释意图，再给命令。
输出保持中文。

# env:KONGMING_EXTRA_INSTRUCTIONS
回答里不要省略风险和前置条件。
```

### Step 3：bootstrap 记录

```python
SessionBootstrap(
    agent_name="kongming-agent",
    model_name="gemma-4-e4b-it",
    instruction_sources=[
        "agent_spec",
        "file:rules.md",
        "env:KONGMING_EXTRA_INSTRUCTIONS",
    ],
    instruction_text_hash="sha256:7f0b5f4f5d8a1b9b5c6d7e8f90123456789abcdef0123456789abcdef012345",
    created_at=1776780000.0,
    cwd="/Volumes/machub_app/proj/kongming-agent",
    app_version=None,
)
```

说明：

- `instruction_sources` 只记录 `origin`
- `instruction_text_hash` 针对渲染后的完整文本，不针对单条 source
- bootstrap 不定义 prompt 组成规则，只记录由唯一规则导出的结果
- 目标状态下 `instruction_sources` 与 `AssembledInput.metadata["instruction_sources"]` 在首轮应保持同一份 origin 列表
- 这份一致性来自同一份 `sources` 列表被同时用于 bootstrap 记录和 assembler 装配
- 首轮若不一致，应视为 wiring bug

### Step 4：history 输入

```python
history = [
    Message.user("帮我看看当前 prompt build 链路"),
    Message.assistant("当前链路分为来源收集、render、bootstrap 回填和 system 注入四步。"),
]
```

### Step 5：最终 `AssembledInput`

下面描述的是**目标状态**。假设当前 history 里还没有 `system` 消息，`InputAssembler.assemble(...)` 的结果应接近：

```python
AssembledInput(
    system_message=Message.system(
        "# agent_spec\n"
        "You are kongming agent.\n"
        "优先给出直接答案，再补必要上下文。\n\n"
        "# file:rules.md\n"
        "涉及 shell 命令时，先解释意图，再给命令。\n"
        "输出保持中文。\n\n"
        "# env:KONGMING_EXTRA_INSTRUCTIONS\n"
        "回答里不要省略风险和前置条件。"
    ),
    messages=[
        Message.system(
            "# agent_spec\n"
            "You are kongming agent.\n"
            "优先给出直接答案，再补必要上下文。\n\n"
            "# file:rules.md\n"
            "涉及 shell 命令时，先解释意图，再给命令。\n"
            "输出保持中文。\n\n"
            "# env:KONGMING_EXTRA_INSTRUCTIONS\n"
            "回答里不要省略风险和前置条件。"
        ),
        Message.user("帮我看看当前 prompt build 链路"),
        Message.assistant("当前链路分为来源收集、render、bootstrap 回填和 system 注入四步。"),
    ],
    metadata={
        "original_count": 2,
        "compacted_count": 2,
        "added_system": True,
        "instruction_sources": [
            "agent_spec",
            "file:rules.md",
            "env:KONGMING_EXTRA_INSTRUCTIONS",
        ],
        "attachments": [],
    },
)
```

### Step 6：provider 最终消费的 messages

provider 最终看到的 messages 顺序：

```text
1. system   -> render 后的完整 prompt
2. user     -> 帮我看看当前 prompt build 链路
3. assistant -> 当前链路分为来源收集、render、bootstrap 回填和 system 注入四步。
```

如果 history 里已经存在 `system`，则：

- `system_message = None`
- `added_system = False`
- `messages` 不会再重复插入第二条 system

如果这是第二轮对话，且 history 第一条已经是上一轮留下的 `system`，行为仍然一样：

- `InputAssembler` 检测到已有 `system`
- 不重新追加新的 `system`
- 直接对现有 history 做 compact，再把 compact 结果送给 provider

## 状态流

### 当前状态流

```text
InstructionLoader.load(...)
  -> InstructionSource[]
  -> CLI side render
  -> instructions: str
  -> sha256(instructions.encode("utf-8"))
  -> SessionBootstrap(instruction_sources, instruction_text_hash)
  -> SessionEngine.build(instructions=instructions)
  -> AgentSpec.instructions
  -> Runner._seed_messages()
```

### v0.1.2 目标状态流

```text
InstructionLoader.load(...)
  -> InstructionSource[]
  -> SessionBootstrap(instruction_sources, instruction_text_hash)
  -> Runner/InputAssembler.assemble(history, instruction_sources, instruction_loader=None)
  -> render system text
  -> AssembledInput.messages
  -> provider.complete(...)
```

补充说明：

- 当前状态流描述的是今天代码已经生效的链路
- `v0.1.2` 目标状态流描述的是接线完成后的目标链路
- 两段不能混读

## metadata 建议字段

下面描述的是**当前 `InputAssembler` 代码已经包含**的 metadata 字段：

`AssembledInput.metadata` 至少应包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `original_count` | `int` | 原始 history 长度 |
| `compacted_count` | `int` | compact 后长度 |
| `added_system` | `bool` | 是否新增 system |
| `instruction_sources` | `list[str]` | 本轮实际参与装配的 origin 列表 |
| `attachments` | `list[Any]` | 当前固定为空，占未来扩展位 |

## 文件来源边界表

| 情况 | 当前实现 | `v0.1.2` 文档要求 |
|------|----------|-------------------|
| 文件不存在 | 跳过 | 写清楚为跳过 |
| 文件存在但为空 | 跳过 | 写清楚为跳过 |
| 文件存在且全空白 | 跳过 | 写清楚为跳过 |
| `OSError` | 跳过 | 写清楚为跳过 |
| `UnicodeDecodeError` | 冒泡，中断 CLI 主流程 | `v0.1.2` 正式契约：冒泡 |

## compactor 协调规则

下面描述的是**目标状态**下 `HistoryCompactor` 和 `InputAssembler` 的协调约束：

- `InputAssembler` 先对传入的原始 `history` 做 system 存在性判断
- `InputAssembler` 再调用 `HistoryCompactor.compact(history)` 得到第二份 compact 后消息列表
- 若 compact 结果删掉了已有 system，`InputAssembler` 也不在同一轮重新补一条
- compactor 的职责是裁剪历史
- assembler 的职责是基于输入 history 判定本轮是否新增 system

这个约束可以避免“compactor 删 system -> assembler 立刻重补 -> 下轮再删”的循环震荡。

## instruction_sources 为空时的保证

下面描述的是**通用接口边界**，不描述当前 CLI 默认路径。

当 `InstructionSource[]` 为空时：

- render 结果为空字符串
- `instruction_text_hash` 基于空字符串计算（`sha256("".encode("utf-8"))`）
- `InputAssembler` 不新增 `system`
- `metadata["instruction_sources"]` 为 `[]`
- provider 只消费 compact 后 history

补充说明：

- 当前 CLI 默认调用 `loader.load("You are kongming agent.")`
- 当前 CLI 默认路径至少会生成一条 `agent_spec` source
- 空 `InstructionSource[]` 场景更适合覆盖通用 API、测试和未来 host 扩展路径

`v0.1.2` 空 sources 的 hash 策略已定：基于空字符串计算，需在测试里锁死。

## 关键状态约束

- `InstructionSource[]` 是 build 入口数据
- prompt 组成规则只允许定义在 `InputAssembler`
- `instruction_text_hash` 必须来自与 `InputAssembler` 相同规则导出的完整文本
- `messages` 是 provider 唯一消费的最终结果
- 已有 system 时，不能在 build 过程中重复插入第二条 system
- metadata 只记录 build 过程，不回写业务消息内容
