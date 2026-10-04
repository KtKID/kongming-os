# 验证策略与演进

## 验证策略

### 单元测试

- **覆盖模块**：ThreadsStore 的 pending state 管理
- **框架**：vitest
- **重点场景**：
  - `setPendingNewClaudeSession` 写入/清除
  - `setInitialMessage` 写入/清除
  - pending state 在 thread 创建后正确清除

### 集成测试

本功能以 UI 交互为主，集成测试以 Playwright MCP 手动验证为主。

### 手动验证（必须）

- [ ] Claude tab 展开 project → 看到"新建会话"按钮
- [ ] 点按钮 → 主区域变空白 ClaudeCodeView + 空态文案 + Composer 可用
- [ ] 输入消息点发送 → thread 创建 + WS 连接 + 消息发出 + URL 更新
- [ ] 左栏 threads 列表出现新 thread
- [ ] 连续点两次"新建会话"不创建多个 thread
- [ ] 网络断开时创建失败 → toast 报错 + 输入不丢
- [ ] 在 pending 状态刷新页面 → 回到正常空态（pending state 丢失符合预期）
- [ ] 创建后的 thread 可正常对话、加载历史、处理审批

## 测试覆盖要求

| 模块 | 最低覆盖率 | 重点文件 |
|------|-----------|---------|
| ThreadsStore 扩展 | 80% | stores/threads.ts |
| ClaudeCodeView pending | 手动验证 | ClaudeCodeView.tsx |

## 演进路线

### 短期（本轮 task）

- [ ] 完成 M1/M2/M3 三个模块
- [ ] Playwright MCP 手动跑通主链路

### 中期（下 1-2 轮）

- [ ] session 自动命名：thread 创建后用 assistant 首轮回复的摘要重命名
- [ ] workspace tabs（files/git/shell）在 pending 状态下显示 disabled 提示
- [ ] Codex tab 复用相同的延迟创建模式

### 长期（方向性）

- Claude tab 的 project 不只读 SDK 历史，也展示自建 thread（双向关联）
- 多 provider 统一"新建会话"入口（project-centric 模式对齐 claudecodeui）
