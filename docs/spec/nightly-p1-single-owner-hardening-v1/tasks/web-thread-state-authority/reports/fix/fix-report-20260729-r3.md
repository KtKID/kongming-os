# Fix Report — web-thread-state-authority — 20260729 R3

## 修复对象

Gate② 首轮独立复核登记的 issue-1 至 issue-8，其中 P1 六项进入本轮修复，
P2 两项进入后续工程项。

## 根因与修复

| issue | 根因 | 修复 |
|---|---|---|
| issue-1 | Claude/Codex pending 新建线程只缓存首条消息字符串，Composer 清空后丢失 reasoning、附件和引用 | `SubmittedDraft` 成为完整草稿合同；pending 缓冲、自动首发和失败恢复都传递文字、reasoning、附件与引用 |
| issue-2 | approval snapshot 的取样与入队分属两个锁区间，增量可插入两者之间 | snapshot、add、remove 在 broadcaster 同一锁内完成排序和入队；并发测试固定 snapshot 先于后续增量 |
| issue-3 | Claude/Codex 在可能阻塞的 connect、spawn 和 stdin 写入后才建立 run lease | provider 启动前先 `begin_run`、发布 active 状态并登记当前启动任务；Stop 可取消仍处于启动阶段的任务 |
| issue-4 | 慢连接溢出由 publisher 直接关闭 WebSocket，连接 writer 可能同时执行 `send_json` | 每条连接由唯一 writer 同时负责发送与 1013 关闭；publisher 只设置 close event，消除同连接双 sender |
| issue-6 | codegen 只覆盖 delta，snapshot 由 TS 手写，协议漂移测试也遗漏 snapshot | Python 同时导出 delta/snapshot schema，TS 同时生成两种 frame，检查脚本逐字节比较两份生成物 |
| issue-7 | 双浏览器 E2E 用局部锁模拟审批仲裁 | 测试服务接入真实 `ApprovalManager`、`PermissionsManager` 和 `InboxEventSink`，同时断言单次受理、authoritative remove、pending 清空与单次工具继续 |

## P2 后续项

- issue-5：为 generation/current lease 表补 thread 生命周期回收入口，限制历史
  thread 身份表的长期占用。
- issue-8：增强 SC_24，使同一浏览器连接在 run 进行中断开，并覆盖断线终态与旧
  socket late frame。

两项均处于 nightly P1 修复边界之外，当前 active 状态正确性与审批单次继续合同已
由本轮 Gate 覆盖。

## 验证

- `xdev.py verify`：13 pass，0 fail，0 manual，0 uncovered。
- 后端聚焦回归：149 passed。
- Composer/图片/SlashMenu 完整草稿合同：69 passed。
- 双浏览器 E2E：审批竞争和 snapshot/reconnect 两条链路通过。
- `pnpm typecheck`、`pnpm protocol:check`、Ruff、mypy：全部通过。
