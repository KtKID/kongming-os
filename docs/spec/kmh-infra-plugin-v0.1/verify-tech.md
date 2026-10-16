# 技术符合性验收 · kmh-infra 服务插件 v0.1

- 项目与范围：`/Volumes/machub_app/proj/kongming-os`；范围为本轮新增包 `packages/kmh-infra` 的四个 task（task-package-skeleton、task-sidebar-and-panel、task-config-and-mcp、task-distribution）及其对 `profiles/kmh-web`、根 `package.json`、`tests/runtime/web-plugin-hmr.test.mjs` 的改动
- 设计及确认：`docs/spec/kmh-infra-plugin-v0.1/tech-design.md`（sha256 `2ef96277…` 所对应的 spec 基线；设计状态"已确认"，依据为用户 2026-10-16"现在都确定了吧。开始 req dev、verify 吧"）；条目 D01–D11 与用例 T1–T17 的主定义在附录；功能预期见同目录 `spec.md`（C1–C12）
- 规范及 spec：共用开发规范 [x-tech-design/references/development-rules.md](/Users/kid/.agents/skills/x-tech-design/references/development-rules.md)（R1–R7）；项目规范 [AGENTS.md](../../../AGENTS.md) 与[客户端 UI/UX 规范](../../../.agents/skills/dsh-client-ui-ux/SKILL.md)（C7）；spec 基线 174 行、sha256 `2ef962776e2675a3c947a332be5b098c347f8aa12b1b5da07e091be5277b5bd3`
- 代码基线：git HEAD `25fc508` + 未提交工作区改动。相关文件内容哈希（sha256 前 16 位）：`src/config.ts d4087c0598355432`、`src/index.ts b0a0b724d804ea28`、`src/mcp.ts 18fa1ee236aec42a`、`src/prompt.ts d0e5c5442d19ae31`、`src/client/index.ts 0bdaf5684d4e90d2`、`InfraPanel.tsx f35b0c26e6296495`、`ConfigForm.tsx 6d9125f9e728ee4b`、`config-controller.ts d0737014b11114f9`、`styles.ts 80f553b6bf87268b`、`locales.ts 58116ae32add1681`、`InfraIcon.tsx e6589594663b2362`。本轮**未新增验收测试**，用的是 x-dev 阶段随实现写下的包内测试与既有仓库测试
- 验证环境与证据：Kongming 根目录；隔离实例 `/Users/kid/.kmh-os/tmp/kmh-infra-e2e`（端口 60123、独立 `KMH_HOME`、`packages/*` 符号链接、profile 端口改写），浏览器为 Playwright + 本机 chromium headless shell，实例运行日志位于 `/Users/kid/.kmh-os/tmp/kmh-infra-e2e/home/logs/`。未重启使用者正在用的 127.0.0.1:60000 实例（本会话运行于其上）
- 整体结论：**通过**（适用项通过 18、失败 0、未验证 0，不适用 0）。结论只覆盖上述范围、基线与证据，且只代表技术符合性；功能验收对账另见各 task 的 Gate① 记录

## 适用项证据

| 设计/规范条目与来源 | 适用原因 | 代码位置 | 命令或审查方法 | 预期及依据 | 实际与证据来源 | 结果与局限 |
|---|---|---|---|---|---|---|
| D01 配置项与地址规范化（C1、C5、C6；用例 T1、T8） | 本轮核心契约：八个配置项与地址校验 | `src/config.ts`（`normalizeHttpUrl`、八个 volatile 字段） | `node --test packages/kmh-infra/test/*.test.mjs`（含 infra-config 6 项）；真实浏览器读取插件详情页字段值；保存后读回 profile patch | 八个键有默认值与单位；数值字段是 number；非法地址被拒且不落盘（D01、C6） | 测试 26 pass / 0 fail；浏览器读到八个字段与默认值一致、三个数值字段可编辑；保存 2500 后 patch 出现 settings 覆盖条目、刷新读回 2500；非法地址出现原位提示且刷新读回仍是 60010 | 通过。地址长度上限 2048 是命名常量，理由写在注释与 README |
| D02 查询服务的装配与重挂（C1、C3、C9、C12；用例 T6、T14、T17） | 外部进程装配是本包最复杂的机制 | `src/mcp.ts`（`McpMount.sync`/`dispose`/`disposeFiber`）、`src/index.ts` | `infra-mount.test.mjs` 8 项单测；真实模型回合；连改 6 次 `dashUrl` 后统计子进程数；`kill` 子进程后观察重拉与再次查询 | stdio 参数取自配置；暗号显式传入且不进装配键；参数变化先卸后挂；开关关闭即卸；失败只告警（D02、C9、C12） | 单测 8 pass；真实回合调通 `mcp__infra__service_list` 并返回真清单；6 次重挂后子进程数 1；`kill 32882` 后 6 秒内出现新子进程 35855，随后一轮查询返回 `code ok` 与 13:07 的巡检时间 | 通过。重连策略本身是 mcp-client 的（DSH 默认），本插件不覆盖；观察到的边界是同实例里 mademe 的日志"10 次后放弃并卸载工具" |
| D03 侧栏入口注册与选中态（C4；用例 T4、T7） | 侧栏是本需求的可见入口 | `src/client/index.ts` | `infra-client.test.mjs`；真实浏览器核对入口、`aria-current`、收起态提示、刷新恢复 | 两个槽共用同一面板 id；停用即消失；刷新恢复（D03、C4） | 单测 5 pass；浏览器：入口 `aria-label="Infra"`、选中时 `aria-current="page"` 与 `panelActive` 类、收起态提示 `Infra`、刷新后面板恢复；停用后侧栏无该入口 | 通过 |
| D04 面板地址投影与超时（C5、C6；用例 T5、T9、T10） | 面板是本需求的主要界面，超时必须走配置 | `src/client/index.ts`（投影与订阅）、`InfraPanel.tsx` | 真实浏览器：改 `panelLoadTimeoutMs=1500` 后测提示出现时刻；改 `dashUrl` 后看工具栏与 iframe | 地址与超时来自配置且热生效；超时不得写死（C5、C6） | 提示在 1580ms 出现（配置 1500，默认 8000）；`dashUrl` 改 60099 后工具栏与 iframe 同步改为 60099，改回后恢复 | 通过。毫秒级只声称"随配置变化"，不声称精确等于配置值 |
| D05 配置表单与连通性测试（C1、C6、C7；用例 T3、T8、T9、T12） | 配置项必须落在插件详情页内 | `src/client/ConfigForm.tsx`、`config-controller.ts` | 真实浏览器：字段可见性、非法值拦截、测试连接；单测：注入面与快照取值 | 八个字段在详情页内可见可改；非法值阻塞保存；探测超时取草稿值（D05、C7） | 八个字段全部渲染；非法地址原位提示且不落盘；"Test connection" 得 `reachable（16ms）`；注入 face 暴露 `edit`/`resetField`/`save`/`discard` | 通过 |
| D06 包构成与分发登记（C4；用例 T2、T7、T11） | 交付形态是本需求的一部分 | `package.json`、`cordis.patch.yml`、`build.mjs`、`profiles/kmh-web/*`、根 `package.json`、`tests/runtime/web-plugin-hmr.test.mjs` | `infra-smoke.test.mjs` 7 项；`pnpm build:kmh`、`typecheck:kmh`、`lint`、`format:check`、`node --test tests/runtime/web-plugin-hmr.test.mjs` | 双入口产物、dsh 元数据、patch 声明齐备；profile 登记不打断既有回归（D06） | 冒烟 7 pass；根命令全部 exit 0；热重载回归 1 pass（9.7s）。另：该测试的包名单在 HEAD 上已漏 `kmh-mademe`（`prepareProfiles` 对悬空链接 `realpathSync` 抛错），本轮一并补上 | 通过。`pnpm install` 因本机要求清空 `node_modules` 未执行，改用 `--lockfile-only` 加手工链接，偏离与理由已记入 task-package-skeleton 的 dev-report 与包 README |
| D07 措辞引导段落（C1、C2、C11；用例 T6、T16） | 工具输出不可改写，措辞只能靠提示词引导 | `src/prompt.ts`、`src/mcp.ts`（随装配挂卸） | `infra-mount.test.mjs` 的引导段落实；真实回合三种状态；停用后再问一轮 | 段落挂 `MCP_SERVERS` 段位、随 fiber 回收、不含地址与凭据（D07、C11） | 单测：段名/段位/`interpolate=false`/覆盖七个结果码/不含 `127.0.0.1`、`60010`、`http:`；真实回合："x-dash 面板没有在运行…这不代表本机没有登记过服务"、"结论：身份校验错误"、"没有登记过名为 zzz-not-registered 的服务"；停用后回答里不出现任何引导措辞 | 通过（机制层）。模型是否对 `unknown` 与重名也照此措辞属功能验收，未在真实回合观察，见"范围外提示" |
| D08 未知与重名表述引导（C8；用例 T13） | 同上，属同一段落的另两条 | `src/prompt.ts` 引导正文 | 同 D07 的段落断言 | 正文必须覆盖 `unknown` 与 `duplicate_names` 的表述要求（C8） | 单测断言正文含两个码；段落要求"状态未知时说成还没查过"、"带重名标记时点出存在重名" | 通过（机制层）。现场构造未做，见"范围外提示" |
| D09 故障隔离（C9；用例 T14） | 本地小工具故障不得影响主程序 | `src/mcp.ts`（`failOnStartupError: false`、`toolCallTimeoutMs`） | 三种构造的真实运行：`pythonCommand` 指向不存在路径、`dashUrl` 指向未监听端口、`toolCallTimeoutMs=1` | 三者在 Web 启动、会话可用、其他插件不受影响的前提下只表现为能力缺失或明确报错（C9） | 三种构造下 Web 与会话均正常；实例日志里本插件与 mcp-client 的记录均为 `level:"warn"`（如 `mcp-client(infra): connection attempt failed: Error: spawn /nonexistent/python3 ENOENT`） | 通过 |
| D10 不引入第二条输出路径（C10；用例 T15） | 地址里的会话凭证不得借本插件外泄 | `src/mcp.ts`（装配键与日志）、`src/prompt.ts` | 实例日志全量检索 `X_INFRA_MCP_TOKEN=` 形态；审查四处 `logger.warn` 的实参 | 提示词、日志与错误消息里不得出现地址查询串或暗号（C10、C1） | 日志目录内该形态命中 0 次；四处 warn 的实参只有变量名、固定文案与错误对象；带查询串的服务地址在助手回答里以 `?` 截断形态出现 | 通过。日志里出现的是变量"名"，不是取值 |
| D11 界面规范落实（C7；用例 T12） | 新增界面必须复用与符合规范 | `InfraIcon.tsx`、`InfraPanel.tsx`、`ConfigForm.tsx`、`styles.ts` | 审查组件与图标来源、`styles.ts` 取值、字重；浅色与深色各看一次；中文与英文各看一次 | 复用 ui-primitives 与现有图标、取主题 token、字重不超过 500、两色可读（C7） | 组件为 `Button`/`StateDot`/`Switch`/`SettingsForm`/`SettingsValueField`，图标为 `IconGaugeOutlineRegular`；`styles.ts` 无颜色/间距字面量，全部 `--dsw-*`；未设置 `font-weight`；深色与浅色（背景 `rgb(255,255,255)`）均可读；中文界面工具栏与八个字段标签齐全 | 通过。图标选择属设计判断，未经设计师评审；规范自身声明它不是完整检查清单 |
| R1 模块边界 | 两端必须单向依赖、不越界 | `src/*.ts` 与 `src/client/*.ts*` 的 import；`lib/client.js` | 逐文件列出 import 并核对方向；在构建产物里检索 Node 内建 | 浏览器半不得引宿主内部或 Node 模块，依赖单向无环（R1） | 浏览器半的 import 只有 `../config.ts`、自身 client 模块、DSH client 包与 `react`；宿主半不引 client；`lib/client.js` 内无 `require("node:*")`/`fs`/`child_process` | 通过。仅为本包范围的静态审查，未做全仓循环依赖检查 |
| R2 协议优先 | 配置边界要有唯一权威定义与运行时校验 | `src/config.ts`（唯一 schema）、`config-controller.ts`、`ConfigForm.tsx` | 审查校验入口与两份消费者的引用关系 | schema 是唯一权威；地址校验只有一份，两端共用（R2） | `normalizeHttpUrl` 定义在 `config.ts`，被宿主半入口、`config-controller.ts` 与 `ConfigForm.tsx` 引用；表单层不另写一份地址校验；宿主 schema 用原生类型、不做与表单重复的格式判断 | 通过 |
| R3 跨语言协议 | 与 Python 子进程存在 argv/工作目录/环境变量契约 | `src/mcp.ts`（`SERVER_MODULE_ARGS`、`env`） | 审查插件内是否重述上游语义；对照 x-infra 侧文档 | 契约权威在 x-infra 侧，插件只引用不定义第二份（R3） | 插件侧只有 `-m x_infra_mcp.mcp_server`、`cwd` 与两个环境变量名；除用户可见文案外没有对上游状态码语义的复制 | 通过。上游文档在被验证机器的可访问路径为 `/Volumes/machub_app/proj/x-infra/x-infra-mcp/README.md` |
| R4 数据唯一来源 | 配置值与派生快照的归属必须清楚 | `src/mcp.ts` 的 `this.config.*.get()`；`src/client/index.ts` 的 `configForms` 与快照订阅 | 审查两条读取路径；核对派生快照的更新与失效 | 权威存储是 profile 的 Cordis patch；运行期只有活引用与 `configForms` 两条读取路径；界面快照是派生投影（R4） | 宿主半只经 `this.config.X.get()` 读配置，另有一次 `process.env[tokenName]` 用于取暗号（C1 的设计路径）；浏览器半只经 `configForms.get(ROW_ID)` 读取，投影在订阅回调里重算；面板地址与查询目标共用 `dashUrl` 一处 | 通过 |
| R5 概念命名 | 同一概念不得出现两套名字 | `src/config.ts` 字段名与 README/文案 | 审查协议、模块与文案的命名一致性 | 一个概念一个名字，避免同义字段漂移（R5） | 面板地址与查询目标同为 `dashUrl`，未出现 `serviceUrl`/`mcpUrl` 分裂；`tokenEnvVar` 的说明与文案都写明是"变量名" | 通过。语义一致性由人工审查判断，非字符串检索结论 |
| R6 具名配置 | 功能性数值不得散落魔法数 | `src/config.ts`、`src/client/index.ts` | 检索 `src` 下两位以上的裸数字字面量 | 业务阈值、时间、重试具名且默认值与单位清楚（R6、C6） | 命中仅为：命名常量 `MAX_URL_LENGTH = 2048`、schema 的三个默认值（8000/5000/60000，描述里带单位）、以及侧栏 `order: 11`；`InfraPanel` 与 `ConfigForm` 里没有超时字面量 | 通过。`order: 11` 是界面排序而非业务阈值 |
| R7 数据流与状态 | 配置改动到界面与能力的生效链路要可追踪 | `src/client/index.ts`（投影订阅）、`src/mcp.ts`（重挂）、`src/index.ts`（volatile-update） | 真实热生效观察；重挂/卸载的进程数序列 | 从入口到状态变化的路径完整；失败可恢复（R7） | 改 `dashUrl` 与 `panelLoadTimeoutMs` 后不重启即生效（面板与查询目标同步变化）；`loader/volatile-update` 触发重挂，旧实例先卸；子进程被杀后由 mcp-client 自行重连并在 6 秒内恢复可用 | 通过 |

## 不适用项

| 条目与来源 | 不适用理由 |
|---|---|
| （无） | R1–R7 与项目附加规则（客户端 UI/UX 规范）在本轮改动范围内均有适用项，未出现需判不适用者 |

## 失败、未验证与待确认

- 失败：无
- 未验证：无技术项。旁注一条已观察到的边界：mcp-client 的重连在连续失败后有终止条件（同实例内 mademe 的日志为"10 次后放弃并卸载工具，需重新加载"），本插件的远端若长期不可用会落到同一行为；这属 DSH 组件的既定策略，不在本插件实现范围内
- 待确认：无
- 新增验收测试：无（本轮复用 x-dev 阶段的包内测试与既有仓库测试，未新增文件，也未修改任何断言或阈值）
- 范围外提示：
  - 功能验收（Gate①）遗留两项，与本技术验收无关：`unknown` 状态与 `duplicate_names` 重名未在真实回合现场构造（只有引导段落的单测覆盖）；面板内登录后刷新是否保留登录态未核对
  - 插件页里那行 bundle 开关显示未启用，而插件实际经 profile 的 cordis patch 正常加载；两者是不同层面，已写入包 README 的开发备注
  - 本机 `pnpm install` 要求先移除 `node_modules`，故未执行完整安装；根命令需带 `pnpm_config_verify_deps_before_run=false` 才能运行。已写入包 README 的验证节

结论仅覆盖所列范围、基线和证据。测试通过不是全面正确证明；任一未验证项阻止整体通过，已知失败优先判失败。
