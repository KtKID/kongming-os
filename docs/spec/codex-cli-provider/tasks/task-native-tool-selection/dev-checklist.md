# task-native-tool-selection · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat02（工具与技能隔离，修订版）场景1-3、5-7 与 feat05 场景1-2（详情页修订版）：原生工具逐项选择的允许清单隔离、能力可用性、旧总开关迁移与详情页 UI；同名工具按来源选择依赖 task-tool-registry 的 `kmh-` 前缀映射，建议在其后实施。feat02 场景4 中 KMH 工具目录变化部分由 task-tool-registry 覆盖，本 task 覆盖其原生选择与技能变化部分。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 能力清单与选择模型：定义受支持原生工具项（命令执行、文件修改、查看图片、网络搜索）与独立的原生技能选择；RuntimeSettings 从单开关扩展为选择集并持久化 | feat02 场景1 | packages/codex-cli/src/capabilities.ts, packages/codex-cli/src/config.ts, packages/codex-cli/src/index.ts | None | [ ] ⏳ |
| T2 | 允许清单隔离：基础隔离保留，未选项维持关闭、选中项按清单开放，图片生成默认保留；每个清单项以模型实际可见工具核对 | feat02 场景1 | packages/codex-cli/src/isolation.ts, packages/codex-cli/src/probe.ts | 高:清单遗漏或隔离失效即原生能力越界，验证不得只看 unit | [ ] ⏳ |
| T3 | 旧开关迁移：`nativeToolsEnabled` 布尔转换为实际能力选择并显示尚待接入项；默认关闭的旧配置保留原生图片生成与 KMH 工具现有使用方式 | feat02 场景7 | packages/codex-cli/src/config.ts, packages/codex-cli/src/index.ts | 高:迁移错判直接改变能力边界，smoke 验证新旧两值 | [ ] ⏳ |
| T4 | 能力可用性判定：清单项按本机版本、账号、模型与部署条件显示不可用及已知原因；已有选择保持可查看 | feat02 场景6 | packages/codex-cli/src/capabilities.ts | None | [ ] ⏳ |
| T5 | 隔离应用失败 fail-loud：所选能力的限制未应用时准备阶段显示明确错误并结束，可调整选择后重试 | feat02 场景5 | packages/codex-cli/src/isolation.ts | None | [ ] ⏳ |
| T6 | 详情页逐项选择：列表显示当前选择与每项可用状态，调整立即保存显示并说明下一回合生效；信息展示（feat05 场景1）含逐项选择与独立技能选择区 | feat05 场景1, 场景2 | packages/codex-cli/src/web.ts, packages/codex-cli/src/client/DetailCard.tsx, packages/codex-cli/src/client/locales.ts | None | [ ] ⏳ |
| T7 | 并存执行：选中原生工具与 KMH 工具并存，每次调用显示来源、同名按来源选择（`kmh-` 映射）、KMH 工具继续遵循 KMH 权限链 | feat02 场景3, feat01 场景1 | packages/codex-cli/src/isolation.ts, packages/codex-cli/src/adapter.ts | None | [ ] ⏳ |
| T8 | 选择变化下一回合生效：进行中的回合按其开始时的选择完成，下一回合使用最新能力集合 | feat02 场景4 | packages/codex-cli/src/index.ts, packages/codex-cli/src/adapter.ts | None | [ ] ⏳ |
| T9 | 原生技能独立选择：默认关闭下 `$技能名` 显式调用由 KMH 技能体系接管（新选择体系下复验既有实现）；选择开启后按原生执行 | feat02 场景2 | packages/codex-cli/src/isolation.ts | None | [ ] ⏳ |
| T10 | unit：清单定义、迁移映射、选择持久化、各选择组合的隔离计划生成 | feat02 场景1, 场景5, 场景7 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |
| T11 | smoke：真实 CLI 默认集合（模型只见 KMH 工具+原生图片生成）与选中开放项回合（来源与单次执行） | feat02 场景1, 场景3 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/src/
│   ├── capabilities.ts              U  # 新增：原生能力清单定义与可用性判定（版本/账号/模型/部署）
│   ├── config.ts                    M  # 逐项选择配置 schema 与旧开关迁移
│   ├── isolation.ts                 M  # 允许清单隔离计划（基础隔离+按清单开放）
│   ├── index.ts                     M  # RuntimeSettings 选择集与持久化
│   ├── probe.ts                     M  # 测试连接按当前选择执行隔离
│   ├── adapter.ts                   M  # 选择传入回合启动、并存与下一回合生效
│   ├── web.ts                       M  # config API 逐项读写
│   └── client/
│       ├── DetailCard.tsx           M  # 逐项选择列表 UI（选择+可用状态+下一回合生效说明）
│       └── locales.ts               M  # 选择区文案（中英）
└── tests/runtime/codex-cli.test.mjs M  # 追加：清单/迁移/隔离组合 unit 与两态 smoke
```
