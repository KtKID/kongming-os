# 验证策略与演进

## 验证策略

### Smoke / E2E 验收入口

- **Smoke 路径**：启动 Web generic chat，注入一条 `choice.request` frame，composer 上方出现选择面板。
- **E2E 路径**：LLM fake provider 发起 `present_choices` tool call → Web 收到选择面板 → 测试选择多个问题 → 点击确定 → 后端收到 `choice.submit` → fake provider 下一轮收到选择结果文本。
- **进入 x-req 的规则**：x-req README 必须明确 fake LLM、WebSocket frame、React 交互和协议漂移测试。

### 单元测试

- `ChoiceTool` 参数校验：空 title、空 description、空 questions、空 options、重复 id。
- `WSEventSink` 翻译：`choice.requested` → `choice.request`。
- `ChoiceManager`：选择、切题、自定义文本、canSubmit、buildSubmitFrame。
- `format_choice_submit_as_user_input()`：结构化答案转文本。

### 集成测试

- WebSocket route 接收 `choice.submit` 并调用 run_once。
- Chat 页收到 `choice.request` 后挂载 ChoicePanel。
- 当前 run active 时提交返回 error，草稿保留。

### 手动验证

- 打开 `repo:docs/choice-list-prototype.html` 对比目标布局。
- 本地 Web 里确认面板不遮挡输入框和 Stop/ModelSwitcher/AutoApprovalToggle。
- 移动宽度确认 step、按钮、选项文本不溢出。

## 测试覆盖要求

| 模块 | 最低覆盖 | 重点文件 |
|------|----------|---------|
| Choice Tool | 工具参数和事件输出 | `repo:tests/unit/tools/builtin/test_choice_tool.py` |
| Choice Protocol | 双侧 frame 类型和字段 | `repo:tests/unit/web/test_choice_protocol.py`、`repo:web/src/chat/__tests__/types.contract.test.ts` |
| Choice UI | 用户真实点击交互 | `repo:web/src/features/choice/__tests__/ChoicePanel.test.tsx` |
| Submit Bridge | WebSocket 确认链路 | `repo:tests/unit/web/test_choice_submit_ws.py` |
| Prompt Guidance | 模板包含工具说明 | `repo:tests/unit/test_prompts_loader.py` |

## 演进路线

### 短期（本轮 task）

- [ ] 实现单选题选择工具。
- [ ] 实现 Web composer 上方选择面板。
- [ ] 实现确认后继续对话。

### 中期（下 1-2 轮）

- [ ] 支持选择请求恢复。
- [ ] 支持多个 pending choice 队列。
- [ ] 在消息时间线中显示“用户已选择”的轻量记录。

### 长期（方向性）

- 支持多选、排序、打分题型。
- 支持 workflow 专属选择步骤，把选择结果写入 workflow artifact。
- 支持非 Web 宿主的文本 fallback。
