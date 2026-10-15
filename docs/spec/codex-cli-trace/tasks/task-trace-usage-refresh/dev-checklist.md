---
description: Codex CLI Trace 的用量统计与文件增量更新开发清单，回指已确认规格和技术设计。
---

# task-trace-usage-refresh · 开发清单

> spec: docs/spec/codex-cli-trace/spec.md
> tech-design: docs/spec/codex-cli-trace/tech-design.md
> 创建: 2026-10-15
> spec 基线: SHA-256 `dd4f42bde6efacfdbc32b2992834a6bfccd0c01e499db4a0d5fc78efa30fe01b`
> tech-design 基线: `0.1-confirmed1`，SHA-256 `46a898077c462a62d93a7d09dbebca88e148c713a7683c9dc36e6d3c5eabc778`
> 确认依据: 用户 2026-10-15 回复“同意 /Volumes/machub_app/proj/kongming-os/packages 注意新增插件放这里”。

承接范围：feat04、feat09。用例责任：用例 T07、用例 T08、用例 T09、用例 T19、用例 T20、用例 T21、用例 T22。

新增插件的源码、构建定义与包内测试位于 `packages/codex-cli-trace/`。本 task 在下列文件范围内开发；GIVEN/WHEN/THEN 与用例正文分别回指 spec 和 tech-design。自动化新行为先写测试并确认目标行为造成的有效红灯，再实现；独立集成验收行直接取证，既有满足项如实记录。高风险行的验证包含 Host/文件集成或实际浏览器链路。

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| #   | 任务                                                                                                                                             | 场景回指                                       | 涉及文件                                                                                                                                                                                                                                                                                                                               | 风险                                                         | 状态   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| T1  | 先写逐响应/累计用量和重复记录测试，再实现用量及概览，补 Host/浏览器核对（C3；D04；用例 T07、T08、T09）                                           | feat04 场景1,2,3,4,5,6                         | `packages/codex-cli-trace/src/projector.ts`, `packages/codex-cli-trace/src/client/locales.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/test/usage.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`                                                                                                                                      | None                                                         | [x] 🟢 |
| T2  | 先用临时文件与 barrier 写增量、半行、替换和停止增长的集成测试，再实现增量读取与读取代失效（C1、C5；D09；用例 T19、T21）                          | feat09 场景1,3,4,5                             | `packages/codex-cli-trace/src/reader.ts`, `packages/codex-cli-trace/src/source.ts`, `packages/codex-cli-trace/test/reader.test.mjs`, `packages/codex-cli-trace/test/fixtures.mjs`                                                                                                                                                      | 高:文件追加/替换与重叠读取；需真实文件集成和 Host smoke      | [x] 🟢 |
| T3  | 先写可控时钟、迟到响应和阅读位置测试，再实现活跃页每秒刷新、错误恢复、跳到最新与关闭清理；取真实浏览器证据（C1、C5；D09；用例 T20、T22）         | feat09 场景2,6                                 | `packages/codex-cli-trace/src/index.ts`, `packages/codex-cli-trace/src/reader.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/src/client/state.ts`, `packages/codex-cli-trace/test/reader.test.mjs`, `packages/codex-cli-trace/test/web.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs` | 高:轮询、取消和卸载竞态；需 Host smoke 与真实浏览器验证      | [x] 🟢 |
| T4  | 完成本 task 全量回归、两个隔离进程的资源验证及真实会话用量/更新对账，更新说明（C1、C3、C5；D04、D09；用例 T07、T08、T09、T19–T22；独立集成验收） | feat04 场景1,2,3,4,5,6, feat09 场景1,2,3,4,5,6 | `packages/codex-cli-trace/README.md`, `packages/codex-cli-trace/test/usage.test.mjs`, `packages/codex-cli-trace/test/reader.test.mjs`, `packages/codex-cli-trace/test/web.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`                                                                                                   | 高:多个读取实例与活动刷新共享宿主；需独立进程集成及 Web 证据 | [x] 🟢 |

## 影响文件树

下列 U/M 标记以本 task 开始时的预期状态为准；先前 task 已创建的包内文件在此标为 M。

```text
kongming-os/
└── packages/
    └── codex-cli-trace/
        ├── README.md  M  # 说明已验证的配置、使用和失败处理
        ├── src/
        │   ├── client/
        │   │   ├── locales.ts  M  # 用量明细与更新提示文案
        │   │   ├── TraceView.tsx  M  # 展示当前会话记录并处理用户操作
        │   │   └── state.ts  M  # 隔离选中项、请求和刷新状态
        │   ├── index.ts  M  # 拥有插件装载、路由与资源清理
        │   ├── projector.ts  M  # 整理回合、调用、用量和耗时
        │   ├── reader.ts  M  # 协调当前索引、读取和失效
        │   └── source.ts  M  # 定位并核对当前 CLI 原始文件
        └── test/
            ├── client.test.mjs  M  # 验证浏览器状态和组件边界
            ├── fixtures.mjs  M  # 创建隔离临时记录和可控测试资源
            ├── reader.test.mjs  U  # 验证追加、半行、并发与清理
            ├── usage.test.mjs  U  # 验证逐响应用量与去重口径
            └── web.test.mjs  M  # 验证真实 Host 路由与取消行为
```

## 验证与证据归属

用例定义引用技术设计中的唯一主定义。包内测试使用各自的临时数据根；执行结束后等待读取和服务清理再删除目录。真实会话核对只读源文件，原始导出和含个人记录的运行材料保留在本机忽略或临时目录，报告记录可定位路径、基线和对账结论。开发完成后在本 task 生成 dev-report.md，按已确认流程进行规格与技术验收。
