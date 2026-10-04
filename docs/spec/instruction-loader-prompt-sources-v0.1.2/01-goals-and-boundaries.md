# Goals And Boundaries

## 系统目标

把当前分散在 CLI、`SessionEngine.build()`、`Runner._seed_messages()`、`HistoryCompactor` 之间的 prompt 组装职责整理成一条清晰、单向、可测试的 build 链。

这条链要回答 4 个问题：

1. instruction 来源从哪里收集
2. 谁负责把来源渲染成 system prompt
3. 谁负责把 system prompt 与 history 组装成模型最终输入
4. 谁负责把来源信息和 hash 持久化到 session bootstrap

## 包含范围

- `InstructionLoader` 的来源定义、顺序、失败语义
- `InputAssembler` 的职责定义和主链接入位置
- CLI / host / runtime / runner 的 prompt build 边界
- `instruction_sources` / `instruction_text_hash` 的权威来源和持久化路径
- prompt assembly 的核心测试矩阵

## 不包含范围

- 自动发现 `.claude/CLAUDE.md`
- 自动发现 `.cursorrules`
- skill-specific instruction 分层
- project-only 规则自动发现
- attachments 真正进入 provider 输入
- 宿主动态上下文来源
- token 精算与预算裁剪
- LLM 摘要式 compaction

## 边界原则

### 原则 1：来源收集和最终组装分层

- `InstructionLoader` 只做来源收集
- `InputAssembler` 只做最终 messages 组装

### 原则 2：prompt build 修改点唯一

- `InstructionSource[]` 的权威来源是 `InstructionLoader.load(...)`
- system prompt 的组成规则只定义在 `InputAssembler`
- `instruction_text_hash` 必须来自与 `InputAssembler` 相同规则导出的文本
- provider 最终输入的权威来源是 `InputAssembler.assemble(...)`

### 原则 3：host 负责来源，runner 负责最终输入

- host / CLI 负责收集 instruction sources
- runner 负责在真正调用 provider 之前组装最终 messages

### 原则 4：SessionBootstrap 只记录稳定元数据

bootstrap 记录当前 build 结果的来源和 hash，不承担 runtime 内的 prompt 组装逻辑。

### 原则 5：当前实现和目标状态分开描述

- 标注“当前状态”的段落描述现有代码事实
- 标注“目标状态”的段落描述 `v0.1.2` 接线目标
- 同一条规则不能同时当作“当前约束”和“未来目标”来写

## 当前已知实现边界

- `InstructionLoader` 当前支持 `include_env` 和 `env_var_name` 构造参数
- 这两个参数当前属于代码层可配置项
- CLI 当前只走 `include_env=True` 和默认 `env_var_name`
- 这里的“外部入口”指 CLI flag、配置文件字段和 host 侧显式参数入口
- `v0.1.2` 当前先记录“代码能力已存在，CLI / 配置层还没有把这两个开关暴露出来”

## render 规则版本策略

- `instruction_text_hash` 始终绑定“当前 render 规则导出的完整文本”
- render 规则发生变化时，旧 session 的 hash 继续代表“旧规则下的文本快照”
- `v0.1.2` 先不引入额外 `render_version` 字段
- 后续若出现跨版本校验需求，再补显式版本号

## 成功标准

- 文档能清楚说明每一层负责什么
- 后续实现时不会再出现 CLI 和 runner 双重装配
- 测试矩阵能直接映射到单测和集成测试
- 模块边界足够稳定，至少有 2-3 个模块可以进入 x-req
