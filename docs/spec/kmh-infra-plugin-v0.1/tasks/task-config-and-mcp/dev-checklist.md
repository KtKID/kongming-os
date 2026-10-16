# task-config-and-mcp · 开发清单

> spec: docs/spec/kmh-infra-plugin-v0.1/spec.md
> tech-design: docs/spec/kmh-infra-plugin-v0.1/tech-design.md
> 创建: 2026-10-16

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 配置表单：字段规格（地址规范化、文本、数值、布尔四类）与表单呈现，八个配置项全部落在插件详情页内，复用现成表单组件与主题 token（C1、C6、C7；D05、D11；用例 T3、T8、T12） | feat04 场景1 | packages/kmh-infra/src/client/config-controller.ts, packages/kmh-infra/src/client/ConfigForm.tsx, packages/kmh-infra/src/client/styles.ts, packages/kmh-infra/src/client/index.ts | 高:配置持久化写入 profile 的 Cordis patch，错值会影响 Web 下次启动，验证不能只有 unit | [x] 🟢 |
| T2 | 地址校验与规范化接入表单：无 scheme 补 https、非法地址在字段旁给出格式提示且不保存、表单层与宿主 schema 不各写一份校验（D01、D05；用例 T1 的表单侧） | feat04 场景2 | packages/kmh-infra/src/client/config-controller.ts, packages/kmh-infra/src/client/ConfigForm.tsx | None | [x] 🟢 |
| T3 | 测试连接：对当前草稿地址做可达性探测，超时取配置项，结果呈现可达耗时或不可达（C6；D05；用例 T9） | feat04 场景3 | packages/kmh-infra/src/client/ConfigForm.tsx | None | [x] 🟢 |
| T4 | 暗号字段的呈现与提示：标签写明是环境变量名、提示写明暗号从启动环境读取且不写入配置文件、留空或填不存在的名字都不阻塞保存（C1；D05；用例 T8） | feat04 场景4 | packages/kmh-infra/src/client/ConfigForm.tsx, packages/kmh-infra/src/client/locales.ts | None | [x] 🟢 |
| T5 | MCP 装配：stdio 的可执行文件、参数与工作目录来自配置，显式把面板地址与暗号放进子进程环境，装配键未变不重挂、重挂先回收旧实例、失败只告警不阻塞插件（C1、C9、C12；D02；用例 T6、T14、T17） | feat03 场景1, 场景2 | packages/kmh-infra/src/mcp.ts, packages/kmh-infra/src/index.ts | 高:子进程生命周期与重挂竞态，泄漏会在本机残留进程，验证需要进程数证据 | [x] 🟢 |
| T6 | 措辞引导段落：注册在既有的 MCP 服务段位、随插件回收，内容覆盖身份校验失败、面板不可达、名字查不到、状态暂未知与重名（C1、C2、C8、C11；D07、D08；用例 T6、T13、T16） | feat03 场景3, 场景4, 场景5, 场景6, 场景7 | packages/kmh-infra/src/prompt.ts, packages/kmh-infra/src/index.ts | None | [x] 🟢 |
| T7 | 只读边界与输出面核对：助手可用能力只有两个查询工具，插件界面与面板不出现启停、修改、删除入口；提示词、日志与错误消息不引入第二条地址输出路径（C3、C10；D02、D10；用例 T6、T15） | feat03 场景1 | packages/kmh-infra/src/mcp.ts, packages/kmh-infra/src/prompt.ts | None | [x] 🟢 |
| T8 | 配置热生效接线：面板地址与超时来自配置投影，保存后助手按新地址查询、面板按新地址与新超时重载（C5、C6；D04；用例 T5、T10） | feat04 场景5 | packages/kmh-infra/src/client/index.ts, packages/kmh-infra/src/index.ts | None | [x] 🟢 |
| T9 | 配置侧浏览器验证：三个数值字段可见可改并读回、非法地址被拦截、测试连接超时随配置变化、暗号字段留空仍可保存（用例 T3、T9、T12，e2e） | feat04 场景1, 场景2, 场景3, 场景4 | — | None | [x] 🟢 |
| T10 | 助手侧验证：四种状态四种问法各观察一次（正常清单、面板不可达、身份校验错误、名字查不到）、未知状态与重名不被说成确定结论、问答与日志里不出现问号之后的凭证、停用后引导措辞不再出现（用例 T6、T13、T15、T16，e2e） | feat03 场景1, 场景2, 场景3, 场景4, 场景5, 场景6, 场景7 | — | None | [x] 🟢 |
| T11 | 故障隔离验证：三种构造（Python 位置不存在、x-dash 停掉、查询等待上限极小）下 Web 正常启动、会话可用、其他插件不受影响（C9；D09；用例 T14，e2e） | feat03 场景1 | — | None | [x] 🟢 |

## 影响文件树

```text
kongming-os/
└── packages/kmh-infra/
    ├── src/index.ts                  M  # 扩展宿主半：装配 MCP 与措辞引导，订阅配置热更新
    ├── src/mcp.ts                    U  # 新增：stdio 装配、显式传环境变量、重挂与实例回收
    ├── src/prompt.ts                 U  # 新增：措辞引导段落的注册与回收
    ├── src/client/index.ts           M  # 追加配置表单两处槽位与配置投影接线
    ├── src/client/config-controller.ts U # 新增：字段规格与共享表单桥接
    ├── src/client/ConfigForm.tsx     U  # 新增：配置表单、连通性测试与提示
    ├── src/client/styles.ts          U  # 新增：表单附加样式（类名前缀、主题 token）
    └── src/client/locales.ts         M  # 追加配置项、提示与错误文案
```
