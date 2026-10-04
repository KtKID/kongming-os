# 目标与完成标准

## 系统目标

让 kongming-agent 在每次对话启动时自动获得工作区全局态势，使 LLM 能跨项目推理。数据来自司天已有的 workspace_state.json，零 LLM 成本。

## 完成目标（DoD）

- [ ] DoD#1：agent 启动后 system prompt 中出现 `# sitian` 段，包含 work_items 列表
- [ ] DoD#2：workspace_state.json 不存在时，system prompt 中无 sitian 段（静默降级，不报错）
- [ ] DoD#3：注入文本带 freshness 时间戳（"数据采集于 2026-05-10T12:00:00Z"）
- [ ] DoD#4：CLI 和 Web 两个宿主都能看到注入内容
- [ ] DoD#5：注入文本 <= 2000 tokens（完整 workspace_state 含 10 work_items 场景）

## 范围边界

**包含**：

- `src/context/sitian_context.py`：纯函数，读文件 + 格式化
- `src/context/instruction_loader.py`：`assemble_instructions()` 新增 `sitian_root` 参数
- `src/cli/main.py`：CLI 装配层传 `sitian_root`
- `src/web/` 装配层传 `sitian_root`（如有独立装配入口）
- 单元测试覆盖

**不包含**：

- 不改 sitian 扫描器 / 建议引擎 / store
- 不新增配置项（开关策略：有数据就注入）
- 不改 core/ contracts（无新 Protocol）
- 不改 config_loader（sitian_root 由调用方解析）

## 关键约束

- **context 层零 sibling 依赖**：`sitian_context.py` 不能 import `sitian.*`，只读文件
- **纯函数设计**：`build_sitian_context_text(sitian_root)` 不读 env、不读 config，所有输入由调用方注入（同 `build_runtime_context_text` 模式）
- **不阻塞启动**：文件读取失败（OSError / JSON 解析失败）静默返回 None，不影响 agent 启动

## DoD - 组件追溯矩阵

| DoD 条目 | 需要哪些组件 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD#1 system prompt 含 sitian 段 | sitian_context + assemble 扩展 + CLI 适配 | sitian-prompt-inject | 待实现 |
| DoD#2 静默降级 | sitian_context（None 返回） | sitian-prompt-inject | 待实现 |
| DoD#3 freshness 时间戳 | sitian_context（格式化逻辑） | sitian-prompt-inject | 待实现 |
| DoD#4 CLI + Web 双宿主 | assemble 扩展 + CLI/Web 适配 | sitian-prompt-inject | 待实现 |
| DoD#5 token 预算 | sitian_context（截断策略） | sitian-prompt-inject | 待实现 |
