---
description: Codex CLI Trace 的独立会话记录查看开发清单，回指已确认规格和技术设计。
---

# task-session-trace-view · 开发清单

> spec: docs/spec/codex-cli-trace/spec.md
> tech-design: docs/spec/codex-cli-trace/tech-design.md
> 创建: 2026-10-15
> spec 基线: SHA-256 `dd4f42bde6efacfdbc32b2992834a6bfccd0c01e499db4a0d5fc78efa30fe01b`
> tech-design 基线: `0.1-confirmed1`，SHA-256 `46a898077c462a62d93a7d09dbebca88e148c713a7683c9dc36e6d3c5eabc778`
> 确认依据: 用户 2026-10-15 回复“同意 /Volumes/machub_app/proj/kongming-os/packages 注意新增插件放这里”。

承接范围：feat01、feat02、feat03、feat05、feat06、feat07、feat08、feat10。用例责任：用例 T01、用例 T02、用例 T03、用例 T04、用例 T05、用例 T06、用例 T10、用例 T11、用例 T12、用例 T13、用例 T14、用例 T15、用例 T16、用例 T17、用例 T18、用例 T23、用例 T24。

新增插件的源码、构建定义与包内测试位于 `packages/codex-cli-trace/`。本 task 在下列文件范围内开发；GIVEN/WHEN/THEN 与用例正文分别回指 spec 和 tech-design。自动化新行为先写测试并确认目标行为造成的有效红灯，再实现；独立集成验收行直接取证，既有满足项如实记录。高风险行的验证包含 Host/文件集成或实际浏览器链路。

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| #   | 任务                                                                                                                                                                                                                       | 场景回指                                                                                                                                                                 | 涉及文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 风险                                                            | 状态   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| T1  | 先写文件/Host smoke 与槽位测试，再实现只读关联定位、初始读取、独立路由和会话标签，接入 Web profile；取真实浏览器与装卸证据（C1、C2、C5、C6；D01、D02；用例 T01、T02、T03、T04）                                            | feat01 场景1,2,3,4, feat02 场景1,2,3,4,5                                                                                                                                 | `packages/codex-cli-trace/src/bindings.ts`, `packages/codex-cli-trace/src/source.ts`, `packages/codex-cli-trace/src/reader.ts`, `packages/codex-cli-trace/src/projector.ts`, `packages/codex-cli-trace/src/web.ts`, `packages/codex-cli-trace/src/index.ts`, `packages/codex-cli-trace/src/client/index.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/src/client/state.ts`, `packages/codex-cli-trace/src/client/locales.ts`, `packages/codex-cli-trace/src/client/styles.ts`, `packages/codex-cli-trace/test/bindings.test.mjs`, `packages/codex-cli-trace/test/source.test.mjs`, `packages/codex-cli-trace/test/web.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`, `packages/codex-cli-trace/test/fixtures.mjs`, `package.json`, `pnpm-lock.yaml`, `profiles/kmh-web/package.json`, `profiles/kmh-web/cordis.patch.yml` | 高:认证入口、会话归属与请求取消；需 Host smoke 和实际浏览器证据 | [x] 🟢 |
| T2  | 先写 projector/组件测试，再实现回合列表、当前回合选择与部分记录提示，并以浏览器验证两轮切换（C2、C5；D03；用例 T05、T06）                                                                                                  | feat03 场景1,2,3,5                                                                                                                                                       | `packages/codex-cli-trace/src/projector.ts`, `packages/codex-cli-trace/src/reader.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/src/client/state.ts`, `packages/codex-cli-trace/test/projector.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | None                                                            | [x] 🟢 |
| T3  | 先写排序、模型和摘要的 unit/组件测试，再实现时间线条目与详情，补浏览器观察（C3；D05；用例 T10、T11、T12、T13）                                                                                                             | feat05 场景1,2,3,4,5,6                                                                                                                                                   | `packages/codex-cli-trace/src/projector.ts`, `packages/codex-cli-trace/src/rollout-schema.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/test/projector.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | None                                                            | [x] 🟢 |
| T4  | 先写调用合并、技能证据与长文本测试，再实现参数/结果/失败详情与分类；用真实源文件作只读核对（C3；D06；用例 T14、T15）                                                                                                       | feat06 场景1,2,3,4,5,6                                                                                                                                                   | `packages/codex-cli-trace/src/projector.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/test/projector.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | None                                                            | [x] 🟢 |
| T5  | 先写耗时单位和缺失值测试，再实现耗时显示与来源标签；补界面断言（C3；D07；用例 T16）                                                                                                                                        | feat07 场景1,2,3                                                                                                                                                         | `packages/codex-cli-trace/src/projector.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/test/projector.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | None                                                            | [x] 🟢 |
| T6  | 先写查询/Host smoke、迟到响应和详情失败测试，再实现全已读内容搜索、类别/异常筛选及局部失败反馈；取浏览器证据（C3；D08；用例 T17、T18）                                                                                     | feat08 场景1,2,3,4,5                                                                                                                                                     | `packages/codex-cli-trace/src/reader.ts`, `packages/codex-cli-trace/src/protocol.ts`, `packages/codex-cli-trace/src/web.ts`, `packages/codex-cli-trace/src/client/state.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/test/query.test.mjs`, `packages/codex-cli-trace/test/web.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 高:并发查询与旧响应隔离；需 Host smoke 和实际浏览器证据         | [x] 🟢 |
| T7  | 先写源位置、变化检测和坏行的文件/Host smoke，再实现原文与记录范围说明；补页面观察（C3、C5；D10；用例 T23、T24）                                                                                                            | feat10 场景1,2,3,4                                                                                                                                                       | `packages/codex-cli-trace/src/source.ts`, `packages/codex-cli-trace/src/reader.ts`, `packages/codex-cli-trace/src/protocol.ts`, `packages/codex-cli-trace/src/web.ts`, `packages/codex-cli-trace/src/client/TraceView.tsx`, `packages/codex-cli-trace/test/source.test.mjs`, `packages/codex-cli-trace/test/web.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 高:异步读取期间源文件变化；需文件集成与 Host smoke              | [x] 🟢 |
| T8  | 完成本 task 全量回归、实际 Web 标签/宽窄窗/深浅主题验证及执行插件关闭后的历史读取；记录各用例证据并写接入说明（C1、C2、C3、C5、C6；D01、D02、D03、D05、D06、D07、D08、D10；用例 T01–T06、T10–T18、T23、T24；独立集成验收） | feat01 场景1,2,3,4, feat02 场景1,2,3,4,5, feat03 场景1,2,3,5, feat05 场景1,2,3,4,5,6, feat06 场景1,2,3,4,5,6, feat07 场景1,2,3, feat08 场景1,2,3,4,5, feat10 场景1,2,3,4 | `packages/codex-cli-trace/README.md`, `packages/codex-cli-trace/test/web.test.mjs`, `packages/codex-cli-trace/test/client.test.mjs`, `packages/codex-cli-trace/test/browser-harness.mjs`, `tests/runtime/web-plugin-hmr.test.mjs`, `docs/kmh/plugin-index.md`, `profiles/kmh-web/README.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 高:真实 profile 接入及插件卸载；需实际 Web 链路与既有回归       | [x] 🟢 |

## 影响文件树

下列 U/M 标记以本 task 开始时的预期状态为准；先前 task 已创建的包内文件在此标为 M。

```text
kongming-os/
├── docs/
│   └── kmh/
│       └── plugin-index.md  M  # 登记新插件的使用入口
├── package.json  M  # 维护包依赖、导出或工作区检查入口
├── packages/
│   └── codex-cli-trace/
│       ├── README.md  U  # 说明已验证的配置、使用和失败处理
│       ├── src/
│       │   ├── bindings.ts  U  # 只读当前会话与 CLI ID 的对应关系
│       │   ├── client/
│       │   │   ├── TraceView.tsx  U  # 展示当前会话记录并处理用户操作
│       │   │   ├── index.ts  M  # 登记会话标签和语言字典
│       │   │   ├── locales.ts  U  # 维护中英文界面文案
│       │   │   ├── state.ts  U  # 隔离选中项、请求和刷新状态
│       │   │   └── styles.ts  U  # 复用主题变量定义界面样式
│       │   ├── index.ts  M  # 拥有插件装载、路由与资源清理
│       │   ├── projector.ts  U  # 整理回合、调用、用量和耗时
│       │   ├── protocol.ts  M  # 定义共享 Zod 请求与响应协议
│       │   ├── reader.ts  U  # 协调当前索引、读取和失效
│       │   ├── rollout-schema.ts  M  # 校验 CLI 已有记录的支持字段
│       │   ├── source.ts  U  # 定位并核对当前 CLI 原始文件
│       │   └── web.ts  U  # 挂载已认证的只读查询或导出路由
│       └── test/
│           ├── bindings.test.mjs  U  # 验证已有对应关系的只读消费
│           ├── browser-harness.mjs  U  # 真实组件与隔离文件的浏览器验收服务
│           ├── client.test.mjs  U  # 验证浏览器状态和组件边界
│           ├── fixtures.mjs  M  # 创建隔离临时记录和可控测试资源
│           ├── projector.test.mjs  U  # 验证回合、调用、状态和耗时投影
│           ├── query.test.mjs  U  # 验证完整内容搜索和筛选
│           ├── source.test.mjs  U  # 验证文件定位、来源和变化处理
│           └── web.test.mjs  U  # 验证真实 Host 路由与取消行为
├── pnpm-lock.yaml  M  # 记录新插件的工作区依赖解析
├── tests/
│   └── runtime/
│       └── web-plugin-hmr.test.mjs  M  # 临时 Web 工程同步接入新包
└── profiles/
    └── kmh-web/
        ├── README.md  M  # 说明 Web 插件接入与归属
        ├── cordis.patch.yml  M  # 独立挂载 trace 及其来源配置
        └── package.json  M  # 接入新插件的 profile 依赖
```

## 验证与证据归属

用例定义引用技术设计中的唯一主定义。包内测试使用各自的临时数据根；执行结束后等待读取和服务清理再删除目录。真实会话核对只读源文件，原始导出和含个人记录的运行材料保留在本机忽略或临时目录，报告记录可定位路径、基线和对账结论。开发完成后在本 task 生成 dev-report.md，按已确认流程进行规格与技术验收。
