# Module Breakdown

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| Instruction Source Collection | 收集 `agent_spec` / `extra_files` / `env` 三类来源 | 无 | 方案确认 | 代码已存在，来源契约仍需补测试钉死 |
| Prompt Build Assembly | 把 system prompt 与 history 组装成 provider 最终输入 | Instruction Source Collection, History Compactor | 方案确认 | `InputAssembler` 已存在，主链未接通 |
| Runtime Wiring | 把 build 链接到 CLI / runtime / runner / bootstrap | Prompt Build Assembly | 探索中 | 当前链路分散在 CLI 和 runner 两侧 |
| Validation And Observability | 定义测试矩阵、metadata、trace 验证点 | 上述全部 | 可进入 x-req | 主要是测试补齐和事件断言 |

## 模块详情

### 模块 1：Instruction Source Collection
**职责**：定义 instruction 来源集合、顺序、缺失语义。

**包含范围**：
- `InstructionSource`
- `InstructionLoader.load(...)`
- `KONGMING_EXTRA_INSTRUCTIONS`
- 来源顺序和 origin 规则

**不包含范围**：
- history 读取
- provider messages 组装
- bootstrap 持久化

**依赖**：无

**风险与讨论点**：
- 读取失败语义当前和文档仍有偏差
- `UnicodeDecodeError` 已定案：冒泡（`v0.1.2` 正式契约），需要补测试锁死
- `origin=f"file:{path.name}"` 存在同名文件冲突的已知限制，需要在文档里显式记录

**task 建议**：
- 建议 task 名：`prompt-source-loader-contracts`
- 是否进入 x-req：是
- 原因：边界清楚，改动集中

### 模块 2：Prompt Build Assembly
**职责**：把 `InstructionSource[]`、history、history compaction 合成最终 provider input。

**包含范围**：
- `InputAssembler`
- `AssembledInput`
- render 规则
- `system_message` 生成规则
- metadata 结构
- `HistoryCompactor` 接入位置

**不包含范围**：
- 来源发现
- bootstrap 落盘
- provider 调用本身

**依赖**：Instruction Source Collection

**风险与讨论点**：
- runner 现有 `_seed_messages()` 逻辑需要和 assembler 统一，避免重复 system
- `InputAssembler.assemble(...)` 当前保留 `instruction_loader` 参数，只借用 `render(...)`，其长期形态需要决定是继续保留还是抽成独立 render helper
- assembled metadata 是否需要进 trace event 还未定

**task 建议**：
- 建议 task 名：`prompt-build-assembler-wiring`
- 是否进入 x-req：是
- 原因：目标明确，当前可以先推进 assembler 侧契约、接口和测试

### 模块 3：Runtime Wiring
**职责**：把 host 收集的 sources、bootstrap 记录、runner 侧 prompt build 串成单向数据流。

**当前阶段说明**：
- 这个模块已经进入 `v0.1.2` 方案范围
- 当前阶段先定义目标链路和迁移条件
- x-req / 实现 task 留到开放问题收敛后再开

**包含范围**：
- CLI 收集 sources
- `instruction_sources` / `instruction_text_hash` 计算
- `SessionEngine.build()` 的装配参数
- runner 消费 assembled messages 的入口

**不包含范围**：
- 新增 instruction 来源
- attachments 扩展

**依赖**：Instruction Source Collection、Prompt Build Assembly

**风险与讨论点**：
- bootstrap 如何拿到与 assembler 同步的 hash，需要定下唯一出口
- `AgentSpec.instructions` 角色已定（见 README 兼容与替换语义）：只有 history 中已有 system 时 InputAssembler 才进入替代，最终退化为向 InstructionLoader 传文本的入口
- `_seed_messages()` 的职责迁移顺序需要写清楚，避免过渡期双重注入

**task 建议**：
- 建议 task 名：`prompt-runtime-build-flow`
- 是否进入 x-req：否
- 原因：`v0.1.2` 已经把目标链路和 `AgentSpec.instructions` 定位写进方案，实现 task 等待 bootstrap hash 出口收敛后再开

### 模块 4：Validation And Observability
**职责**：定义并验证单测、集成测试、trace / metadata 的预期。

**包含范围**：
- InstructionLoader 单测矩阵
- InputAssembler 单测矩阵
- CLI/runtime/runner 集成测试矩阵
- bootstrap / manifest / trace 验证点

**不包含范围**：
- 业务功能实现

**依赖**：上述全部

**风险与讨论点**：
- 需要避免测试只验证字符串渲染，不验证真实接线落点

**task 建议**：
- 建议 task 名：`prompt-build-test-matrix`
- 是否进入 x-req：是
- 原因：边界稳定，可独立推进
