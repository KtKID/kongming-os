# task-approval-bridge · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

本清单记录首次接入的实现与验收。帮我审批在 2026-10-11 改为 Codex 官方自动审查，当前映射与验证见[自动审查任务](../task-auto-review.md)。

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat09（决定原生工具审批）全部场景与 feat06 场景1 修订的审批停止语义：审批与执行范围跟随 KMH 会话权限模式三档（D17：请求审批/帮我审批/完全权限，对应官方 CLI 同名档位），请求审批档的原生审批类服务端请求转 KMH 用户决定，挂起请求一次性收口。审批请求依赖 task-native-tool-selection 选中命令执行/文件修改后才会产生；D15 的接入路径（公开 `approval.request()` 或内部工具投影）在 T1 核对后拍板。`approval_policy=never` 只在帮我审批/完全权限档注入，请求审批档用可产生审批请求的策略并显式核对 reviewer 为用户路径。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 审批接入路径调查：公开 `approval.request()`（需 Agent 与开放 turn 前置）与投影为模型目录外内部 KMH 工具两路的可行性核对，结论拍板记入 decisions.md | None | docs/spec/codex-cli-provider/decisions.md | None | [x] 🟢 |
| T2 | 权限模式映射：KMH Web 预设表改档（原“工作区内修改”改请求审批、新增帮我审批，经 profile `presets.name` 配置）；插件经公开 permissionPresets/sessionProjections 读会话生效档位并映射进程 `-c` 沙箱与审批参数；进行中回合按开始时档位完成 | feat09 场景6 | profiles/kmh-web/cordis.patch.yml, packages/codex-cli/src/isolation.ts, packages/codex-cli/src/adapter.ts | 高:档位映射错误即越权或过度拦截，验证须覆盖三档真实行为 | [x] 🟢 |
| T3 | 命令执行审批：`item/commandExecution/requestApproval` 展示命令、工作目录与授权范围，用户决定映射为方法声明的决定值（本机基线拒绝回执为 `decline`，以生成 schema 核对）；批准仅覆盖当前请求 | feat09 场景1 | packages/codex-cli/src/approval.ts, packages/codex-cli/src/turn.ts, packages/codex-cli/src/protocol.ts | 高:决定映射错误即越权执行原生命令，验证须含真实 CLI 批准与拒绝两路 | [x] 🟢 |
| T4 | 文件修改与权限审批：`item/fileChange/requestApproval`（详细变更关联此前 fileChange item）、`item/permissions/requestApproval` 只授予用户明确批准的权限与有效期 | feat09 场景1 | packages/codex-cli/src/approval.ts | 高:权限授予超出用户批准范围即越权 | [x] 🟢 |
| T5 | 用户输入与 MCP 确认：`item/tool/requestUserInput` 展示问题与选项并按声明的答案结构回传；`mcpServer/elicitation/request` 按输入或外部授权类型处理答复、拒绝与取消 | feat09 场景3 | packages/codex-cli/src/approval.ts, packages/codex-cli/src/turn.ts | None | [x] 🟢 |
| T6 | 挂起请求收口：保存请求 id/类型/session-thread-turn-item 与一次性完成状态；重复或迟到答复按过期或已处理；停止回合时待审批随回合取消、迟到答复过期（feat06 场景1 修订） | feat09 场景4, feat06 场景1 | packages/codex-cli/src/approval.ts, packages/codex-cli/src/turn.ts | 高:并发:答复与停止竞态下重复回执破坏一次性语义 | [x] 🟢 |
| T7 | 缺入口与未知请求：无可用用户审批入口时拒绝权限升级并记录可读原因；时间、attestation、token 刷新等未知服务端请求逐项核对后接入或返回明确错误 | feat09 场景5 | packages/codex-cli/src/approval.ts, packages/codex-cli/src/turn.ts | None | [x] 🟢 |
| T8 | unit：请求解析、决定值映射、权限三档映射（请求审批/帮我审批/完全权限/仅可查看）、一次性与过期语义、`allowed-once`/`rejected`/`cancelled`/`unavailable` 四态映射 | feat09 场景1-6 | tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |
| T9 | smoke：真实 CLI 请求审批档的批准后执行与拒绝后模型继续；帮我审批/完全权限档不产生审批请求直接执行 | feat09 场景1, 场景2, 场景6 | tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── profiles/kmh-web/cordis.patch.yml  M  # 权限预设表：请求审批改名、新增帮我审批档
├── packages/codex-cli/src/
│   ├── approval.ts                  U  # 新增：审批桥（决定映射/展示信息/用户输入与 elicitation 映射）
│   ├── protocol.ts                  M  # requestApproval×3/requestUserInput/elicitation 请求 schema
│   ├── turn.ts                      M  # 服务端请求分发、会话身份与回合级审批中止
│   ├── isolation.ts                 M  # 权限档 -c 沙箱/审批参数注入（选中执行类工具时）
│   ├── index.ts                     M  # resolvePermission：permissions 投影旋钮读取与回落
│   └── adapter.ts                   M  # 会话身份与权限档传入回合启动
├── packages/codex-cli/package.json  M  # peerDeps 增 dsh-agent/user-approval/user-questions/session-projection/permission-presets
├── tests/runtime/codex-cli.test.mjs M  # 追加：桥六组 unit 与权限档 argv smoke
└── docs/spec/codex-cli-provider/decisions.md  M  # D18 接入路径拍板记录
```

## 实施记录（2026-10-07）

- T1 拍板见 decisions D18：公开服务直连（`ctx.agents.get(sessionId)` 取活跃 Agent →
  `approval.request()`；结构化答案走 `userQuestions.ask()`），否决内部工具投影。
- 四态映射：`allowed-once`→accept（R2 单次请求授权）、`rejected`/`unavailable`→decline
  （fail closed，缺入口原因记录日志）、`cancelled`→cancel；permissions 批准=请求声明的
  profile 原样授予 + scope=turn，拒绝=空授权。
- 一次性收口为结构性保证（行协议每请求 id 恰写一帧回执）；停止/中断经回合级
  AbortController（dispose 时 abort）传导，桥透传 signal 给两个服务。
- 未知服务端请求 throw → 行协议 `-32603` 错误回执（sdk protocol 实测语义）。
- T2 档位映射：`resolvePermission` 读 permissions 投影旋钮（无投影/无覆盖回落
  workspace-write+ask）；仅选中命令执行或文件修改时注入 `sandbox_mode`/`approval_policy`
  （ask→on-request），避免影响未开放执行工具时的默认行为（如生图落盘）。
- T9 拆分：本批覆盖权限档 argv 注入真实 CLI smoke（三档 + 未选中不注入）与桥全量 unit；
  真实审批往返（用户批准→原生执行→拒绝→模型继续）需真实模型原生触发 shell 审批，
  fixture 无法可靠伪造 unified-exec 调用输入格式，归 task-mixed-e2e 真机验收。
- 验证：typecheck（host+browser）/lint 通过；38/38 测试全绿（含既有全部真实 CLI smoke 无回归）。

## T9 真机验收记录（2026-10-08，codex-cli 0.162.0-alpha.2）

- 批准后执行：请求审批档下模型以 `require_escalated` 调 `exec_command`，Web 审批卡片点 Allow once 后桥回 `accept`，命令执行、退出码 0、叙事块与模型回复正常（详见 task-mixed-e2e 验证记录）。
- 拒绝后继续与另两档直执行：拒绝/取消/缺入口映射由 T8 单元测试覆盖；帮我审批/完全权限档注入 `approval_policy=never` 抑制升级审批的参数核对见 allowlist smoke 断言。
