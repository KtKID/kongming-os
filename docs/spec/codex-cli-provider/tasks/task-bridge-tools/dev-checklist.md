# task-bridge-tools · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat01（KMH 提示与工具执行）与 feat02（工具与技能隔离）：模型调用的桥接核心——差分游标、kmh_call_tool 调用桥、工具挂起循环与原生能力隔离。依赖 task-scaffold-protocol。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 模型目录：model/list 分页聚合、模型与推理等级映射为 LlmModelInfo/LlmResolvedModelInfo，默认取目录首选 | feat01 场景4 | packages/codex-cli/src/models.ts | None | [x] 🟢 |
| T2 | 差分游标：全量 derived history 与已投快照的前缀对齐（MessageId+内容指纹）、尾部增量切分、基线丢失报恢复错误；system 提示映射 thread instructions 不进差分 | feat01 场景1, feat03 场景2 | packages/codex-cli/src/cursor.ts | 高:差分错误导致上下文重复或丢失，需 smoke 验证 token 用量曲线 | [x] 🟢 |
| T3 | adapter stream 基础投影：thread 创建/恢复、turn 发起，Codex 流事件投影为 StreamChunk（text/reasoning delta、finish、usage 只在 turn 终局报） | feat01 场景1 | packages/codex-cli/src/adapter.ts | None | [x] 🟢 |
| T4 | 工具循环：thread 绑定稳定 `kmh_call_tool` 桥、KMH 工具表映射桥目录、Codex 工具请求投影 tool-call 块并 finish `tool-calls` 且 turn 保持挂起、下次调用尾部工具结果回传续推、工具超时按 KMH 结果回传 | feat01 场景1-3 | packages/codex-cli/src/adapter.ts, packages/codex-cli/src/turn.ts | 高:挂起/续推状态机跨进程恢复，并发下串行 | [x] 🟢 |
| T5 | 工具隔离（开关默认关）：进程启动参数注入裁剪后 model_catalog_json，原生工具（Code Mode、协作等）不进模型可见能力，每次启动重新应用 | feat02 场景1, 场景4 | packages/codex-cli/src/isolation.ts | 高:隔离失效即混用原生能力，验证不得只看 unit | [x] 🟢 |
| T6 | 技能隔离：每 turn 启动前发现原生技能、按路径逐个关闭、`$技能名` 显式调用由 KMH 技能体系接管、技能内容来自 KMH | feat02 场景2, 场景4 | packages/codex-cli/src/isolation.ts | 高:同上，显式调用穿透即隔离失效 | [x] 🟢 |
| T7 | 隔离配置应用失败 fail-loud：裁剪或关闭未生效时回合启动失败并报错，不进入混用生成 | feat02 场景5 | packages/codex-cli/src/isolation.ts | None | [x] 🟢 |
| T8 | 开关开启路径：跳过裁剪，原生工具与技能可用且与 KMH 并存 | feat02 场景3 | packages/codex-cli/src/isolation.ts, packages/codex-cli/src/adapter.ts | None | [x] 🟢 |
| T9 | unit：游标前缀/断基线/尾部形态分类、桥目录映射、隔离配置生成（开/关两态） | feat01 场景1, feat02 场景1, 场景3 | tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |
| T10 | smoke：真实 CLI 跑通"模型 → kmh_call_tool → 结果回传 → 下一 step → 最终回复"，含推理等级选择与不支持内容报错 | feat01 场景1-5 | tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |
| T11 | 验证记录：长对话 token 用量随轮数线性增长（不重复投递）、长挂起工具（模拟审批等待）时 Codex 侧行为结论回写 spec 待验证项 | feat01 场景2, feat03 场景2 | docs/spec/codex-cli-provider/spec.md | None | [x] 🟢 2026-10-07：修复 turn 边界误判重建缺陷（KMH 流后才组装 assistant 消息导致尾部恒为 [回复+输入]→每轮重建、历史双份，真机 rollout 与 fixture 双重实证）；角色过滤差分（Codex 自产回复按块摘要核对吞掉、context/system 注入透明、外来回复断基线）落地后，多轮 smoke 断言原文投递与历史单份（`第一轮`×1、无重建标记）。长挂起工具：Codex 串行发送动态工具请求且无限期等待回执（生产 117.6s 中断源自外部 interrupt，非自身超时），桥挂起续推机制见并行/恢复用例。 |

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/src/
│   ├── models.ts        U  # 新增：model/list 分页聚合与模型/推理等级映射
│   ├── cursor.ts        U  # 新增：差分游标（前缀对齐/增量切分/指纹）
│   ├── adapter.ts       U  # 新增：CodexAdapter（stream 投影/工具挂起/usage）
│   ├── turn.ts          U  # 新增：turn 状态机（挂起/回传/续推）
│   └── isolation.ts     U  # 新增：工具目录裁剪与原生技能按路径关闭
├── tests/runtime/codex-cli.test.mjs  M  # 追加：游标/桥/隔离 unit 与桥接 smoke
└── docs/spec/codex-cli-provider/spec.md  M  # 待验证项结论回写（fork 支持性/挂起超时）
```

## 实施记录（2026-10-07）

- 桥接冒烟已在真实 CLI（0.160.0，ChatGPT.app bundle）+ fixture 模型服务跑通：
  差分投递新输入 → `item/tool/call` 挂起 → 工具结果回传 → 同 turn 续推 → 最终回复；
  隔离核对通过（`tool_search`、技能哨兵、原生嵌套工具均已消灭）。
- MCP 缺口已关闭（2026-10-07 用户两轮拍板）：CODEX_HOME 指向 KMH 数据
  目录下的 `codex-home`（环境变量，单次调用级），用户 `~/.codex` 的 MCP
  设备（node_repl、taptap-maker 等）与内置 MCP 工具不再进入模型可见集；
  **禁止修改任何 Codex 配置文件**——隔离全部经 `-c` 进程参数注入（含
  裁剪目录、功能关闭、技能按路径关闭），只影响本次调用，不落 config.toml。
  冒烟断言收紧为模型只见 KMH 工具。连带语义：本机 ~/.codex 登录不自动
  生效，首次需在插件内登录（spec feat04 已同步）。
- 顺带确认：官方协议存在 `thread/fork` 方法，分叉带历史优先走原生 fork
  （task-session-binding 落地）。
- 待验证：多轮对话 token 用量线性增长曲线、长挂起工具（分钟级）时 Codex
  侧行为。

## 实施记录补充（2026-10-07 第二轮，用户四点拍板后）

- CODEX_HOME 回到用户默认 `~/.codex`：共享登录（无需额外登录）、共享配置；用户 MCP 设备可见（已接受，测试断言按 MCP 白名单容忍）。canonical namespace 注册实测被拒（模型侧名称无点拼接），回退平铺真名并保留双方法名（`item/tool/call` 与 `item/dynamicTool/call`）兼容监听。
- 压缩由 Codex 原生处理：catalog 保留 auto_compact；KMH 侧 purpose=compaction 请求明确拒绝（LlmError）。
- spec feat03 场景4（压缩两边同步）语义简化：压缩发生在 Codex thread 内部，KMH 差分基线不受影响；feat04 场景1 凭据判定回到 `~/.codex/auth.json`。
- 共享 home 的连带效应（已观察）：用户 `~/.codex/hooks.json` 会在每个 turn 执行（userPromptSubmit/stop）——与桌面 Codex 行为一致，是否需要在 -c 中关闭待用户后续决定。
