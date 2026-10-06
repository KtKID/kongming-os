# task-request-state · dev-report

> task: docs/spec/kmh-zcode-cli-request-supervision/tasks/task-request-state/dev-checklist.md
> 创建: 2026-10-06

## 结果

- task 测试：6/6 🟢 全绿（zcode-cli 测试文件 45/45，其中本 task 新增/改写 7 项）
- 既有回归：通过（`pnpm test` 全仓 72/72；插件 lint 与 prettier 检查通过）
- 高风险行：T1（并发状态跟踪）以 fixture 双请求真实子进程链路验证（T6 行）+ 模型级并发用例覆盖；无缺验证行

## 测试修正与既有断言更新

- T1 自身测试一次写错：假时钟（1_000_000）小于真实 `Date.now()` 导致等待时长为负，修正为真实时钟加偏移。
- 既有"模型取消在配置时限内终止"测试原断言总超时报 `ZCODE_REQUEST_CANCELLED`；按 spec feat04 场景3 更新为 `ZCODE_REQUEST_TIMEOUT`，并补充原因分类与独立清理记录断言。
- 既有客户端注册测试的 inject mock 原只接受 `plugins.item`，随本 task 第二个注册点扩展为两插槽断言。

## 设计取舍（实现记录）

- `requestId` 兼作 `operationId` 传给 CLI（当前 1:1）；研究文档中会话/turn/step/operationId 的完整映射表留给后续 task 拆分。
- `check()` 探测请求也进入监督记录（sessionId 为 null）；RequestDock 展示"最近一条进行中"不按会话过滤，按会话过滤随 task-stop-chain 的按钮链路细化。
- 重试续接按「会话 + 模型/系统提示/消息/工具哈希」指纹：dsh-llm 重试重发相同结构即续接；若上层重建对象改变键序，重试显示为新记录（仅影响展示归并，无功能破坏）。
- 非超时类启动失败（如 `ZCODE_CLI_MISSING`）归入 `startup-timeout` 类别，具体错误码进 detail。
- feat04 场景2 的七类原因中，`total-timeout`、`user-stop`、`channel-exit` 为端到端验证；`startup-timeout`、`provider-error` 经 registration-fail 等路径覆盖；`host-unload` 与其余信号源走同一 arm 机制（dispose 路径未单独 e2e）。
- "清理错误作为独立信息"的失败分支在模型级用例覆盖（cleanup(false) 不覆盖首因）；运行时正常回收记 `cleanupResult.ok=true`，句柄级失败记 false。

## 未决

- 浏览器实测未做：客户端改动经静态渲染与注册断言验证，真实浏览器中 composer dock 的实际呈现与轮询留待 task-stop-chain 停止按钮链路一并验证（AGENTS 要求 Web 用户流程以实际浏览器验证）。

## 补充（文档与展示补齐，用户指出遗漏后完成）

- 所属文档已补：README 使用节新增请求状态段落（阶段/尝试/慢请求/终止原因分类/`GET /api/zcode-cli/requests`），配置表新增 `slowRequestMs` 并更新 `requestTimeoutMs` 说明。
- AccountCard 错误码映射新增 `ZCODE_REQUEST_TIMEOUT` →「模型请求总超时，本轮已停止。」（feat04 场景3 的界面呈现补全）。
- 升级指南（kmh-create-upgrade-guide）经核不适用：五个外部可感知面均未破坏——新路由/新配置项带默认值为增量；错误码消费方同批更新且 dsh-llm 对插件错误归一为 `UNKNOWN`（新旧码都不参与重试判定，行为无差）；新增 peer 依赖由 workspace 与 pnpm-lock 覆盖，公开仓消费以整仓安装，无人独立安装该包。
- 补齐后 45/45、lint、prettier 复跑通过。
