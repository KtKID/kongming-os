# task-request-records · 开发清单

> spec: docs/spec/kmh-zcode-cli-request-supervision/spec.md
> 创建: 2026-10-06

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 请求记录落盘：`$KMH_HOME/logs/zcode-cli/<sessionId>/<requestId>/` 结构化生命周期事件（停止请求、取消回执、主进程退出、受管范围清空、清理失败各有独立事件），目录 0700、文件 0600，凭据与令牌写入前脱敏 | feat05 场景1 | packages/zcode-cli/src/records.ts, packages/zcode-cli/src/supervisor.ts, tests/runtime/zcode-cli.test.mjs | 高:持久化写入含敏感信息脱敏 | [ ] ⏳ |
| T2 | 详情数据接口：阶段时间线、各步耗时、重试记录与失败原因、结束原因、停止操作记录（接收时间、取消回执、回收确认）、日志文件入口 | feat05 场景1, feat01 场景2, feat02 场景3 | packages/zcode-cli/src/web.ts, packages/zcode-cli/src/records.ts | None | [ ] ⏳ |
| T3 | 刷新重建：客户端从记录重建在途与待确认请求的状态 | feat05 场景2 | packages/zcode-cli/src/client/index.ts, packages/zcode-cli/src/web.ts | None | [ ] ⏳ |
| T4 | 脱敏导出：详情导出为本地文件，密钥、令牌与鉴权信息脱敏 | feat05 场景3 | packages/zcode-cli/src/web.ts, packages/zcode-cli/src/records.ts | 高:导出内容的凭据脱敏 | [ ] ⏳ |
| T5 | 保留策略：按请求数或天数清理旧记录（可配置，默认保留全部） | None | packages/zcode-cli/src/records.ts, packages/zcode-cli/src/config.ts | None | [ ] ⏳ |
| T6 | runtime-records 文档同步：`logs/zcode-cli/` 目录归属与写入方说明 | None | docs/kmh/runtime-records.md | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── packages/zcode-cli/src/
│   ├── records.ts                 U  # 新增：请求记录落盘、脱敏、保留、详情读取
│   ├── supervisor.ts              M  # 生命周期事件接入记录
│   ├── web.ts                     M  # 详情与导出路由
│   ├── config.ts                  M  # 记录目录与保留策略配置
│   └── client/index.ts            M  # 详情视图与刷新重建
├── tests/runtime/zcode-cli.test.mjs  M  # 落盘结构、脱敏、重建测试
└── docs/kmh/runtime-records.md    M  # 目录归属表补 logs/zcode-cli/ 一行
```
