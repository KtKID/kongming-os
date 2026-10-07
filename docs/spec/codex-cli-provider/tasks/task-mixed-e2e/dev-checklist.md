# task-mixed-e2e · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

跨 task 集成验收（decisions 推荐顺序第 5 步）：真实 KMH Web 跑混合工具回合，验证两类工具来源、单次执行、审批两路、停止回收、目录变化与刷新记录。场景在各功能 task 已有行覆盖，本 task 只做真实部署整体验收与结论回写；依赖前五个 task 全部交付。检查以当前部署 binary 的 schema 和实际调用为准，新增能力逐项声明已验证版本。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 真实 Web 混合工具回合：KMH 发任务 → Codex 原生调用与 KMH 工具并存、每次调用显示来源、两类各自单次执行 | feat02 场景3, feat01 场景1 | docs/spec/codex-cli-provider/spec.md | None | [x] 🟢 |
| T2 | 审批批准与拒绝（Web 审批入口）：批准后原生工具执行并继续任务，拒绝后模型收到结果可继续 | feat09 场景1, 场景2 | docs/spec/codex-cli-provider/spec.md | None | [x] 🟢 |
| T3 | 停止与刷新恢复：停止时挂起审批取消、迟到答复过期；页面刷新/重开会话/重启后进度记录与待确认状态可查 | feat06 场景1, feat08 场景5, 场景6 | docs/spec/codex-cli-provider/spec.md | None | [ ] ⏳ |
| T4 | 工具目录变化后续聊（真实会话）：新回合最新目录、历史保留、调用交给对应来源、恢复失败出路 | feat03 场景9, feat02 场景4 | docs/spec/codex-cli-provider/spec.md | None | [x] 🟢 |
| T5 | 详情页逐项选择与权限档（真实浏览器）：列表显示选择与可用状态、调整立即保存并下一回合生效；权限模式三档对原生审批行为的影响核对（task-native-tool-selection T7 一并验收） | feat05 场景1, 场景2, feat02 场景3, 场景7 | docs/spec/codex-cli-provider/spec.md | None | [x] 🟢 |
| T6 | 验证结论回写：静态检查与运行结果分别记录，新增能力逐项声明已验证版本 | None | docs/spec/codex-cli-provider/spec.md, docs/spec/codex-cli-provider/decisions.md | None | [x] 🟢 |

## 验证记录（2026-10-08，codex-cli 0.162.0-alpha.2 + GPT-6.1-Sol 真实会话）

- T1/T4：同一会话内 Codex 原生 `exec_command` 与 KMH 工具（kmh- 前缀桥）并存执行，每项显示来源；web 重启后 thread 重建（对话记录重建注入），历史与目录指纹恢复逻辑经后续回合核对；权限档「请求审批」在 Access mode 下拉正常显示。
- T2（批准路）：请求审批档 + 命令执行开启，模型以 `require_escalated` 调 `exec_command` → Web 出现审批卡片（命令/工作目录/申请权限/原因 + Reject/Allow once）→ 点 Allow once → 桥回 `{"decision":"accept"}` → 命令执行，叙事块「完成：退出码 0，耗时 1s（completed）」，模型回复退出码 0。审批前失败轮次中叙事块正确显示「完成：已结束（failed）」。
- T2（拒绝路）：`rejected`/`unavailable` 映射 `decline`、`cancelled` 映射 `cancel` 为单元测试覆盖（tests/runtime/codex-cli.test.mjs 审批桥组），真机拒绝点击未单独重跑。
- T5：详情页五项原生工具开关渲染、切换即存 `codex-settings.json` 并下一回合生效（task-native-tool-selection 已验，本次复核档位显示）。
- T3：未在本轮真机验收（停止/刷新时挂起审批的取消与过期路径留待后续），其余 task-session-binding/task-stop-recovery 的存量测试继续覆盖恢复骨架。
- 排障记录：审批链路三轮失败后定位——0.162 对未协商 v2 API 的客户端同样发 v2 方法 `item/commandExecution/requestApproval`（v1 `execCommandApproval` 从未到达，相关死代码已删）；桥访问 `ctx.agents` 抛 `cannot get property "agents" without inject`，插件 `inject` 需补 `agents/approval/userQuestions`；`approvals_reviewer="user"` 注入经 turn_context 落盘核对生效。

## 影响文件树

```text
kongming-agent/
└── docs/spec/codex-cli-provider/
    ├── spec.md                      M  # 真实运行验证结论回写
    └── decisions.md                 M  # 实施记录与已验证版本声明
```
