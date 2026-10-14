# task-tool-switch-panel · dev-report

> task: docs/spec/cli-tools-selector/tasks/task-tool-switch-panel/dev-checklist.md
> 创建: 2026-10-14

## 结果

- task 测试：9/9 🟢 全绿；根 `pnpm test` 248/248 通过（含 codex-cli 47、selector 6、runtime 168 含修复后的 HMR 用例、kmh-team 等）
- 既有回归：通过；`pnpm typecheck:kmh` 0 错、`pnpm lint` 通过、两包 format:check 通过（codex-cli 另有 6 个 HEAD 即未格式化的既有文件，未扩改）
- 高风险行：T3（配置持久化写入）已含真实链路验证——真实 settings 落盘、其他命名空间不变断言、普通新建会话真实请求只含选中工具
- `git -C third_party/dsh status` 为空（C4 全程保持）

## 验证证据

| 任务行 / 场景 / C / D / 用例回指 | 红灯原因与证据 | 最终验证方式与实际结果 / 证据位置 | 局限或待补项 |
|---|---|---|---|
| T1 契约（D02） | 纯类型模块，无独立红灯（脚手架行为） | `@kmh/codex-cli/tool-switches` 子路径导出经 T4–T6 消费与浏览器实测（zod 校验在路由两侧执行） | — |
| T2；feat01 场景1/2、feat02 场景4；C5；D02/D03；用例 T1、T2 | `h.ctx.codexCli.toolSwitches is not a function`（方法缺失，行为红灯） | harness 集成 3 用例通过：清单两列与配置一致、原生恰四项带 covers、nativeStatus 随版本门禁降级并在 refresh 后恢复、首次导入触发；`packages/codex-cli/test/tool-policy.test.mjs` | 目录探测依赖本机 CLI 版本，断言只锁四个能力 id |
| T3；feat02 场景1/3；C3、C7；D04；用例 T5 | 同上（setToolSwitch 缺失） | 命令执行切换后落盘三行 enabled 一致；其他命名空间快照不变（C7）；kmh 行与 web_search 行 upsert；旧修订号与未知 id 拒绝；普通新建会话真实请求只含 `kmh-fixture_b` 且含 `exec_command`；同文件 | 高风险行以集成断言覆盖 |
| T4–T6；feat01 场景1/3/4、feat02 场景2；C2、C6；D01/D03/D04；用例 T3、T4、T6 | 路由桩返回 501（4 用例）；状态函数抛 NOT_IMPLEMENTED（2 用例），均为行为红灯 | selector 包 6 用例通过：GET/refresh 转发、503/400/409/500 映射、主题判定（item+codex-cli 才渲染）、乐观切换不可变与回滚；`packages/cli-tools-selector/test/` | 组件 DOM 渲染未单测，浏览器验收覆盖 |
| T7 登记 | 无红灯（登记类） | profile/根脚本/索引/README 登记完成；首轮根测试暴露 HMR 用例 ENOENT（临时副本未含新包），在 `tests/runtime/web-plugin-hmr.test.mjs` 登记新包后 11s 通过 | — |
| T8 集成 | — | 最终根 `pnpm test` 248/248、typecheck:kmh 0 错、lint 通过、DSH 0 diff | codex-cli 6 个既有未格式化文件为 HEAD 原状 |
| T9；feat01 场景1/3、feat02 场景1/2、feat03 场景1/2；C1、C2、C3、C5、C6 | 不适用（人工/浏览器验收） | 临时 KMH_HOME + 端口 3091 真实实例：Codex 详情页区块两列渲染，KMH 110 项按名排序含预设工具（read/write/edit/bash/glob/grep/subagent/todo_write/web_fetch/web_search），原生四项带覆盖说明与顶部说明；切换"联网搜索"后 profile 落盘 `web_search enabled: true`、联动三行保持关闭；注入 500 后该行回滚并提示 `Save failed: INJECTED: acceptance`；恢复关闭后落盘 false；zcode-cli 详情页无区块；叠加补丁禁用选择器后区块消失而 Codex 卡片完整，恢复后区块回来且显示当前配置（Web search 未勾选）。截图 `evidence-switch-panel.png`（本地证据，按仓库对证据图片不入库的惯例不随提交） | feat01 场景2/4 的浏览器端降级态未现场模拟（由 harness T2 与路由单测覆盖）；feat02 场景3 的会话级效果未在浏览器跑真实模型（由 harness T5 真实请求断言覆盖，避免消耗账号配额） |

实现阶段发现并修正（超出设计正文的必要修正，均已记录）：

1. **v0.2 修正**（设计已记）：`saveSelection` 在 profile 策略存在时对四个工具开关只读，`web_search` 改为 `toolSelection` 行（catalog 可调、导入播种、快照缺行回落旧设置）。
2. **全局视图不全**（浏览器验收发现）：公开 `tools.schemas()` 全局视图看不到预设内（agent 作用域）的工具，KMH 列缺 `kmh-read/write/edit/bash` 等。修正：`harnessRows()` 无 agent 时合并全局视图与所有活动 agent 的视图（公开 `agents.list()`），并补列已保存但任何视图不可见的行；`choiceEnabled` 对 KMH 行改为"缺行即开启"（原生行仍缺省关闭），消除"导入不全就关掉预设工具"的顺序陷阱。README 默认值说明同步更新。
3. HMR 启动测试的临时副本未含新包导致 ENOENT，已登记。

工作区另有 7 个文件（README、README.en、docs/kmh/*、kmh.sh 等）为用户并发编辑（默认 Web 端口 3080→60000），与本任务无关，未纳入本任务改动。
