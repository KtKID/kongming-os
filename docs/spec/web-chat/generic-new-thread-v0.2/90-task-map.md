# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| `GenericPendingThreadEntry` | `generic-new-thread-first-message` | 无 | 通用频道加号进入空白页 | 低 | 可进入 x-req | 替换通用 tab 的 `NewThreadDialog` 入口 |
| `GenericEmptyThreadView` | `generic-new-thread-first-message` | `GenericPendingThreadEntry` | 空白页居中 Composer、项目按钮只在新页出现 | 中 | 可进入 x-req | 复用 Composer，新增空白页项目选择插槽 |
| `ThreadProjectSelector` | `generic-new-thread-first-message` | thread store 已加载 | 项目候选从有效 cwd 派生、选择新项目打开文件夹选择器、未选择项目走 home | 中 | 可进入 x-req | 纯函数 + 文件夹选择交互都要测 |
| `GenericFirstMessageProtocol` | `generic-new-thread-first-message` | 无 | 协议类型同步、失败提示正确 | 中 | 可进入 x-req | Python / TS 同步改 |
| `FirstMessageThreadCreator` | `generic-new-thread-first-message` | `GenericFirstMessageProtocol` | 返回 thread 前首条 user message 已落盘、失败不产生空 thread | 高，建议先 PoC | 可进入 x-req | 最高风险，优先验证 |

## 开发顺序建议

1. 先实现 `ThreadProjectSelector` 纯函数和 UI，锁定 cwd 候选规则与文件夹选择器接入点。
2. 再实现 `GenericPendingThreadEntry` 和 `GenericEmptyThreadView`，让空白页可交互。
3. 然后实现 `GenericFirstMessageProtocol` 与后端 `FirstMessageThreadCreator`。
4. 最后把成功跳转后的 WS 接续、history 回放和失败回滚测试补齐。

## PoC 建议

高风险点是 `FirstMessageThreadCreator` 与现有 `Runner._seed_messages` 的时机对齐。PoC 目标很小：调用一个后端门户方法，返回前能在 session history 读到第一条 `Message.user`，并且 metadata 存在；模拟 append 失败时 metadata 被清理。
