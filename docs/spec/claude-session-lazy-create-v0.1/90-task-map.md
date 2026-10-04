# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| M1 触发入口 | `claude-session-lazy-create` | 无 | DoD#1, #7 | 低 | 可进入 x-req | 合并为一个 task |
| M2 空态渲染 | ↑ 同上 | M1 | DoD#2 | 低 | 可进入 x-req | |
| M3 延迟创建 | ↑ 同上 | M2 | DoD#3, #4, #5, #6 | 中 | 可进入 x-req | WS 连接异步，需 initialMessage 缓冲 |

## 合并理由

三个模块改动量小（估计 ~150 行前端代码），耦合紧密，拆开反而增加 context 切换成本。建议合并为一个 task `claude-session-lazy-create`。

## 改动文件清单

| 文件 | 改动类型 | 模块 |
|------|---------|------|
| `web/src/stores/threads.ts` | 扩展 | M1 |
| `web/src/components/ClaudeProjectsTree.tsx` | 扩展 | M1 |
| `web/src/components/LeftSidebar.tsx` | 扩展 | M1 |
| `web/src/pages/Chat.tsx` | 扩展 | M2 |
| `web/src/components/ClaudeCodeView.tsx` | 扩展 | M2 + M3 |

后端：**零改动**。
