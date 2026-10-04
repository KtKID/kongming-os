# Dev Report — fork-lineage-navigation — 20260728

## 红灯证据

生产实现前运行 `pnpm exec vitest run src/pages/__tests__/Chat.test.tsx`，结果 `1 failed, 32 passed`。失败断言为 fork task 找不到可访问名称“续接自任务”的链接，位置 `Chat.test.tsx:704`。普通任务隐藏断言同时通过；该红灯直接证明 fork metadata 进入页面后仍缺少 lineage 展示与父任务 route。

## 改动

- `ChatPage` 读取当前 `thread.forked_from_id`，仅在该值存在时渲染居中 lineage 分隔线。
- 分隔线包含两侧横线、`GitFork` 图标和“续接自任务”React Router 链接；链接目标为直接父任务 `/chat/<forked_from_id>`。
- 页面单测覆盖普通任务隐藏、fork 任务显示、精确 `href` 与点击后的路由切换。
- 真实 fork Playwright smoke 在目标页面重载后断言 lineage 链接存在、目标正确，并通过链接回到源任务和已持久化历史。

## 位置修正（2026-07-29）

- `ThreadManager.fork_thread` 写入 `forked_from_history_index`，值为复制前缀最后一条终态 assistant 在目标 Session.history() 的零基位置；metadata/REST/TypeScript/store 同步到 schema v13。
- `MessageList` 将分隔线作为时间线内联项渲染在该 assistant 气泡之后，后续新增消息保持在分隔线之后；`ChatPage` 只负责传递 lineage 数据。
- 旧 v12 metadata 懒升级时边界保留 `null`，页面省略分隔线，保持正确气泡定位约束。

## 位置修正验证

- 红灯：回复级 fork 测试在 metadata 缺少 `forked_from_history_index` 时失败。
- 绿灯：metadata/fork 合同 83 项、路由/REST/归档相关集 141 项、前端 MessageList/Chat/store 62 项、TypeScript 与目标 ESLint 通过。
- 绿灯：`pnpm test:e2e:thread-fork` 通过真实浏览器链路，断言 fork REST 返回 `forked_from_history_index=3`，重载后入口可见并能回到直接父任务。
- 绿灯：xdev `validate` 校验 spec/task 包，0 issue。

## 验证证据

```verify
id: SC01-ordinary-thread-hidden
scenario: SC_01
cmd: pnpm exec vitest run src/pages/__tests__/Chat.test.tsx
cwd: web
expect_exit: 0
expect_contains: 33 passed
mode: auto
```

```verify
id: SC02-direct-parent-navigation
scenario: SC_02
cmd: pnpm exec vitest run src/pages/__tests__/Chat.test.tsx
cwd: web
expect_exit: 0
expect_contains: 33 passed
mode: auto
```

```verify
id: SC03-persisted-browser-smoke
scenario: SC_03
cmd: pnpm test:e2e:thread-fork
cwd: web
expect_exit: 0
expect_contains: 1 passed
timeout: 120
mode: auto
```

## 补充检查

- 目标 Vitest：`33 passed`。
- 隔离 Playwright：`1 passed`；覆盖浏览器 → FastAPI → ThreadManager → FileSession → metadata 重载 → lineage route。
- 目标 TypeScript 与 ESLint 检查在 Gate① 前复跑。

## Gate② 修复回归

- `issue-1` 将 lineage 栏保留为 `shrink-0`，并把 `MessageList` 放入 `min-h-0 flex-1` 视口层，维持聊天时间线可滚动高度。
- `issue-2` 将单测改为 `grandparent → parent → child`，断言 child 链接只指向 parent。
- 修复后复跑 Chat Vitest `33 passed`、TypeScript、目标 ESLint 与隔离 Playwright `1 passed`。
