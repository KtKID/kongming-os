---
description: Codex CLI 推理等级、思考摘要与流式输出的插件内回归测试和验证结果。
---

# 对齐思考等级并实时显示 Codex 输出

> spec: docs/spec/codex-cli-provider/spec.md
> feat: feat01, feat03
> 创建: 2026-10-08

## ① 需求

### 功能方向

- R1：用户选择的思考等级在首次对话、继续对话与编辑后重新生成时保持一致。
- R2：正文与可提供的思考内容随生成逐步出现。
- R3：检查记录保存在指定的临时目录，调用完成后可以核对实际使用的等级与输出。

### 功能边界

本任务覆盖 Codex CLI 插件、插件内测试及测试命令接入。验证使用官方本机程序和可控的本地响应，检查原生会话记录；现有个人登录、服务进程和其他插件保持原状。

### 不能破坏的不变量

- I1：已有会话继续沿用绑定；编辑历史后创建独立绑定。
- I2：同一会话串行推进；取消、消费方提前结束和错误都释放执行归属。
- I3：省略思考等级时沿用官方默认；摘要模式允许显式关闭；空摘要保持空内容。

## ② 测试用例（先写，此刻失败）

### unit

| ID  | 用例                                                               | 对应需求或不变量 |
| --- | ------------------------------------------------------------------ | ---------------- |
| T1  | reasoning 完成项解析：字符串摘要、原始内容、多段、空数组及错误元素 | R2、I3           |
| T2  | 摘要配置校验：默认 auto、显式 none、非法模式拒绝                   | R2、I3           |
| T3  | 消费方提前结束后回收 turn，下一次调用可继续                        | R2、I2           |
| T4  | 上游流异常前保留已交付片段，异常后释放会话                         | R2、I2           |
| T5  | 同一会话后续调用等待当前消费方交还执行权                           | I2               |

### smoke

| ID  | 用例                                                                                                                                    | 对应需求或不变量 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| T6  | 真实 adapter → CodexCli → 官方 app-server → 本地 Responses 服务；首次 low、恢复 high、编辑重建 medium，对账原生 turn_context 与上游请求 | R1、R3、I1       |
| T7  | xhigh、max、ultra 及省略等级，对账原生日志和上游实际等级                                                                                | R1、R3、I3       |
| T8  | 正文与摘要分段返回，摘要第一段在续传门释放前可见，同类片段索引一致，正文和摘要独立分块，输出在完成门释放前已可见                        | R2、R3           |
| T9  | 显式关闭摘要时原生日志保留 none，上游省略摘要，输出保持正文                                                                             | R2、R3、I3       |
| T10 | 提前结束真实插件流，官方通知确认 interrupted，进程退出                                                                                  | R2、R3、I2       |

## ③ 技术实现

### 实现步骤

1. 包内测试创建隔离的 CODEX_HOME，官方 app-server 经真实 LocalSubprocessRuntime 启动，本地 Responses 服务保留请求并控制完成门。
2. `withSession()` 逐块交付，消费方提前结束时等待官方中断与进程回收；游标在取得会话执行权后恢复。
3. 首次、恢复、重建和辅助请求传入 model、effort、summary；摘要模式由 Config 校验，默认 auto。
4. reasoning 完成项按 app-server 字符串数组校验与投影，跨回合复位开块状态。
5. 包内 `pnpm test` 自动构建，根目录测试入口包含插件测试；包 README 记录操作与数据路径。

测试校准：官方源码 `other/codex/codex-rs/core/src/client.rs` 的 `reasoning_effort_for_request()` 将 ultra 映射为 Responses max，原生 turn_context 保留 ultra。T7 分别断言这两层字段。

流式测试校准：本地服务按 reasoning 项完成、message 项开始的顺序发送事件。摘要续传门和正文续传门分别控制两段增量，测试检查同类片段归属同一块、摘要和正文使用独立块。

### 涉及文件

- `packages/codex-cli/test/stream-reasoning.test.mjs`：T1、T2、T6–T10。
- `packages/codex-cli/test/session-stream.test.mjs`：T3–T5。
- `packages/codex-cli/test/support/harness.mjs`：真实服务装配、临时目录及原生日志读取。
- `packages/codex-cli/test/support/model-server.mjs`：受控分段响应及上游请求保存。
- `packages/codex-cli/src/index.ts`：即时交付与消费方收尾、辅助请求参数。
- `packages/codex-cli/src/turn.ts`：回合参数传递与块状态复位。
- `packages/codex-cli/src/protocol.ts`：官方请求字段与 reasoning 字符串数组校验。
- `packages/codex-cli/src/config.ts`：reasoningSummary 配置。
- `packages/codex-cli/package.json`、`package.json`：插件测试入口与根目录接入。
- `packages/codex-cli/README.md`：配置和测试说明。
- 本 task 文档：需求、测试、实现和实际验证结果。

## ④ 验证结果

### 红阶段

首批流式与 reasoning 用例经搭建校正后运行，真实失败为：

```text
node --test --test-concurrency=1 packages/codex-cli/test/stream-reasoning.test.mjs
tests 5 / pass 0 / fail 5
reasoning 完成项返回 undefined
reasoningSummary 默认值为 undefined
start: native session effort: xhigh != low
native session effort: xhigh != max
Timed out: plugin first text before completion

node --test packages/codex-cli/test/session-stream.test.mjs
tests 3 / pass 0 / fail 3
提前结束后 active.terminated=false
首块交付前 source failed
后续调用提前进入
```

首次运行受到沙箱本地端口监听限制（listen EPERM），使用相同命令提权后取得上述业务失败证据。原生进程由测试真实拉起，完成门验证了官方通知已到达而插件输出仍被缓存的路径。

日志复核补充了摘要片段索引断言，原有交错发送的测试响应使该断言失败（2 != 1）。将测试服务调整为逐项发送并加入摘要续传门后，该断言通过。

### 绿阶段

```text
KMH_CODEX_TEST_TMP=/private/tmp/kmh-codex-qdev-20261008 pnpm --filter @kmh/codex-cli test
tests 10
pass 10
fail 0
cancelled 0
skipped 0
duration_ms 2658.090625
```

程序版本为 `codex-cli 0.162.0-alpha.2`。完整输出保存在 `/private/tmp/kmh-codex-qdev-20261008-tests.log`；原生 session、上游请求和流式记录保存在 `/private/tmp/kmh-codex-qdev-20261008/`，每次运行产生独立子目录。

### 不变量回归

```text
CODEX_HOME=/private/tmp/kmh-codex-root-regression-20261008 KMH_CODEX_TEST_TMP=/private/tmp/kmh-codex-qdev-20261008 pnpm test
tests 136
pass 136
fail 0
cancelled 0
skipped 0
duration_ms 20890.069416
```

根目录回归包含10项新增用例，已有126项用例全部通过。补强摘要续传和分块归属断言后重新执行该命令，完整输出保存到 `/private/tmp/kmh-codex-qdev-20261008-root-regression.log`。该命令同时完成5个 KMH 插件的既有构建。

静态检查：`pnpm --filter @kmh/codex-cli typecheck`、`pnpm --filter @kmh/codex-cli lint`、本次修改文件和新增测试的 Prettier 检查、`git diff --check` 全部通过。包级 `format:check` 报出3个原有文件的格式问题：`src/client/LiveBall.tsx`、`src/cursor.ts`、`src/web.ts`；这些文件与 HEAD 一致，本次保留原样。

真实环境验收范围：上述测试使用真实官方 CLI 和本地模型响应，生产模型服务及现有 Web 进程的页面显示另行验收。当前服务进程保留，重新启动后加载本次构建。

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过
- [x] 实现在边界内
- [x] 不变量未破坏

### 后续运行验收（2026-10-09）

构建已加载到真实 Web；纠正重启进程继承的失效代理后，GPT-5.6-Luna / Medium 在网页显示正文与思考摘要。现场与恢复记录见 [连接故障调查](../../../../reports/cr/cr-report-20261009-000915.md)。后续重试状态、停止与请求时限修复见 [task-retry-status](task-retry-status.md)，其仓库回归继续覆盖本任务全部 10 项测试。
