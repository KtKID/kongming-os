# Instruction Loader Prompt Assembly v0.1.2

> 状态：方案确认中
> 目标：把 instruction 来源收集、prompt build、runtime 接线和测试矩阵整理成一条可实现的统一方案

## 目标

把 `InstructionLoader prompt sources` 从“来源说明文档”升级为 `v0.1.2` 的完整 build 文档，回答 5 个实现问题：

1. prompt assembly 的真实职责边界在哪里
2. 现有代码已经接通了哪些链路
3. 还缺哪条 build 链，导致 `InputAssembler` 处于占位
4. `v0.1.2` 应该接哪一层，避免重复装配
5. 测试和实施顺序如何落地

这份文档的目标是直接指导后续实现，不再停留在 `InstructionLoader` 三类来源的局部定义。

## 系统目标

把当前分散在 CLI、`SessionEngine.build()`、`Runner._seed_messages()`、`HistoryCompactor`、`InputAssembler` 之间的 prompt 组装职责整理成一条清晰、单向、可测试的 build 链。

这个系统方案回答 5 个问题：

1. instruction 来源从哪里收集
2. 谁负责把来源渲染成 system prompt
3. 谁负责把 system prompt 与 history 组装成模型最终输入
4. 谁负责把来源和 hash 持久化到 bootstrap / session
5. 哪些模块可以先进入 x-req

## 范围边界

**包含**：
- `InstructionLoader` 的来源定义、顺序、失败语义
- `InputAssembler` 的职责定义和主链接入位置
- CLI / host / runtime / runner 的 prompt build 边界
- `instruction_sources` / `instruction_text_hash` 的权威来源和持久化路径
- prompt assembly 的核心测试矩阵

**不包含**：
- 自动发现 `.claude/CLAUDE.md`
- 自动发现 `.cursorrules`
- skill-specific instruction 分层
- project-only 自动规则发现
- attachments 真正进入 provider 输入
- 宿主动态上下文来源
- token 预算驱动的 prompt 裁剪策略

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| Instruction Source Collection | 方案确认 | [./02-module-breakdown.md](./02-module-breakdown.md) | 是 | 三类来源已实现，行为契约需要钉死 |
| Prompt Build Assembly | 方案确认 | [./02-module-breakdown.md](./02-module-breakdown.md) | 是 | `InputAssembler` 已存在，主链未接通 |
| Runtime Wiring | 探索中 | [./02-module-breakdown.md](./02-module-breakdown.md) | 否 | `AgentSpec.instructions` 的最终定位还没定 |
| Validation And Observability | 可进入 x-req | [./05-validation-and-evolution.md](./05-validation-and-evolution.md) | 是 | 测试矩阵和验证点已经足够稳定 |

## 文档导航

- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [数据与状态](./04-data-and-state.md)
- [验证与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前状态结论

当前仓库已经接通了下面这条真实链路：

1. `cli/main.py` 调用 `InstructionLoader.load(...)`
2. `cli/main.py` 调用 `InstructionLoader.render(...)`
3. CLI 把渲染后的完整文本传给 `SessionEngine.build(instructions=...)`
4. `SessionEngine.build()` 把文本写入 `AgentSpec.instructions`
5. `Runner._seed_messages()` 在 session 首轮把它注入为 `system` 消息
6. CLI 同时把 `instruction_sources` 和 `instruction_text_hash` 写入 `SessionBootstrap`
7. `FileSession` 把这两个字段持久化到 `manifest.json`

这 7 步描述**当前代码事实**。

当前还没有接通的是统一的 prompt assembly build：

- `InputAssembler` 还没有进入 CLI → SessionEngine → Runner 主链
- `system + compacted history + future attachments` 还没有统一收口到一个 build 入口
- `InstructionLoader` 的来源语义和 `InputAssembler` 的装配职责仍然分离在两套文档里

所以 `v0.1.2` 的核心目标不是“新增来源”，而是“把 prompt build 的权责、接线和测试矩阵一次写清楚”，并把 prompt 组成规则收口到一个修改点。

下面标注为“目标状态”的内容描述的是 `v0.1.2` 设计目标。

## v0.1.2 设计结论

### 1. 职责边界

`InstructionLoader` 继续只负责**收集静态 instruction 来源**。

它负责：

- 接 `agent_spec` 传入的基础 instructions
- 接调用方显式传入的 `extra_files`
- 接环境变量 `KONGMING_EXTRA_INSTRUCTIONS`
- 产出 `InstructionSource[]`
- 产出稳定顺序的 `InstructionSource[]`

它不负责：

- 读取 session history
- 决定 system 是否插入到最终 messages
- 处理 history compact
- 拼 attachments / host 临时上下文
- 决定 provider 最终输入

`InputAssembler` 负责**把 `InstructionSource[]` 与 history 组装成模型真正看到的最终输入**，它是唯一的 prompt build 修改点。

它负责：

- 接收 `InstructionSource[]`
- 按唯一规则把 `InstructionSource[]` 渲染成 `system_text`
- 决定是否需要新增 system message
- 调 `HistoryCompactor`
- 产出最终的 `messages` 和装配 metadata

### 2. 权威数据流

`v0.1.2` 需要明确 3 个“权威来源”：

- `InstructionSource[]` 的权威来源：`InstructionLoader.load(...)`
- `instruction_text_hash` 的权威规则：对“与 `InputAssembler` 相同规则”渲染出的 system 文本做 UTF-8 编码后，再做 `sha256`
- provider 最终输入的权威来源：`InputAssembler.assemble(...)` 的返回值

这三个权威来源必须保持单向流动：

`InstructionLoader.load -> rendered system text -> hash -> InputAssembler.assemble -> provider messages`

这里的关键约束是：

- `InstructionLoader.load(...)` 之后不再由 CLI 决定 prompt 组成规则
- prompt 怎么拼、何时加 system、如何和 history 合并，都由 `InputAssembler` 决定
- bootstrap 记录使用同一套 render 规则导出的 hash，不能另起一套拼接逻辑

当前执行位置说明：

- 当前代码里 `instruction_text_hash` 由 CLI 阶段计算
- 当前 CLI 通过 `InstructionLoader.render(...)` 先得到 `instructions: str`，再计算 hash
- `v0.1.2` 约束的是“hash 依赖哪套 render 规则”
- `v0.1.2` 当前文档没有要求“只有 InputAssembler 自己执行 hash 计算”

### 3. 接线位置

`v0.1.2` 的自然接线位置是 runner 的消息准备阶段。

下面描述的是**目标状态链路**，当前代码还没有完成这组接线：

1. host / CLI 负责收集 instruction sources
2. host / CLI 负责记录 `instruction_sources`，并为 bootstrap 写入由同一套 render 规则导出的 `instruction_text_hash`
3. `SessionEngine.build()` 负责把 `InputAssembler` 装进 `Runner`
4. `Runner` 在准备本轮模型输入时，调用 `InputAssembler.assemble(...)`
5. provider 永远消费 `AssembledInput.messages`

原因：

- CLI 继续承担 host 侧“收集来源 + 记录 bootstrap”的职责
- runner 继续承担“真正发给模型什么”的职责
- `InputAssembler` 成为唯一的 prompt build 入口
- 不会出现 CLI 和 runner 两边各拼一半 prompt 的双重装配

目标接口说明：

- 当前 `Runner` 构造路径还没有 `InputAssembler` 参数
- 目标状态需要在 `SessionEngine.build()` 到 `Runner` 的构造链路上新增装配入口
- 入口形式可以是构造参数，也可以是等价的显式注入点
- `v0.1.2` 当前先锁定职责和调用点，具体签名留到实现 task 决定

### 4. v0.1.2 的最小实现范围

`v0.1.2` 进入范围的内容：

- 明确 `InstructionLoader` 三类来源的语义、顺序、缺失处理
- 明确 `InputAssembler` 是 prompt build 的统一入口
- 明确 CLI / host / runtime / runner 各自职责
- 明确 `instruction_sources` / `instruction_text_hash` 已接通的现状
- 明确缺失或读取失败的行为约束
- 明确测试矩阵和实施顺序

`v0.1.2` 当前进入范围的是：

- 把 Runtime Wiring 的目标链路和职责边界写清楚
- 把 `_seed_messages()` 与 `InputAssembler` 的职责迁移顺序写清楚
- 把后续 task 的拆分前提写清楚

`v0.1.2` 不进入范围的内容：

- 自动发现 `.claude/CLAUDE.md`
- 自动发现 `.cursorrules`
- skill-specific 指令分层
- project-only 自动规则发现
- attachments 真正接入模型输入
- 宿主动态上下文来源
- 复杂来源状态机
- token 预算驱动的 prompt 裁剪策略

## 当前实现基线

### 已实现能力

#### 指令来源

`InstructionLoader` 当前已经真正实现了 3 类来源：

1. `agent_spec.instructions`
2. 调用方显式传入的 `extra_files`
3. 环境变量 `KONGMING_EXTRA_INSTRUCTIONS`

#### bootstrap 回填

CLI 当前已经把下面两个字段接到 `SessionBootstrap`：

- `instruction_sources`
- `instruction_text_hash`

`FileSession` 当前也已经把这两个字段落到磁盘。

#### 主链注入

当前的 `system` 注入发生在 `Runner._seed_messages()`，依据是 `AgentSpec.instructions`。

当前完整路径是：

`CLI -> SessionEngine.build(instructions=...) -> AgentSpec.instructions -> Runner._seed_messages()`

### 未实现能力

#### InputAssembler 主链接入

`InputAssembler` 当前只在单测里存在，没有进入真实主链。
`InputAssembler` 的行为说明在本文里主要用于定义目标状态，不代表当前主链已接通。

#### 统一 build 入口

当前 `InstructionLoader.render()` 和 `HistoryCompactor` 分散在 CLI 与 runner 两侧，没有统一的“prompt build 阶段”。

#### InputAssembler 当前签名

当前代码里的签名是：

```python
async def assemble(
    history: Sequence[Message],
    instructions: Sequence[InstructionSource] = (),
    *,
    instruction_loader: InstructionLoader | None = None,
) -> AssembledInput
```

`instruction_loader` 当前只借用 `render(...)`，不在装配阶段执行 `load()`，所以它是一个纯渲染 helper 注入点。

## v0.1.2 行为约束

### 来源顺序

来源顺序固定为：

1. `agent_spec`
2. `extra_files`
3. `environment`

渲染顺序与加载顺序一致。

### 缺失语义

`v0.1.2` 要求文档和实现保持一致，不能混写。

当前实现的真实语义应表述为：

- 文件不存在：跳过
- 环境变量缺失：跳过
- 空文件 / 空白字符串：跳过
- `OSError` 读取失败：跳过
- `UnicodeDecodeError`：冒泡（`v0.1.2` 正式契约）
- CLI 主路径没有兜住这个异常，遇到非法 UTF-8 文件会中断本次启动流程
- 调用方需要自行处理，或在 CLI 层加兜底（`v0.1.2` 当前不要求）

### 渲染语义

渲染输出规则保持：

- 每个来源前加 `# <origin>`
- 来源之间用空行分隔
- 空来源不进入结果

### build 语义

下面描述的是**目标状态 build 语义**，当前主链仍然走 `AgentSpec.instructions -> Runner._seed_messages()`：

`v0.1.2` 的最终 build 语义应是：

- 若 history 中已有 system，`InputAssembler` 不重复追加
- 若 history 中没有 system 且由 sources 渲染出的 `system_text` 非空，则追加一条 system
- history 压缩统一发生在 `InputAssembler`
- provider 只消费装配后的 `messages`
- trace / metadata 能反映：
  - 原始 history 长度
  - compact 后长度
  - 是否追加了 system
  - 使用了哪些 instruction sources

### 兼容与替换语义

`_seed_messages()` 和 `InputAssembler` 的关系需要明确写成分阶段收敛：

- 当前状态：`_seed_messages()` 负责首轮 `system` 注入
- `v0.1.2` 目标接线完成时：`InputAssembler` 接管 `system` 装配；`_seed_messages()` 只保留 user 首条写入，或退化成兼容 fallback
- 最终目标：provider 请求前的消息装配只经过 `InputAssembler`

这个关系是”职责迁移”，不是”再插一层重复装配”。

范围说明：

- 这条职责迁移属于 `v0.1.2` 方案定义范围
- `Runtime Wiring` 实现 task 继续留在后续阶段
- 当前文档先把迁移目标和完成条件写清楚

### AgentSpec.instructions 的长期定位

`v0.1.2` 已经确定：

- InputAssembler 完全接通后，只有 history 中已经存在由 agentspec 来源导出的 system 消息时，InputAssembler 才进入替代角色
- 触发条件：`InputAssembler.assemble()` 检测到 history 已有 system → 不重复追加 → `AgentSpec.instructions` 的直接注入路径退出
- 若 history 为空（首轮新 session），`InputAssembler` 基于 `InstructionSource[]`（含 agent_spec 来源）注入新的 system，`AgentSpec.instructions` 的内容通过 agent_spec source 传递
- 最终：`AgentSpec.instructions` 字段仅作为向 `InstructionLoader` 传入初始文本的入口，不再直接控制 system 注入

### bootstrap 与 runtime metadata 的同步语义

`instruction_sources` 会出现在两处：

- `SessionBootstrap.instruction_sources`：持久化当前 session 启动时的稳定来源 origin 列表
- `AssembledInput.metadata["instruction_sources"]`：记录当前装配实际使用的来源 origin 列表

`v0.1.2` 的约束是：

- 目标状态首轮装配时，两者都从同一份 `InstructionSource[]` 扇出生成
- `SessionBootstrap` 取 `[s.origin for s in sources]`
- `AssembledInput.metadata["instruction_sources"]` 也取 `[s.origin for s in sources]`
- 后续多轮若来源集合不变，metadata 继续复用同一组 origin
- 首轮若出现不一致，应视为 wiring bug，并由集成测试锁死

### 已知限制

- `InstructionLoader` 当前对文件来源使用 `path.name` 生成 `origin`
- 不同目录下同名文件会形成 `file:rules.md` 这样的 origin 冲突
- 当前 loader 会保留两条 `origin` 相同的 `InstructionSource`
- 当前实现没有覆盖、去重或报错逻辑
- `v0.1.2` 把它记录为已知限制
- 后续若要消除冲突，可升级为相对路径或规范化路径标识

## 建议的数据结构

`InstructionSource` 在 `v0.1.2` 仍保持最小结构：

```python
@dataclass(frozen=True)
class InstructionSource:
    origin: str
    content: str
```

这个版本不引入 `kind`、`status`、`metadata`。

原因：

- 真实来源仍然只有 3 类
- 当前问题在接线，不在来源模型表达力
- 先把 build 链打通，再决定是否需要更重的来源状态模型

## build 分层图

```text
host / CLI
  ├─ InstructionLoader.load(...)
  ├─ instruction_sources = [s.origin ...]
  └─ bootstrap(instruction_sources, instruction_text_hash)

SessionEngine.build(...)
  └─ 把 InputAssembler / HistoryCompactor 装给 Runner

Runner
  └─ InputAssembler.assemble(history, instruction_sources, instruction_loader=None)
       ├─ render system text
       ├─ compact history
       └─ output final messages

LLM Provider
  └─ consume assembled messages
```

## 测试矩阵

`v0.1.2` 需要两层测试，而不是只测 `InstructionLoader`：

### A. InstructionLoader 单测

- `agent_spec` 有值时进入 sources
- `extra_files` 中有值文件按顺序进入 sources
- 文件缺失时跳过
- 空文件时跳过
- 环境变量有值时进入 sources
- 环境变量缺失或空白时跳过
- render 规则顺序稳定
- render 结果带 `# origin` 标记
- `UnicodeDecodeError` 冒泡契约：补非法 UTF-8 文件触发冒泡的测试用例

### B. 主链接线 e2e / 集成测试

- 由 `InstructionSource[]` 生成的 system text 符合唯一 render 规则
- session 首条 `system` 消息与渲染结果一致
- `instruction_sources` 和 `instruction_text_hash` 进入 bootstrap / manifest
- `InputAssembler` 接入后，provider 消费的是 assembled messages
- 已有 system 时不重复追加
- compact 后 metadata 正确

现有 [tests/e2e/test_cli_integration.py](/Volumes/machub_app/proj/kongming-agent/tests/e2e/test_cli_integration.py) 可以作为这层测试的起点。

## 实施顺序

建议按 4 步做，不要一口气把所有“更大 prompt 系统”塞进来：

1. **校正文档**
   明确当前已接通链路、bootstrap 现状、失败语义、`InputAssembler` 是唯一 build 修改点。

2. **补 InstructionLoader 行为测试**
   先把来源顺序、缺失处理、来源收集契约钉死。

3. **接通 InputAssembler 主链**
   让 runner 在真正发请求前统一走 `InputAssembler.assemble(...)`。

4. **补主链集成测试**
   验证 assembled messages、bootstrap、system 注入与 compact 行为。

## 当前建议

1. 先对 `Instruction Source Collection` 开 `x-req`，把来源顺序、失败语义和单测补齐
2. 再对 `Prompt Build Assembly` 开 `x-req`，让 `InputAssembler` 进入主链
3. `Runtime Wiring` 继续留在方案层，`AgentSpec.instructions` 定位已确定，等待 bootstrap hash 出口收敛后开实现 task
4. `Validation And Observability` 可以并行进入 `x-req`
