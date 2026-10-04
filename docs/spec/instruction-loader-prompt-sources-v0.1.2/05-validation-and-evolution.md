# Validation And Evolution

## 测试策略

测试分三层：

状态约定：

- `已有`：仓库里已经有对应覆盖
- `待补`：`v0.1.2` 需要新增或校正
- `后续`：留给后续 wiring 实现阶段

### 1. InstructionLoader 单测

目标：钉死来源收集契约。

最小用例：

| 用例 | 断言 | 状态 |
|------|------|------|
| `agent_spec` 非空 | sources 含 `agent_spec` | 待补 |
| `extra_files` 多文件 | sources 顺序稳定 | 待补 |
| 缺失文件 | 跳过 | 待补 |
| 空文件 | 跳过 | 待补 |
| env 非空 | sources 含 `env:KONGMING_EXTRA_INSTRUCTIONS` | 待补 |
| env 缺失 / 空白 | 跳过 | 待补 |
| 多来源 render helper | 导出结果带 `# origin` 且顺序稳定 | 待补 |
| 非法 UTF-8 | 冒泡（`v0.1.2` 正式契约），测试锁死 | 待补 |
| 同名文件不同路径 | 明确 origin 冲突是否接受，或升级 origin 规则 | 待补 |

### 2. InputAssembler 单测

目标：钉死 prompt build 的局部行为，并确认唯一修改点在 `InputAssembler`。

最小用例：

| 用例 | 断言 | 状态 |
|------|------|------|
| history 无 system + instructions 非空 | 新增一条 system | 已有 |
| history 已有 system | 不重复新增 | 已有 |
| compact 触发 | `messages` 来自 compact 后结果 | 已有 |
| render 规则 | `InstructionSource[]` 按唯一规则导出 `system_text` | 已有 |
| metadata | `original_count` / `compacted_count` / `added_system` / `instruction_sources` 正确 | 已有 |
| instructions 为空 | 不新增 system | 已有 |
| 第二轮已有 system | 不重复新增 | 待补 |
| compactor 删掉旧 system | 同轮不自动重补，行为被测试锁死 | 待补 |

### 3. 集成测试

目标：验证真实接线落点。

最小用例：

| 用例 | 断言 | 状态 |
|------|------|------|
| CLI/source build | host 侧只负责收集 `InstructionSource[]` 与 bootstrap 记录 | 部分已有，待补语义断言 |
| bootstrap 回填 | `instruction_sources` / `instruction_text_hash` 进入 manifest | 已有 |
| hash 复现 | 对同一 render 结果做 UTF-8 + sha256 可稳定复现 | 待补 |
| runner 调 provider 前 | 真正消费 assembled messages | 后续 |
| file session 恢复 | manifest 中的来源和 hash 持久化正确 | 已有 |
| trace / metadata | 能看到 prompt build 的关键诊断字段 | 后续 |

## 演进顺序

### Phase 1：契约稳定

- 补 `InstructionLoader` 单测
- 对齐失败语义文档和实现

### Phase 2：build 接线

- 让 `InputAssembler` 进入主链
- 收敛 `Runner._seed_messages()` 与 assembler 的 system 注入职责
- 按已定语义推进：`AgentSpec.instructions` 退化为向 `InstructionLoader` 传文本的入口，history 已有 system 时 `InputAssembler` 接管

### Phase 3：集成回归

- 补齐 CLI/runtime/runner 集成测试
- 检查 bootstrap / manifest / trace

### Phase 4：更大 prompt 系统

以下内容留到 v0.2+：

- 自动项目规则发现
- attachments
- skill 分层
- 宿主动态上下文
- token 预算和上下文策略

## 演进守则

- 先统一 build 入口，再扩来源种类
- 先保证单向数据流，再谈 richer metadata
- 先补测试，再重构主链
