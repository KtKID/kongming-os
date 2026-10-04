# 验证策略与演进

## 验证策略

### 单元测试

- **覆盖模块**：Normalizer 扩展（必须）、WS 协议类型（静态 mypy 即可）
- **框架**：pytest
- **重点场景**：
  - `message_start` → 正确产出 `stream_status(phase="responding")`
  - `content_block_start(thinking)` → `stream_status(phase="thinking")`
  - `content_block_start(tool_use, name="bash")` → `stream_status(phase="tool_calling", toolName="bash")`
  - `content_block_delta(text_delta)` → `stream_delta` 含 `deltaType="text"`
  - `content_block_delta(thinking_delta)` → `stream_delta` 含 `deltaType="thinking"`
  - `content_block_delta(input_json_delta)` → `stream_delta` 含 `deltaType="input_json"`
  - 向后兼容：已有 `stream_delta` 不带 `deltaType` 时前端不崩（TS optional）
  - `message_delta` / `message_stop` 仍返回空列表

### 集成测试

- **端到端链路**：启动 Web server → WS 连接 → 发送 claude-command → 验证收到 `stream_status` 帧序列
- **环境要求**：需要 Claude CLI 可用（或 mock SDK client）
- **触发方式**：手动 / x-verify 复跑

### 手动验证

- **必须人工过的场景**：
  - 前端状态指示器在 thinking → text 切换时无闪烁
  - tool_calling 状态显示正确工具名
  - 多 block 快速切换时不出现"状态闪回"
- **验收人**：用户浏览器验证

## 测试覆盖要求

| 模块 | 最低覆盖率 | 重点文件 |
|------|-----------|---------|
| Normalizer 扩展 | 100%（新增分支） | `tests/unit/web/integrations/claude_code/test_normalizer.py` |
| WS 协议扩展 | mypy 类型检查 | `src/web/app_support/llm_protocol.py` |
| 前端状态渲染 | 手动验证 | `web/src/` |

## 演进路线

### 短期（本轮 task）

- [ ] 实现 `stream_status` 帧透传（normalizer + protocol + 前端）
- [ ] `stream_delta` 加 `deltaType` 字段
- [ ] `input_json_delta` 不再丢弃（前端可选展示工具输入）

### 中期（v0.4）

- [ ] TaskStartedMessage / TaskProgressMessage 转为 `task_progress` 帧（子 agent 进度）
- [ ] 通用频道 / Codex 频道产出对等的 `stream_status`（需 adapter）
- [ ] 卡死检测：前端计时器 + 3s 无 delta → 状态指示器变色

### 长期（方向性）

- 多 agent 场景：每个子 agent 独立 `stream_status` + tree 进度视图
- token 实时消耗：`message_start.usage.input_tokens` 推到前端显示
- 预估时间：基于历史 turn duration 估算剩余等待
