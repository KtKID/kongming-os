# 验证策略与演进

## 验证策略

### 单元测试

- **覆盖模块**：`src/context/sitian_context.py`
- **框架**：pytest
- **重点场景**：

| 场景 | 预期 |
|------|------|
| workspace_state.json 存在且含 work_items | 返回格式化文本，含表格 + freshness |
| workspace_state.json 不存在 | 返回 None |
| workspace_state.json 存在但 JSON 损坏 | 返回 None（不抛异常） |
| workspace_state.json 存在但 workItems 为空 | 返回 None（空态势不注入） |
| work_items 超过 MAX_ITEMS | 截断 + 显示"及 N 个更多项目" |
| latest_summary.md 存在 | 文本末尾追加 summary 原文 |
| latest_summary.md 不存在 | 只输出 workspace_state 部分 |
| latest_analysis.md 存在 | 文本末尾追加 analysis 独立段 |
| updatedAt 超过 1 小时 | freshness 标注含"可能已过期" |
| assemble_instructions 传 sitian_root=None | 输出不含 sitian 段（回归） |
| assemble_instructions 传 sitian_root 有效 | 输出含 `# sitian` 段 |

### 集成测试

- **端到端链路**：CLI 启动 → 读真实 workspace_state.json → system prompt 包含 sitian 段
- **环境要求**：需要 `./sitian.sh scan` 先跑一次产出数据
- **触发方式**：x-verify 复跑

### 手动验证

- **场景**：启动 `make cli`，检查 prompt debug dump（`PromptDebugDumpSink`）输出中是否含 sitian 段
- **验收人**：开发者自验

## 测试覆盖要求

| 模块 | 最低覆盖率 | 重点文件 |
|------|-----------|---------|
| context/sitian_context | 90% | sitian_context.py |
| context/instruction_loader | 已有测试 + 新增 sitian 集成 case | instruction_loader.py |

## 演进路线

### 短期（本轮 task）

- [ ] sitian_context 纯函数 + 单测
- [ ] assemble_instructions 扩展 + 回归测试
- [ ] CLI 装配适配

### 中期（下 1-2 轮）

- [ ] 层面 3：deep scanner 读 thread 内容产出语义摘要（`entity_type="thread_summary"`）
- [ ] 注入文本加入 thread 语义摘要（"正在做 XX 功能，卡在 YY"）

### 长期（方向性）

- Web 前端的 sitian 态势面板（读同一份 workspace_state.json）
- 用户可在 prompt 中 @sitian 按需拉取特定项目详情
