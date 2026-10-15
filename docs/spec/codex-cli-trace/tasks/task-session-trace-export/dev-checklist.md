---
description: Codex CLI Trace 的当前会话记录导出开发清单，回指已确认规格和技术设计。
---

# task-session-trace-export · 开发清单

> spec: docs/spec/codex-cli-trace/spec.md
> tech-design: docs/spec/codex-cli-trace/tech-design.md
> 创建: 2026-10-15
> spec 基线: SHA-256 `dd4f42bde6efacfdbc32b2992834a6bfccd0c01e499db4a0d5fc78efa30fe01b`
> tech-design 基线: `0.1-confirmed1`，SHA-256 `46a898077c462a62d93a7d09dbebca88e148c713a7683c9dc36e6d3c5eabc778`
> 确认依据: 用户 2026-10-15 回复“同意 /Volumes/machub_app/proj/kongming-os/packages 注意新增插件放这里”。

承接范围：feat11。用例责任：用例 T25、用例 T26、用例 T27。

新增插件的源码、构建定义与包内测试位于 `packages/codex-cli-trace/`。本 task 在下列文件范围内开发；GIVEN/WHEN/THEN 与用例正文分别回指 spec 和 tech-design。自动化新行为先写测试并确认目标行为造成的有效红灯，再实现；独立集成验收行直接取证，既有满足项如实记录。高风险行的验证包含 Host/文件集成或实际浏览器链路。

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| #   | 任务                                                                                                                                   | 场景回指                 | 涉及文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 风险                                                                | 状态   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| T1  | 先写完整 session、页面筛选与长内容的导出集成测试，再实现导出格式、路由和下载入口（C4、C5；D11；用例 T25）                              | feat11 场景1,2,7         | `packages/codex-cli-trace/src/export.ts`, `packages/codex-cli-trace/src/protocol.ts`, `packages/codex-cli-trace/src/paths.ts`, `packages/codex-cli-trace/src/web.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/src/client/state.ts`, `packages/codex-cli-trace/src/client/locales.ts`, `packages/codex-cli-trace/test/export.test.mjs`, `packages/codex-cli-trace/test/web.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs` | None                                                                | [x] 🟢 |
| T2  | 先用 barrier 写导出中追加、半行、坏行和截止范围集成测试，再实现两次读取校验、字节摘要与缺口封装（C4、C5；D11；用例 T26）               | feat11 场景3,4           | `packages/codex-cli-trace/src/export.ts`, `packages/codex-cli-trace/src/source.ts`, `packages/codex-cli-trace/test/export.test.mjs`, `packages/codex-cli-trace/test/fixtures.mjs`                                                                                                                                                                                                                                                                                           | 高:读取与文件持续追加并发；需真实文件/流式导出集成                  | [x] 🟢 |
| T3  | 先写空关联、源变更、流取消和失败重试的 Host/客户端测试，再实现失败反馈和请求清理（C4、C5；D11；用例 T27）                              | feat11 场景5,6           | `packages/codex-cli-trace/src/export.ts`, `packages/codex-cli-trace/src/reader.ts`, `packages/codex-cli-trace/src/web.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/src/client/state.ts`, `packages/codex-cli-trace/test/export.test.mjs`, `packages/codex-cli-trace/test/web.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`                                                                                                                                        | 高:导出流取消、源文件变化与页面重试并发；需 Host smoke 和浏览器验证 | [x] 🟢 |
| T4  | 完成本 task 全量回归、真实浏览器下载后内容/摘要对账与既有测试回归，记录导出说明和证据（C4、C5；D11；用例 T25、T26、T27；独立集成验收） | feat11 场景1,2,3,4,5,6,7 | `packages/codex-cli-trace/README.md`, `packages/codex-cli-trace/test/export.test.mjs`, `packages/codex-cli-trace/test/web.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`                                                                                                                                                                                                                                                                                        | 高:真实下载与活动源文件读取；需实际下载文件核对                     | [x] 🟢 |

## 影响文件树

下列 U/M 标记以本 task 开始时的预期状态为准；先前 task 已创建的包内文件在此标为 M。

```text
kongming-os/
└── packages/
    └── codex-cli-trace/
        ├── README.md  M  # 说明已验证的配置、使用和失败处理
        ├── src/
        │   ├── client/
        │   │   ├── TraceView.tsx  M  # 展示当前会话记录并处理用户操作
        │   │   ├── locales.ts  M  # 维护中英文界面文案
        │   │   └── state.ts  M  # 隔离选中项、请求和刷新状态
        │   ├── export.ts  U  # 生成带截止范围和原文的导出流
        │   ├── paths.ts  M  # 维护接口路径与具名常量
        │   ├── protocol.ts  M  # 定义共享 Zod 请求与响应协议
        │   ├── source.ts  M  # 定位并核对当前 CLI 原始文件
        │   ├── reader.ts  M  # 将导出准备与流纳入取消和卸载等待
        │   └── web.ts  M  # 挂载已认证的只读查询或导出路由
        └── test/
            ├── client.test.mjs  M  # 验证浏览器状态和组件边界
            ├── export.test.mjs  U  # 验证导出内容、截止范围与流失败
            ├── fixtures.mjs  M  # 创建隔离临时记录和可控测试资源
            └── web.test.mjs  M  # 验证真实 Host 路由与取消行为
```

## 验证与证据归属

用例定义引用技术设计中的唯一主定义。包内测试使用各自的临时数据根；执行结束后等待读取和服务清理再删除目录。真实会话核对只读源文件，原始导出和含个人记录的运行材料保留在本机忽略或临时目录，报告记录可定位路径、基线和对账结论。开发完成后在本 task 生成 dev-report.md，按已确认流程进行规格与技术验收。
