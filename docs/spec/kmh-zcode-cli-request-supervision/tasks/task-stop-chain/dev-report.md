# task-stop-chain · dev-report

> task: docs/spec/kmh-zcode-cli-request-supervision/tasks/task-stop-chain/dev-checklist.md
> 创建: 2026-10-06 · 当日全 8 行完成

## 结果

- task 测试：**T1-T8 全部 🟢**；zcode-cli 测试文件 48/48（连续三轮无竞态闪烁），lint 与 prettier 通过
- 高风险行验证：T2/T3 经 fixture 真子进程 JSON-RPC 链路（官方取消往返、竞态补发结果、在途落定门）；**T8 真机 smoke 通过**——真实 CLI（/Applications/ZCode.app）+ 真实账号发起真实模型请求，3.000s 取消 → 3.099s 完成，`stop.receipt: true`（官方取消回执 14ms）、`exitConfirmed: true`、cleanup ok；远优于 5 秒清理目标
- **真实浏览器验证通过**（重启 Web 后实际操作）：状态行"等待模型回复/慢请求提示"、排队气泡（编辑/删除/插话）、停止后"已暂停"徽标、**重启后徽标与队列保持**、Continue 按钮出现并 FIFO 放行、Supplement turn 按钮提交后队列保持挂起且草稿清空、停止终态"Local task stopped" 呈现；"正在停止"中间态在真机 <100ms 完成未单独捕获（符合预期）

## 浏览器验证发现并修复的两个真实缺陷

1. **`/api/zcode-cli/requests` 被注册为 POST-only**（mountWeb 循环只把 status 标成 GET），查询端 GET 在真实 HTTP 层 404；单测直调 `accountResponse` 绕过了 method 匹配未暴露。修正为 status/requests 均为 GET。
2. **RequestDock 只选取 running 记录**，停止后的 user-stop 记录（两段式三态的载体）永不被选中。修正为：优先 running，否则保留最近一条 user-stop 记录展示正在停止→已停止/待确认。

## 实现记录

- T1：fixture 实现 `workspace/cancelGenerateText`（hang 命中回 `cancelled:true` 并中止在途；race 模式回 `cancelled:false` 并补发成功结果；未知编号回 false），`cancels.jsonl` 留证。
- T2：用户停止先经官方取消通道（`cancelReceiptTimeoutMs` 默认 1s 控制时限）；raw finally 以有界 stopGate 先等回执再拆传输；清理后 `waitForExit`（`cleanupTimeoutMs` 默认 5s）确认并记录 `exitConfirmed`；用户停止期间在途请求任何落定按取消归类。
- T3/T5：竞态（取消 vs 完成）回执 false + 结果照常返回（outcome succeeded，不视为停止失败）；在途落定门（runSettled）确保回执后 abort 不吞在途结果——该门修复了一个真实的时序闪烁（首轮通过次轮失败，三轮验证后稳定）。
- T4：退出确认超时→`exitConfirmed:false`（待确认态）经单元断言覆盖首因不覆盖；e2e 覆盖确认路径。
- T6：两会话并发，停止其一仅回收目标（user-stop + receipt true），另一会话至自己的 total-timeout。
- T7：dock 状态行两段式三态（正在停止/本机任务已停止/停止状态待确认）+ 选取逻辑修复；中文文案 zh/en。

## 遗留

- 请求监督记录为进程内存态：Web 重启后 dock 状态行无历史（本次浏览器验证确认）——持久化按计划归 task-request-records。
- 两段式的"正在停止"中间态在真机 <100ms，未单独截图留证；如需演示可增大 `cancelReceiptTimeoutMs` 或用慢回执 fixture。
