# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| Bootstrap 与 Session 工厂 | 生成并传递会话稳定元数据 | 现有 CLI 初始化流程 | 可进入 x-req | 解决元数据时序问题 |
| FileSession 存储与落盘生命周期 | 管理目录、manifest、messages、首条 append 触发 materialize | Bootstrap 与 Session 工厂 | 可进入 x-req | 建立文件态 session 骨架 |
| 消息链模型与恢复校验 | 定义记录 schema、追加规则、恢复与校验逻辑 | FileSession 存储与落盘生命周期 | 可进入 x-req | 建立可靠恢复能力 |
| Backend 接入与兼容性验证 | 接入配置、保持 sqlite 回归稳定、补齐测试 | 前三模块 | 可进入 x-req | 作为 v0.1.1 收口模块 |

## 模块详情

### 模块 1：Bootstrap 与 Session 工厂

**职责**：在 CLI 阶段收集稳定元数据，并通过工厂闭包把 `SessionBootstrap` 传递给 Runtime。

**包含范围**：

- 定义 `SessionBootstrap`
- 在 CLI 阶段计算 `instruction_text_hash`
- 生成 `session_id`
- 组装 `make_session_factory(cfg.session, bootstrap)`
- 扩展 `build_session(..., bootstrap=...)`

**不包含范围**：

- 文件目录创建
- 消息文件写入
- trace 或 audit 的结构调整

**依赖**：

- `load_config()`、`InstructionLoader.load(...)`、`InstructionLoader.render(...)`
- 现有 Runtime 通过 `session_id` 取 session 的调用模型

**风险与讨论点**：

- `SessionBootstrap` 字段范围需要保持稳定元数据语义
- `build_session` 的签名扩展需要兼容现有 backend

**task 建议**：

- 建议 task 名：`file-session-bootstrap-bridge`
- 是否进入 x-req：是
- 原因：输入、输出、边界和依赖都已明确

### 模块 2：FileSession 存储与落盘生命周期

**职责**：实现 `FileSession` 的内存初始化、首次 materialize、文件落盘和后续 append-only 写入。

**包含范围**：

- `FileSession.__init__(...)`
- `materialize()`
- 首条 `append()` 触发 `materialize()`
- session 目录创建
- `manifest.json` 初始化写入
- `<session_id>.jsonl` 的首次准备与后续追加

**不包含范围**：

- trace / audit sink
- 复杂跨 session 聚合能力
- 运行观测报表

**依赖**：

- 模块 1 提供的 `SessionBootstrap`
- `store_path/session_id/` 目录约定

**风险与讨论点**：

- `materialize()` 只执行一次的幂等性
- 首条 `append()` 触发 `materialize()` 时的并发一致性
- 已存在目录的恢复入口需要统一处理

**task 建议**：

- 建议 task 名：`file-session-materialization`
- 是否进入 x-req：是
- 原因：主链路稳定，适合单独推进实现

### 模块 3：消息链模型与恢复校验

**职责**：定义消息记录 schema、顺序规则、恢复策略和完整性校验。

**包含范围**：

- `messages.jsonl` record schema
- `seq`、`message_id`、`parent_message_id` 规则
- `append(message)` 记录拼装流程
- `history()` 恢复逻辑
- `validate()` 校验逻辑
- 损坏尾行容错策略

**不包含范围**：

- 跨 session 查询
- trace / audit 的链路合并
- 消息内容的业务层语义加工

**依赖**：

- 模块 2 提供的文件存储骨架
- 当前 `Message` 序列化结构

**风险与讨论点**：

- `message` 子对象与现有消息序列化结构的对齐方式
- 损坏尾行跳过策略需要明确“可恢复部分”的边界
- 物理顺序索引与逻辑链索引的校验结果需要一致定义

**task 建议**：

- 建议 task 名：`file-session-chain-recovery`
- 是否进入 x-req：是
- 原因：记录 schema、恢复策略、校验点都已具备落地条件

### 模块 4：Backend 接入与兼容性验证

**职责**：把 `backend=file` 接入现有配置体系，并通过测试保证其他链路行为稳定。

**包含范围**：

- `SessionConfig.backend` 新增 `file`
- 显式配置切换逻辑
- `sqlite` backend 回归验证
- `trace` 逻辑回归验证
- 单元测试与 e2e 测试补齐
- 文档与样例 session 文件补充

**不包含范围**：

- 默认 backend 策略变更
- `sqlite` 数据迁移
- trace / audit 的格式改版

**依赖**：

- 模块 1、2、3 完成可用实现

**风险与讨论点**：

- 测试用例需要覆盖首次创建、重启追加、损坏尾行恢复等关键场景
- 样例 session 文件建议与 schema 版本同步维护

**task 建议**：

- 建议 task 名：`file-session-backend-compat`
- 是否进入 x-req：是
- 原因：交付边界清晰，适合作为版本收口任务
