---
description: Codex CLI 重试原因展示、请求超时与等待期间停止的需求、测试和验证记录。
---

# 显示连接重试原因并及时结束等待

> spec: docs/spec/codex-cli-provider/spec.md
> feat: feat06
> 创建: 2026-10-09

## ① 需求

### 功能方向

用户在连接失败后能直接看到重试状态与原因。等待期间可以停止；超过配置时限后本次请求结束，用户可以再次发送。

### 功能边界

- R1：展示官方重试状态及失败原因；恢复输出后恢复正常状态。
- R2：等待首段输出或重试时，停止及时生效并回收进程。
- R3：主对话与标题等辅助请求遵守配置时限；超时显示独立错误码并保留失败状态，后续发送正常工作。
- 范围：Codex CLI 插件、插件测试与相关文档；重试策略由官方 CLI 管理。

### 不能破坏的不变量

- I1：同一会话保持串行；取消排队请求时，当前请求与后续队列继续遵守执行顺序。
- I2：保留思考等级、思考摘要、逐段输出与原生会话日志的既有验证。

## ② 测试用例（先写，此刻失败）

### unit

- `retry and failure reasons are visible in the dock`：实际 client bundle 的中英文重试与错误原因直接显示；正常状态保留小球 → R1。
- `cancelled queue entry preserves session ownership`：取消排队调用、第三次调用继续等待首个消费方 → I1。

### smoke

- `official retry status recovers with streamed output`：真实 CLI 收到 503，插件实时展示重试原因；恢复服务后分段输出，完成后清除重试状态 → R1、I2。
- `stop during official retry joins the process`：真实 CLI 进入重试后停止，及时收尾并回收进程 → R2。
- `stop before the first output joins the process`：服务端扣住首段响应，停止能唤醒等待 → R2。
- `request deadline ends a stalled turn and permits another request`：服务端扣住首段响应，主请求按配置超时，红色失败保留，下一次请求成功 → R3、I2。
- `auxiliary requests obey the same deadline`：标题生成扣住首段响应，按配置超时并回收进程 → R3。
- `terminal provider failure retains the error state`：真实 CLI 耗尽重试后返回明确错误、状态保持失败 → R1、R3。

所有 smoke 使用独立 CODEX_HOME；原生 session、上游请求与通知保留到 KMH_CODEX_TEST_TMP。

## ③ 技术实现

### 实现步骤

1. 真实 CLI 测试服务增加 503 故障与首段响应门；官方通知、请求和原生会话保留到独立临时目录。
2. 接收 `willRetry` 与 `additionalDetails`，上报重试原因；恢复正文、思考或工具输出后回到通信状态。Client 直接展示中英文重试文案与失败原因。
3. adapter 将 `requestTimeoutMs` 应用于主请求和辅助请求，合并调用方停止信号；返回 `CODEX_REQUEST_TIMEOUT` 或 `ABORTED`。中止等待立即唤醒，随后等待官方中断确认并回收进程。
4. 排队取消只结束当前排队项，后继请求继续等待原拥有者；辅助连接在隔离核对前移交 turn，失败时也由 turn 回收。
5. 同步旧 adapter 测试装配的超时配置。首次根目录回归提示临时 CODEX_HOME 缺失，创建目录后重跑；旧装配缺少配置导致的失败随消费者更新修正。

### 涉及文件

- `packages/codex-cli/src/adapter.ts`：主对话与辅助请求时限、停止和超时错误码。
- `packages/codex-cli/src/index.ts`：实时状态、可取消排队、辅助连接回收。
- `packages/codex-cli/src/turn.ts`：重试通知、恢复通知、取消唤醒、中断确认超时。
- `packages/codex-cli/src/config.ts`、`src/protocol.ts`、`src/live-state.ts`：配置契约、官方错误通知、Host/Client 共用状态校验。
- `packages/codex-cli/src/client/LiveBall.tsx`、`src/client/locales.ts`、`tsconfig.browser.json`：可见错误原因、中英文文案和浏览器编译范围。
- `packages/codex-cli/test/retry-status.test.mjs`、`test/session-stream.test.mjs`：本轮 8 项测试。
- `packages/codex-cli/test/support/harness.mjs`、`test/support/model-server.mjs`：隔离测试配置、503 与首段响应控制。
- `tests/runtime/codex-cli.test.mjs`：既有 adapter 装配同步超时配置。
- `packages/codex-cli/README.md`、`docs/spec/codex-cli-provider/spec.md`、本 task、前一流式任务记录与两份调查报告：使用说明、重试场景、验证及修复索引。

## ④ 验证结果

### 测试输出

红阶段（实现前）：

```text
KMH_CODEX_TEST_TMP=/private/tmp/kmh-codex-retry-20261009 node --test --test-concurrency=1 packages/codex-cli/test/retry-status.test.mjs packages/codex-cli/test/session-stream.test.mjs
tests 11
pass 3
fail 8
duration_ms 19227.604083
```

8 项新增测试均失败；3 项既有会话流测试通过。失败包括可见文案、retrying 状态缺失、停止错误码、等待未结束、排队取消未返回。首次沙箱运行返回 listen EPERM，原命令以宿主权限执行后取得业务失败记录。完整输出：`/private/tmp/kmh-codex-retry-20261009-red.log`。

绿阶段：

```text
KMH_CODEX_TEST_TMP=/private/tmp/kmh-codex-retry-20261009 pnpm --filter @kmh/codex-cli test
tests 18
pass 18
fail 0
cancelled 0
skipped 0
duration_ms 9170.251875
```

本轮 8 项测试与既有 10 项测试全部通过；完整输出：`/private/tmp/kmh-codex-retry-20261009-package-final.log`。原生 session、请求及通知保留在 `/private/tmp/kmh-codex-retry-20261009/`。

### 不变量回归

```text
CODEX_HOME=/private/tmp/kmh-codex-root-regression-20261009 KMH_CODEX_TEST_TMP=/private/tmp/kmh-codex-retry-20261009 pnpm test
tests 144
pass 144
fail 0
cancelled 0
skipped 0
duration_ms 27759.482834
```

144 项包含本轮 8 项、前一任务 10 项插件测试与已有 126 项测试。完整输出：`/private/tmp/kmh-codex-retry-20261009-root-final.log`。根目录回归同时构建 5 个 KMH 插件；旧 Codex 测试聚焦复查为 45/45，记录在 `/private/tmp/kmh-codex-retry-20261009-existing-codex.log`。

`pnpm --filter @kmh/codex-cli typecheck`、`pnpm --filter @kmh/codex-cli lint` 通过。包级 `format:check` 报出与 HEAD 一致的 `src/cursor.ts`、`src/web.ts` 两个既有格式问题，保留原样。

已用清除六个失效代理变量的进程环境重启 Web，服务 PID 64296。真实 Chrome 在 `http://127.0.0.1:3080/` 的独立验证会话使用 GPT-5.6-Luna / Medium，15 秒完成并显示“Codex 修复验证通过”和“Codex CLI 连接状态：已停止”。截图：`/private/tmp/kmh-codex-retry-20261009-web.png`。浏览器确认健康请求与收尾；故障展示由真实 CLI 故障测试及 Client bundle 渲染测试覆盖。

自检：feat06 回指有效；R1–R3、I1–I2 全部有测试；本轮 8 项与既有 10 项合计 18 项；源码、测试与文档均在 Codex CLI 范围。

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过
- [x] 实现在边界内
- [x] 不变量未破坏
