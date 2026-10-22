---
description: Remote 保存与查看核心任务的场景、用例分配和开发执行状态。
---

# task-access-records-core · 开发清单

> spec: docs/spec/kmh-remote-access-records/spec.md
> tech-design: docs/spec/kmh-remote-access-records/tech-design.md
> 创建: 2026-10-23

授权：用户同意已落盘设计并要求 req、dev、verify。范围为 feat01、feat02；内容基线见 baselines/。每个场景唯一承接用例，参数组沿用设计主定义。行序为开发执行顺序。

| #   | 任务                                                   | 场景回指                       | 涉及文件                                                                                                                                                                                                                                                                  | 风险                              | 状态   |
| --- | ------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------ |
| T1  | 公共约定、构建及测试配置                               | None                           | packages/kmh-remote/{package.json,build.mjs,tsconfig.json,eslint.config.mjs,vitest.config.ts,test/access-records-coverage.mjs}, pnpm-lock.yaml                                                                                                                            | None                              | [x] 🟢 |
| T2  | 先测试后实现 SAVE-01（集成；主定义见技术设计）         | feat01 场景1                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:记录持久化、密码结果接线或并发 | [x] 🟢 |
| T3  | 先测试后实现 SAVE-02（集成；主定义见技术设计）         | feat01 场景2                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:记录持久化、密码结果接线或并发 | [x] 🟢 |
| T4  | 先测试后实现 SAVE-03（集成；主定义见技术设计）         | feat01 场景3                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:记录持久化、密码结果接线或并发 | [x] 🟢 |
| T5  | 先测试后实现 SAVE-04（集成；主定义见技术设计）         | feat01 场景4                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:记录持久化、密码结果接线或并发 | [x] 🟢 |
| T6  | 先测试后实现 SAVE-05（集成；主定义见技术设计）         | feat01 场景5                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:记录持久化、密码结果接线或并发 | [x] 🟢 |
| T7  | 先测试后实现 SAVE-06（集成；主定义见技术设计）         | feat01 场景6                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:记录持久化、密码结果接线或并发 | [x] 🟢 |
| T8  | 先测试后实现 SAVE-07（集成；主定义见技术设计）         | feat01 场景7                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:记录持久化、密码结果接线或并发 | [x] 🟢 |
| T9  | 先测试后实现 SAVE-08（集成；主定义见技术设计）         | feat01 场景8                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:记录持久化、密码结果接线或并发 | [x] 🟢 |
| T10 | 先测试后实现 VIEW-01（集成及浏览器；主定义见技术设计） | feat02 场景1                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | None                              | [x] 🟢 |
| T11 | 先测试后实现 VIEW-02（集成及浏览器；主定义见技术设计） | feat02 场景2                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | None                              | [x] 🟢 |
| T12 | 先测试后实现 VIEW-03（集成及浏览器；主定义见技术设计） | feat02 场景3                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:本机权限与持久化查询           | [x] 🟢 |
| T13 | 先测试后实现 VIEW-04（集成及浏览器；主定义见技术设计） | feat02 场景4                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:本机权限与持久化查询           | [x] 🟢 |
| T14 | 先测试后实现 VIEW-05（集成及浏览器；主定义见技术设计） | feat02 场景5                   | packages/kmh-remote/{shared/access-records.ts,host/access-records.ts,host/proxy.mjs,host/service.mjs,host/index.js,host/web-rpc.js,client/RemotePluginPanel.tsx,client/index.jsx,client/pocket-locales.js,test/access-records.spec.ts,test/access-records-panel.spec.tsx} | 高:本机权限与持久化查询           | [x] 🟢 |
| T15 | 专项全量、既有回归、类型/lint/格式、浏览器及覆盖率验收 | feat01 场景1-8, feat02 场景1-5 | packages/kmh-remote/README.md, docs/spec/README.md, docs/spec/kmh-remote-access-records/tasks/                                                                                                                                                                            | 高:完整链路验收                   | [x] 🟢 |

## 影响文件树

```text
kongming-os-remote-access/
├── pnpm-lock.yaml M # 测试依赖锁定
├── docs/spec/README.md M # 交付入口
├── docs/spec/kmh-remote-access-records/tasks/ U # 分配、基线和证据
└── packages/kmh-remote/
    ├── shared/access-records.ts U # 保存、查看及其验证
    ├── host/access-records.ts U # 保存、查看及其验证
    ├── client/RemotePluginPanel.tsx U # 保存、查看及其验证
    ├── host/proxy.mjs M # 保存、查看及其验证
    ├── host/service.mjs M # 保存、查看及其验证
    ├── host/index.js M # 保存、查看及其验证
    ├── host/web-rpc.js M # 保存、查看及其验证
    ├── client/index.jsx M # 保存、查看及其验证
    ├── client/pocket-locales.js M # 保存、查看及其验证
    ├── build.mjs M # 保存、查看及其验证
    ├── tsconfig.json M # 保存、查看及其验证
    ├── eslint.config.mjs M # 保存、查看及其验证
    ├── package.json M # 保存、查看及其验证
    ├── vitest.config.ts U # 保存、查看及其验证
    ├── test/access-records.spec.ts U # 保存、查看及其验证
    ├── test/access-records-panel.spec.tsx U # 保存、查看及其验证
    ├── test/access-records-coverage.mjs U # 四项覆盖率门槛
    ├── README.md M # 保存、查看及其验证
```

所有行共用上述影响范围；README 随最终行为同步。专项原始输出位于本任务 evidence/，私有临时 Home 与浏览器截图保留在忽略目录。全仓额外检查的依赖缺口单列于 dev-report；本表的既有回归范围为受影响 Remote 包。
