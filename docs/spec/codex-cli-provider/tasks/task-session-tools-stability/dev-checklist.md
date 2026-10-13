# task-session-tools-stability · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> tech-design: docs/spec/codex-cli-provider/tech-design.md
> 创建: 2026-10-13
> 承接范围: 本轮 v0.3 增量，见同目录 req-allocation.md；存量 task 记录保留。

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 先测试后实现保存字段、损坏错误与串行写入（C1、C2、C3；D02、D08；用例 T1、T4、T5；unit + profile smoke） | feat03 场景1, 场景2, 场景7 | packages/codex-cli/src/session-store.ts, packages/codex-cli/src/config.ts, packages/codex-cli/package.json, pnpm-lock.yaml, packages/codex-cli/test/session-store.test.mjs, packages/codex-cli/src/index.ts | 高:原 ID 和工具选择必须可靠保存 | [x] 🟢 |
| T2 | 先测试后实现创建时固定工具、按原选择执行及可选共享目录（C1、C4；D01、D03、D07；用例 T1、T3、T8；真实 profile） | feat01 场景1, feat02 场景1, 场景3, 场景4, 场景5, 场景6, feat05 场景5 | packages/codex-cli/src/tool-policy.ts, packages/codex-cli/src/index.ts, packages/codex-cli/test/tool-policy.test.mjs, packages/codex-cli/test/support/profile-harness.mjs, packages/codex-cli/test/support/model-server.mjs | 高:配置与工具执行在创建和续聊期间交错 | [x] 🟢 |
| T3 | 先测试后实现原 ID 恢复、及时保存与完整增量，检查普通进度（C1、C2、C3；D02、D04、D09；用例 T2、T3、T4、T6、T11；官方 CLI 集成 + owning snapshot） | feat02 场景4, feat03 场景1, 场景2, 场景8, 场景9, 场景10, 场景11 | packages/codex-cli/src/adapter.ts, packages/codex-cli/src/turn.ts, packages/codex-cli/src/index.ts, packages/codex-cli/test/tool-policy.test.mjs, packages/codex-cli/test/support/profile-harness.mjs, packages/codex-cli/test/support/model-server.mjs, packages/codex-cli/test/fixtures/session-tools.expected.json | 高:原会话恢复及历史单份 | [x] 🟢 |
| T4 | 先测试后实现源配置继承和原生分叉增量（C5；D05；用例 T17、T18；官方 CLI 集成；精确事件内部位置保持未验证） | feat03 场景5, 场景6 | packages/codex-cli/src/adapter.ts, packages/codex-cli/src/turn.ts, packages/codex-cli/src/protocol.ts, packages/codex-cli/src/tool-policy.ts, packages/codex-cli/test/tool-policy.test.mjs, packages/codex-cli/test/support/profile-harness.mjs | 高:父子会话与原生历史必须独立保留 | [x] 🟢 |
| T5 | 更新生效提示和恢复说明，并验证 Selector 独立启停（C4；D07；用例 T8；Web/组件 + profile） | feat05 场景1, 场景2, 场景5 | packages/codex-cli/src/client/DetailCard.tsx, packages/codex-cli/src/client/locales.ts, packages/codex-cli/README.md, packages/codex-cli/test/tool-policy.test.mjs | None | [x] 🟢 |
| T6 | 执行全部承接用例、包回归和静态检查，记录真实链路结果（C1–C5；D01–D05、D07–D09；用例 T1–T6、T8、T11、T17、T18） | feat01 场景1, feat02 场景1, 场景3, 场景4, 场景5, 场景6, feat03 场景1, 场景2, 场景5, 场景6, 场景7, 场景8, 场景9, 场景10, 场景11, feat05 场景1, 场景2, 场景5 | packages/codex-cli/test/session-store.test.mjs, packages/codex-cli/test/tool-policy.test.mjs, packages/codex-cli/test/fixtures/session-tools.expected.json, packages/codex-cli/test/retry-status.test.mjs, tests/runtime/codex-cli.test.mjs | 高:恢复、持久化、工具实际执行需真实链路取证 | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── pnpm-lock.yaml  M  # 同步已有公开品牌类型库依赖
├── packages/codex-cli/
│   ├── package.json  M  # 声明公开品牌类型库
│   ├── README.md  M  # 生效规则与旧记录升级说明
│   ├── src/
│   │   ├── adapter.ts  M  # 新建、恢复与原生分叉
│   │   ├── config.ts  M  # 共享选择校验与客户端可执行检查
│   │   ├── index.ts  M  # 保存原工具与原生编号
│   │   ├── protocol.ts  M  # 官方分叉字段校验
│   │   ├── session-store.ts  M  # 文件校验与写入顺序
│   │   ├── tool-policy.ts  M  # 创建时固定工具与独立执行
│   │   ├── turn.ts  M  # 保存编号后发送输入
│   │   └── client/
│   │       ├── DetailCard.tsx  M  # 生效提示
│   │       └── locales.ts  M  # 中英文提示
│   └── test/
│       ├── retry-status.test.mjs  M  # 补齐客户端夹具接口
│       ├── session-store.test.mjs  U  # 文件与保存失败
│       ├── tool-policy.test.mjs  M  # 实际配置、工具、会话和 Selector
│       ├── fixtures/session-tools.expected.json  U  # 原 ID 和工具的预期记录
│       └── support/
│           ├── model-server.mjs  M  # 模型请求记录与指定调用
│           └── profile-harness.mjs  M  # 真实 profile、持久化和插件装卸
└── tests/runtime/codex-cli.test.mjs  M  # 更新旧行为断言与隔离夹具
```

配置校验、公开品牌类型库依赖与旧测试夹具是已确认机制的实现支撑，功能范围保持 req-allocation.md 的分配。
