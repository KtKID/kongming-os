# task-mixed-e2e · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

跨 task 集成验收（decisions 推荐顺序第 5 步）：真实 KMH Web 跑混合工具回合，验证两类工具来源、单次执行、审批两路、停止回收、目录变化与刷新记录。场景在各功能 task 已有行覆盖，本 task 只做真实部署整体验收与结论回写；依赖前五个 task 全部交付。检查以当前部署 binary 的 schema 和实际调用为准，新增能力逐项声明已验证版本。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 真实 Web 混合工具回合：KMH 发任务 → Codex 原生调用与 KMH 工具并存、每次调用显示来源、两类各自单次执行 | feat02 场景3, feat01 场景1 | docs/spec/codex-cli-provider/spec.md | None | [ ] ⏳ |
| T2 | 审批批准与拒绝（Web 审批入口）：批准后原生工具执行并继续任务，拒绝后模型收到结果可继续 | feat09 场景1, 场景2 | docs/spec/codex-cli-provider/spec.md | None | [ ] ⏳ |
| T3 | 停止与刷新恢复：停止时挂起审批取消、迟到答复过期；页面刷新/重开会话/重启后进度记录与待确认状态可查 | feat06 场景1, feat08 场景5, 场景6 | docs/spec/codex-cli-provider/spec.md | None | [ ] ⏳ |
| T4 | 工具目录变化后续聊（真实会话）：新回合最新目录、历史保留、调用交给对应来源、恢复失败出路 | feat03 场景9, feat02 场景4 | docs/spec/codex-cli-provider/spec.md | None | [ ] ⏳ |
| T5 | 详情页逐项选择与权限档（真实浏览器）：列表显示选择与可用状态、调整立即保存并下一回合生效；权限模式三档对原生审批行为的影响核对（task-native-tool-selection T7 一并验收） | feat05 场景1, 场景2, feat02 场景3, 场景7 | docs/spec/codex-cli-provider/spec.md | None | [ ] ⏳ |
| T6 | 验证结论回写：静态检查与运行结果分别记录，新增能力逐项声明已验证版本 | None | docs/spec/codex-cli-provider/spec.md, docs/spec/codex-cli-provider/decisions.md | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
└── docs/spec/codex-cli-provider/
    ├── spec.md                      M  # 真实运行验证结论回写
    └── decisions.md                 M  # 实施记录与已验证版本声明
```
