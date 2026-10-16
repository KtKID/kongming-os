# task-distribution · dev-report

> task: docs/spec/kmh-infra-plugin-v0.1/tasks/task-distribution/dev-checklist.md
> 创建: 2026-10-16

## 结果

- task 测试：5/5 🟢 全绿
- 既有回归：通过（web-plugin-hmr 1 test / 1 pass，9.7s）
- 高风险行：1 行（T5 子进程残留）含真实链路的进程数序列验证

## 验证证据

| 任务行 / 场景 / C / D / 用例回指 | 红灯原因与证据（或未采用 TDD 的理由） | 最终验证方式与实际结果 / 证据位置 | 局限或待补项 |
|---|---|---|---|
| 行 T1；feat05 场景1；C1；D06 | 文档行，无测试可写；按 kmh-doc 的事核查要求，所写命令与默认值全部来自本 task 之前的实际执行与观察 | `packages/kmh-infra/README.md` 按 kmh-doc 的包 README 模板写成：frontmatter 只有 `description`；章节为概述、目录、用途（何时选择 + 八键配置表 + 挂载示例 + 暗号怎么给）、实现说明（折叠，逐个脚本与关键函数）、验证、归属与相关文档、开发备注。实测得到的两个行为写进开发备注（清空暗号字段回落默认、插件页 bundle 开关与实例挂载是两回事），环境前提（`pnpm install` 与 `pnpm_config_verify_deps_before_run`）写进验证节 | 命令说明来自本机；README 声称的浏览器侧人工核对清单已由本轮验证覆盖 |
| 行 T2；D06 | 文档行 | `docs/kmh/plugin-index.md` 自有包表新增一行指向包 README；`docs/spec/README.md` 索引表新增一行指向本 spec，状态写"规格与技术设计已确认（2026-10-16），开发中"。两处相对链接逐一核对到真实文件 | 状态词在验收后会需要更新为交付状态（归验收环节） |
| 行 T3；feat05 场景1–3；C4、C11；D06；用例 T7（e2e） | 非 TDD 行 | 见下方"三段式启停验证" | 见该节局限 |
| 行 T4；feat05 场景1；D06；用例 T11 | 非 TDD 行 | `pnpm build:kmh` ✓、`pnpm typecheck:kmh` ✓、`pnpm lint` ✓、`pnpm --filter @kmh/kmh-infra format:check` ✓、web-plugin-hmr ✓；本轮之前的一次全量 `pnpm test` 为 314 项 313 通过（唯一失败在 `packages/codex-cli/test/tool-policy.test.mjs`，用自建临时 profile、与本插件无交集） | 全量 `pnpm test` 本轮未重跑（耗时约 6.5 分钟）；结论引用本轮之前同代码基线上的一次运行，另加本轮的单包与 HMR 回归 |
| 行 T5；feat05 场景2、场景3；C12；D02；用例 T17（e2e） | 非 TDD 行 | 见下方"三段式启停验证"的进程数序列 | 见该节局限 |

## 三段式启停验证（行 T3 与 T5 的共同证据）

在临时实例（`/Users/kid/.kmh-os/tmp/kmh-infra-e2e`，端口 60123，独立 `KMH_HOME`）上按"启用 → 停用 → 重新启用"各走一遍，用真实浏览器与真实模型回合取证。每一段的开关动作是**编辑临时 profile 的 `cordis.patch.yml`**：移除/恢复 `- id: kmh-infra` 这行实例声明（settings 覆盖条目始终保留）。

**第一段：启用态与进程治理**

- 连续改 6 次 `dashUrl`（60011 → 60010 → 60012 → 60010 → 60013 → 60010），每次保存都触发一次重新接入。改前子进程数 1，改后子进程数仍是 **1**（`pgrep -fl x_infra_mcp | wc -l`）。
- 侧栏 Infra 入口、内嵌面板、助手查询三处同时可用（面板与助手在 task-sidebar-and-panel 与 task-config-and-mcp 已分别取证）。

**第二段：停用态**

- 侧栏 **没有** Infra 入口（按 `aria-label` 逐个核对，返回 false）。
- 助手不再具备该能力：问"本机有哪些服务在跑"时它转去用 shell 工具尝试（未能执行，沙箱后端不可用属该环境既有状况），既没有调用 `mcp__infra__*`，回答里也不含本插件引导过的任何措辞（身份校验错误 / 面板没有在运行 / dash_unreachable）——**C11 成立**。
- 子进程数 **0**；临时 patch 里的 settings 覆盖条目仍在（`panelLoadTimeoutMs` 可检索到）。
- 截图见 `evidence/disabled-no-entry.png`。

**第三段：重新启用**

- 侧栏 Infra 入口回来；面板 iframe 地址为 `http://127.0.0.1:60010/`（停用前保存的值）。
- 配置读回：`panelLoadTimeoutMs = 2500`、`dashUrl = http://127.0.0.1:60010/`——**停用前填的内容仍在**（C4 的后半）。
- 助手查询恢复，返回真实服务清单（online：mademe-web、x-token、x-stt、x-musicboard 等，含最近检查时间）。
- 子进程数 **1**（不累积）。

**该节局限**：本轮验证用的是"编辑 profile 的实例声明"，不是插件页里的 bundle 开关。二者在本部署里是两回事：插件页那一行开关控制的是"把这个 bundle 加进 profile 的 `dsh.profile.bundles`"，而本插件是通过 profile 的 cordis patch 直接挂载的实例；README 与开发备注都写明了这一点。bundle 开关的安装路径本轮未验证。

## 跨 task 补齐的核对（浅色主题与中文界面）

task-sidebar-and-panel 与 task-config-and-mcp 的 dev-report 都记了两项未核对：浅色主题、中文界面。本轮把临时实例的 `ui-theme` 配置切成 `preference: light` 并用浏览器 locale 设为 `zh-CN` 重跑：

- 浅色：页面背景计算值 `rgb(255, 255, 255)`；面板工具栏、提示条与配置页在白底上均可读（见 `evidence/light-theme-chinese-panel.png`）。
- 中文：面板工具栏渲染为"刷新 / 在系统浏览器打开"；配置页八个字段标签与保存按钮全部中文（"x-dash 面板地址""暗号所在的环境变量名""Python 位置""x-infra-mcp 所在目录""面板加载超时（毫秒）""连通性探测超时（毫秒）""单次查询等待上限（毫秒）""保存"），见 `evidence/light-theme-chinese-config.png`。
- 顺带观察到一条**按设计成立但值得写进文档**的行为：把 `panelLoadTimeoutMs` 设成 2500 这种激进值后，即使 iframe 随后渲染出 x-dash 登录页，提示条也已经出现（超时是"加载完成事件的预算"，不是"最终是否可见"）。提示文案本身写的是"面板可能无法打开"，面板仍可用；默认 8000 下不出现该提示。README 未把这一点单列，如需强调可补一行。

## 环境说明

- 仍然没有重启 `127.0.0.1:60000`：本会话就跑在那个实例上。全部浏览器验证在临时实例上完成。
- 临时实例的暗号来自使用者已配置的 `~/.zshrc`，只注入其进程环境、只打印长度；模型凭据以符号链接指向使用者的 `.credentials.yaml`，不复制明文；会话与日志写在自己的临时目录。
- 临时实例当前状态：浅色主题、`panelLoadTimeoutMs=2500`、`dashUrl=http://127.0.0.1:60010/`、插件实例已启用、端口 60123，仍在后台运行以便后续复核。

## 未决

- 无 🔴 行。一项未验证（插件页 bundle 开关的安装路径）与一项建议（把超时语义写进 README）不阻塞本 task 交付，已在上面如实列出。
