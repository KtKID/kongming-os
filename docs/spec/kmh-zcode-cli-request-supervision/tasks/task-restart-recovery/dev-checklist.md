# task-restart-recovery · 开发清单

> spec: docs/spec/kmh-zcode-cli-request-supervision/spec.md
> 创建: 2026-10-06

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 启动恢复调查：读取上一运行期未获清理确认的请求记录，按受管身份核查（不凭历史 PID 直接操作），落定为"已停止"或明确的未知 | feat07 场景2 | packages/zcode-cli/src/recovery.ts, packages/zcode-cli/src/records.ts, tests/runtime/zcode-cli.test.mjs | 高:重启后恢复状态与磁盘记录的一致性 | [ ] ⏳ |
| T2 | 重启后展示：待确认请求在会话中显示"停止状态待确认"并保持会话挂起；调查完成后落定并恢复可用 | feat07 场景1, 场景2 | packages/zcode-cli/src/recovery.ts, packages/zcode-cli/src/web.ts, packages/zcode-cli/src/client/index.ts | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── packages/zcode-cli/src/
│   ├── recovery.ts                U  # 新增：启动时恢复调查与状态落定
│   ├── records.ts                 M  # 提供未确认请求的读取
│   ├── web.ts                     M  # 恢复状态路由
│   └── client/index.ts            M  # 重启后待确认展示
└── tests/runtime/zcode-cli.test.mjs  M  # 未确认记录重启恢复测试
```
