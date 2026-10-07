# task-approval-bridge · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat09（决定原生工具审批）全部场景与 feat06 场景1 修订的审批停止语义：审批与执行范围跟随 KMH 会话权限模式三档（D17：请求审批/帮我审批/完全权限，对应官方 CLI 同名档位），请求审批档的原生审批类服务端请求转 KMH 用户决定，挂起请求一次性收口。审批请求依赖 task-native-tool-selection 选中命令执行/文件修改后才会产生；D15 的接入路径（公开 `approval.request()` 或内部工具投影）在 T1 核对后拍板。`approval_policy=never` 只在帮我审批/完全权限档注入，请求审批档用可产生审批请求的策略并显式核对 reviewer 为用户路径。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 审批接入路径调查：公开 `approval.request()`（需 Agent 与开放 turn 前置）与投影为模型目录外内部 KMH 工具两路的可行性核对，结论拍板记入 decisions.md | None | docs/spec/codex-cli-provider/decisions.md | None | [ ] ⏳ |
| T2 | 权限模式映射：KMH Web 预设表改档（原“工作区内修改”改请求审批、新增帮我审批，经 profile `presets.name` 配置）；插件经公开 permissionPresets/sessionProjections 读会话生效档位并映射进程 `-c` 沙箱与审批参数；进行中回合按开始时档位完成 | feat09 场景6 | profiles/kmh-web/cordis.patch.yml, packages/codex-cli/src/isolation.ts, packages/codex-cli/src/adapter.ts | 高:档位映射错误即越权或过度拦截，验证须覆盖三档真实行为 | [ ] ⏳ |
| T3 | 命令执行审批：`item/commandExecution/requestApproval` 展示命令、工作目录与授权范围，用户决定映射为方法声明的决定值（本机基线拒绝回执为 `decline`，以生成 schema 核对）；批准仅覆盖当前请求 | feat09 场景1 | packages/codex-cli/src/approval.ts, packages/codex-cli/src/turn.ts, packages/codex-cli/src/protocol.ts | 高:决定映射错误即越权执行原生命令，验证须含真实 CLI 批准与拒绝两路 | [ ] ⏳ |
| T4 | 文件修改与权限审批：`item/fileChange/requestApproval`（详细变更关联此前 fileChange item）、`item/permissions/requestApproval` 只授予用户明确批准的权限与有效期 | feat09 场景1 | packages/codex-cli/src/approval.ts | 高:权限授予超出用户批准范围即越权 | [ ] ⏳ |
| T5 | 用户输入与 MCP 确认：`item/tool/requestUserInput` 展示问题与选项并按声明的答案结构回传；`mcpServer/elicitation/request` 按输入或外部授权类型处理答复、拒绝与取消 | feat09 场景3 | packages/codex-cli/src/approval.ts, packages/codex-cli/src/turn.ts | None | [ ] ⏳ |
| T6 | 挂起请求收口：保存请求 id/类型/session-thread-turn-item 与一次性完成状态；重复或迟到答复按过期或已处理；停止回合时待审批随回合取消、迟到答复过期（feat06 场景1 修订） | feat09 场景4, feat06 场景1 | packages/codex-cli/src/approval.ts, packages/codex-cli/src/turn.ts | 高:并发:答复与停止竞态下重复回执破坏一次性语义 | [ ] ⏳ |
| T7 | 缺入口与未知请求：无可用用户审批入口时拒绝权限升级并记录可读原因；时间、attestation、token 刷新等未知服务端请求逐项核对后接入或返回明确错误 | feat09 场景5 | packages/codex-cli/src/approval.ts, packages/codex-cli/src/turn.ts | None | [ ] ⏳ |
| T8 | unit：请求解析、决定值映射、权限三档映射（请求审批/帮我审批/完全权限/仅可查看）、一次性与过期语义、`allowed-once`/`rejected`/`cancelled`/`unavailable` 四态映射 | feat09 场景1-6 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |
| T9 | smoke：真实 CLI 请求审批档的批准后执行与拒绝后模型继续；帮我审批/完全权限档不产生审批请求直接执行 | feat09 场景1, 场景2, 场景6 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── profiles/kmh-web/cordis.patch.yml  M  # 权限预设表：请求审批改名、新增帮我审批档
├── packages/codex-cli/src/
│   ├── approval.ts                  U  # 新增：挂起审批请求管理、决定映射与一次性收口
│   ├── protocol.ts                  M  # requestApproval×3/requestUserInput/elicitation 请求 schema
│   ├── turn.ts                      M  # 服务端请求分发、审批等待与停止取消
│   ├── isolation.ts                 M  # 权限档位读取与 -c 沙箱/审批参数映射
│   └── adapter.ts                   M  # 会话权限档位传入回合启动
├── tests/runtime/codex-cli.test.mjs M  # 追加：解析/映射/三档/一次性语义 unit 与 smoke
└── docs/spec/codex-cli-provider/decisions.md  M  # 接入路径拍板记录
```
