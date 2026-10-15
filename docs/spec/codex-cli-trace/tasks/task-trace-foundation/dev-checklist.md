---
description: Codex CLI Trace 的插件基础与共享协议开发清单，回指已确认规格和技术设计。
---

# task-trace-foundation · 开发清单

> spec: docs/spec/codex-cli-trace/spec.md
> tech-design: docs/spec/codex-cli-trace/tech-design.md
> 创建: 2026-10-15
> spec 基线: SHA-256 `dd4f42bde6efacfdbc32b2992834a6bfccd0c01e499db4a0d5fc78efa30fe01b`
> tech-design 基线: `0.1-confirmed1`，SHA-256 `46a898077c462a62d93a7d09dbebca88e148c713a7683c9dc36e6d3c5eabc778`
> 确认依据: 用户 2026-10-15 回复“同意 /Volumes/machub_app/proj/kongming-os/packages 注意新增插件放这里”。

承接范围：公共技术支撑；功能和约束用例的完整验收由后续 task 承接。用例责任：无独立产品用例；校验包结构、构建和共享协议，产品用例在后续 task 主验收。

新增插件的源码、构建定义与包内测试位于 `packages/codex-cli-trace/`。本 task 在下列文件范围内开发；GIVEN/WHEN/THEN 与用例正文分别回指 spec 和 tech-design。协议等自动化新行为先写测试并确认目标行为造成的有效红灯，再实现；脚手架行按构建和导入 smoke 取证，缺包或环境错误先修复；独立集成验收行直接取证，既有满足项如实记录。高风险行的验证包含 Host/文件集成或实际浏览器链路。

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| #   | 任务                                                                                                                                                 | 场景回指 | 涉及文件                                                                                                                                                                                                                                                                                                                                                                                             | 风险 | 状态   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| T1  | 创建 packages 下的独立包、严格 TS 配置、Host/Client 最小装载与构建入口，并以构建/导入 smoke 和 typecheck 取证；脚手架按既有构建约定落地（C6；D01）   | None     | `packages/codex-cli-trace/package.json`, `packages/codex-cli-trace/build.mjs`, `packages/codex-cli-trace/tsconfig.json`, `packages/codex-cli-trace/tsconfig.host.json`, `packages/codex-cli-trace/tsconfig.browser.json`, `packages/codex-cli-trace/src/index.ts`, `packages/codex-cli-trace/src/client/index.ts`, `packages/codex-cli-trace/src/config.ts`, `packages/codex-cli-trace/src/paths.ts` | None | [x] 🟢 |
| T2  | 先写共享边界校验 unit 测试，确认预期原因失败，再实现 Zod 协议、CLI 输入形态校验与隔离 fixture；浏览器共用同一 schema（D02、D04、D10、D11；技术支撑） | None     | `packages/codex-cli-trace/src/protocol.ts`, `packages/codex-cli-trace/src/rollout-schema.ts`, `packages/codex-cli-trace/test/protocol.test.mjs`, `packages/codex-cli-trace/test/fixtures.mjs`                                                                                                                                                                                                        | None | [x] 🟢 |

## 影响文件树

下列 U/M 标记以本 task 开始时的预期状态为准；先前 task 已创建的包内文件在此标为 M。

```text
kongming-os/
└── packages/
    └── codex-cli-trace/
        ├── build.mjs  U  # 构建独立 Host 与浏览器模块
        ├── package.json  U  # 维护包依赖、导出或工作区检查入口
        ├── src/
        │   ├── client/
        │   │   └── index.ts  U  # 登记会话标签和语言字典
        │   ├── config.ts  U  # 定义只读来源和刷新配置
        │   ├── index.ts  U  # 拥有插件装载、路由与资源清理
        │   ├── paths.ts  U  # 维护接口路径与具名常量
        │   ├── protocol.ts  U  # 定义共享 Zod 请求与响应协议
        │   └── rollout-schema.ts  U  # 校验 CLI 已有记录的支持字段
        ├── test/
        │   ├── fixtures.mjs  U  # 创建隔离临时记录和可控测试资源
        │   └── protocol.test.mjs  U  # 验证共享协议及输入校验
        ├── tsconfig.browser.json  U  # 启用严格浏览器类型检查
        ├── tsconfig.host.json  U  # 启用严格 Host 类型检查
        └── tsconfig.json  U  # 组合 Host 与浏览器编译配置
```

## 验证与证据归属

用例定义引用技术设计中的唯一主定义。包内测试使用各自的临时数据根；执行结束后等待读取和服务清理再删除目录。真实会话核对只读源文件，原始导出和含个人记录的运行材料保留在本机忽略或临时目录，报告记录可定位路径、基线和对账结论。开发完成后在本 task 生成 dev-report.md，按已确认流程进行规格与技术验收。
