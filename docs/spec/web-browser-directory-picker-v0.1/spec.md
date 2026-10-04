> spec_version: 3
> adversarial_risk_version: 3
> complexity: 5
> importance: 2
> risk_average: 3.5
> review_budget: full
> adversarial_review: complete

# web-browser-directory-picker-v0.1

## 任务目标

- 同机 macOS 普通浏览器通过 Kongming FastAPI 与 Python `osascript` 打开系统文件夹选择面板，选中目录进入现有绝对 `cwd` 流程。
- Tauri WebView 保持现有 `@tauri-apps/plugin-dialog` 调用、优先级、参数和取消语义。
- 目录选择的 selected、cancelled、unavailable、remote denied、busy 和请求取消均具有可验证合同与资源收口。

## 非目标

- 本轮不实现 Windows/Linux 服务端原生目录面板。
- 本轮不提供远程服务器文件树浏览 UI。
- 本轮不修改 thread metadata、首发创建、Claude/Codex project registry 或 workspace 持久化结构。
- 本轮不把目录选择 transport 来源写入业务持久化。

## 风险评分依据

- 模式：full；任务改变 React、FastAPI REST wire、Python Manager 与外部 GUI 进程协作，task risk 预判 Q3；允许修改目录选择、Web protocol、router/app 装配、客户端能力和定向测试，禁止波及 thread/runtime/safety 数据语义。
- 剃刀检查：保留一个前端目录选择门户、一个后端 Manager、一个 macOS adapter、一个 REST 端点和一个能力字段，它们分别由环境分流、并发所有权、外部进程、浏览器调用和不可用 UI 消费；Windows/Linux adapter、持久化来源、额外缓存和远程文件树均延后。
- 复杂度：5；single-flight 锁、请求取消时子进程 kill+wait、跨前后端公开合同和外部 GUI 交互命中最高复杂度锚点。
- 重要性：2；能力面向单用户 Web 日常入口，失败影响可恢复，目录选择之外的执行与持久化链保持稳定。
- 预算升级：平均分 3.5 映射 deep，complexity=5 将预算提升为 full。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `web/src/lib` 目录选择门户 | 目标 | 按真实运行环境选择 Tauri 或 server transport，并返回可判定结果 | 环境判断漂移 → Tauri 误走 HTTP → 已有桌面流程回归 | Tauri 环境只调用 plugin-dialog；浏览器环境只调用 FastAPI | `J1`, `J2` |
| 三个 React 调用方 | 上游 | 消费 selected/cancelled/unavailable/busy，展示 loading/fallback | `null` 继续被混用 → 取消与不可用产生错误 UI | selected 才更新 cwd；cancelled 保持原状态；不可用显示可操作 fallback | `J3` |
| Web REST protocol/router | 目标 | 新增目录选择请求/响应 DTO、POST endpoint 和客户端能力字段 | 双侧字段漂移或绕过 Auth/CSRF → 请求失败或能力泄漏 | Python/TS 1:1；未知字段拒绝；现有 Auth/CSRF 生效 | `J4`, `J5` |
| Python `DirectoryPickerManager` | 目标 | 拥有 loopback guard、single-flight 和选择结果校验 | 远程触发 GUI或并发弹窗 → 宿主干扰和资源泄漏 | 只接受 loopback；同进程最多一个 active pick；输出为现存绝对目录 | `J6` |
| macOS adapter | 下游 | 通过 argv 调用 `/usr/bin/osascript` 的 `choose folder` | 字符串拼接注入、取消遗留进程 → 主机副作用 | 不经 shell；用户输入只走 argv；取消执行 kill+wait | `J7` |
| `ThreadManager` 与 project registry | 相关 | 继续消费最终 cwd | transport 来源渗入业务层 → 协议与持久化扩张 | 现有 cwd 请求和持久化结构不变 | `J8` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | Tauri transport 继续以 `window.__TAURI_INTERNALS__` 为真实运行时判据 | 仓库事实 | `web/src/lib/dirPicker.ts::isTauriEnv` 与现有 Tauri 测试 | 已确认 |
| J2 | 普通浏览器通过 FastAPI 获取服务端绝对目录 | 用户任务 | 用户确认 Python/osascript 方案；Files/Shell/ThreadManager 消费服务端 cwd | 已确认 |
| J3 | 目录选择使用 selected/cancelled/unavailable 三态，busy 作为可重试冲突 | 用户任务与调用方 | 当前 `null` 同时表达取消和不可用，ThreadProjectSelector 因此静默结束 | 已确认 |
| J4 | 新增 REST DTO 进入 Python `rest_models.py` 与 TS `protocol.ts` 双侧真源 | 项目规范 | `AGENTS.md` Web wire 协议约束 | 已确认 |
| J5 | 新 POST 路由继续由全局 Auth/CSRF middleware 保护 | 仓库事实 | `src/hosts/web/auth/middleware.py` 保护 mutating `/api/*` | 已确认 |
| J6 | 服务端 GUI 能力只对 loopback client 开放，客户端 IP 不读取 `X-Forwarded-For` | 安全边界 | 现有 auth 登录限流采用同一客户端 IP 信任边界；用户确认同机浏览器范围 | 已确认 |
| J7 | macOS 使用 `asyncio.create_subprocess_exec` argv 调 `osascript`，取消时 kill+wait | 项目规范与用户任务 | `AGENTS.md` 取消回收约束；当前机器 `/usr/bin/osascript` 可用 | 已确认 |
| J8 | picker transport 只产生 cwd，不改变业务 DTO 与持久化 | 用户任务 | “不能影响已有逻辑”与现有下游只消费 cwd | 已确认 |

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | `SC_01`, `SC_02`, `SC_07` 覆盖环境判定、REST DTO、cwd 输出 |
| 状态 | `SC_03`, `SC_04`, `SC_05` 覆盖 selected/cancelled/unavailable/busy |
| 时序 | `SC_05`, `SC_06`, `SC_09` 覆盖并发打开、请求取消和锁释放后的再次选择 |
| 资源 | `SC_06`, `SC_09` 覆盖 osascript kill+wait 与 single-flight 锁释放；`SC_05` 覆盖 active picker 唯一性 |
| 不变量 | `影响边界与不变量` |
| 故障 | `SC_03` 至 `SC_07`、`SC_09`、`SC_10` 覆盖用户取消、能力缺失、远程访问、并发冲突、取消、协议拒绝、锁恢复和非法 adapter 输出 |

## 验收清单

### 单元测试

- [x] Tauri/Web transport 使用不同冲突哨兵，断言唯一真实来源及另一 transport 零调用。
- [x] 三个 React 调用方覆盖 selected、cancelled、unavailable/busy 和 loading 状态。
- [x] Python Manager 覆盖 loopback、remote denied、目录校验和 single-flight。
- [x] macOS adapter 覆盖 argv 边界、AppleScript cancel 和任务取消 kill+wait。
- [x] 取消/异常释放 single-flight 锁，下一次请求可重新进入 adapter。
- [x] adapter 返回不存在路径或文件路径时 Manager 拒绝 selected 结果。
- [x] Python/TS 协议覆盖字段、默认值、未知字段和 outcome 枚举。

### Smoke 测试

- [x] 使用真实 FastAPI route + 真实 DirectoryPickerManager + fake OS adapter，穿过 Auth/CSRF 得到 selected cwd。
- [x] `/api/config/client` 对 loopback 浏览器下发 `server_directory_picker`，对 remote 下发 false。

### E2E 测试

- 决策：需要
- 依据：用户可见链路跨 React、HTTP、FastAPI、Manager 与宿主 adapter；系统面板属于外部 OS 边界，可在自动 E2E 中替换 adapter，并保留 macOS 人工 HIL。
- [ ] 自动链路覆盖 UI → API → Manager → fake OS adapter → cwd 更新；人工 HIL 确认真实 macOS 面板与绝对路径。

## 测试驱动开发

1. `SC_01`, `SC_02` → 先写 Tauri/Web 冲突哨兵与 FastAPI smoke 红灯测试。
2. `SC_03`, `SC_04` → 先写取消、不可用、远程访问 UI/route 红灯测试。
3. `SC_05`, `SC_06` → 先写并发冲突与子进程取消回收红灯测试。
4. `SC_07`, `SC_08` → 先写协议漂移和既有调用方回归测试。
5. `SC_09`, `SC_10` → 先写锁释放恢复和非法 adapter 输出红灯测试。
6. 实现满足测试的最小代码，重构后复跑 unit、smoke、E2E 自动层和静态/架构检查。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | full | assumption:cancel-releases-single-flight; assumption:adapter-output-validation | 无 RAG 经验集 | 无 | `SC_06` | `SC_09`, `SC_10` | skipped:no-corpus |

## Scenarios

### Scenario SC_01: Tauri transport 保持唯一优先

- **GIVEN** Tauri runtime 存在，Tauri adapter 返回 `/tmp/tauri-a`，server transport 返回不同哨兵 `/tmp/server-b`
- **WHEN** 用户触发一次目录选择
- **THEN** 结果为 selected + `/tmp/tauri-a`，server transport 调用次数为零
- 测试层：unit
- 依据：`J1`, `J8`
- 来源：initial-spec

### Scenario SC_02: loopback 浏览器取得服务端目录

- **GIVEN** 普通浏览器、已登录会话、CSRF header、loopback client 与返回 `/tmp/server-project` 的 fake OS adapter
- **WHEN** 前端向真实 `POST /api/server/directory-picker` 发起请求
- **THEN** 请求穿过真实 router 与 DirectoryPickerManager，返回 selected + `/tmp/server-project`
- 测试层：smoke
- 依据：`J2`, `J4`, `J5`, `J6`
- 来源：initial-spec

### Scenario SC_03: 用户取消保持当前选择

- **GIVEN** Tauri 或 server adapter 返回 cancelled，组件已有 cwd `/tmp/current`
- **WHEN** 用户触发目录选择后取消系统面板
- **THEN** cwd 保持 `/tmp/current`，不调用业务 `onChange`，不显示失败提示
- 测试层：unit
- 依据：`J3`
- 来源：initial-spec

### Scenario SC_04: 能力不可用进入可操作 fallback

- **GIVEN** 普通浏览器的服务端 picker unavailable
- **WHEN** 用户点击“选择新项目”
- **THEN** 页面显示绝对路径输入 fallback 或现有输入指引，界面不存在静默结束
- 测试层：unit
- 依据：`J2`, `J3`
- 来源：initial-spec

### Scenario SC_05: 并发目录选择保持单实例

- **GIVEN** 一个 server picker 请求已持有 active lock
- **WHEN** 第二个 loopback 请求并发到达
- **THEN** 第二个请求返回 409 busy，adapter 总活动实例保持为一
- 测试层：unit
- 依据：`J6`
- 来源：initial-spec

### Scenario SC_06: 请求取消回收 osascript 子进程

- **GIVEN** macOS adapter 已启动一个尚未退出的 osascript 进程
- **WHEN** 所属 asyncio task 被取消
- **THEN** adapter 依次调用 process.kill 与 await process.wait，并继续传播 CancelledError
- 测试层：unit
- 依据：`J7`
- 来源：initial-spec

### Scenario SC_07: 远程和非法协议无法触发桌面 GUI

- **GIVEN** remote client 或带未知字段/相对 default_path 的目录选择请求
- **WHEN** 请求到达 FastAPI
- **THEN** remote 请求被拒绝，非法 DTO 返回 422，OS adapter 调用次数为零
- 测试层：smoke
- 依据：`J4`, `J5`, `J6`
- 来源：initial-spec

### Scenario SC_08: 既有调用方保持 cwd 业务语义

- **GIVEN** ThreadProjectSelector、NewThreadDialog 和 AddProjectDialog 分别收到 selected 绝对路径
- **WHEN** 各自完成原有选择或提交动作
- **THEN** 三个调用方继续把相同绝对路径交给现有 onChange/create/add 入口，业务 DTO 不增加 transport 字段
- 测试层：unit
- 依据：`J8`
- 来源：initial-spec

### Scenario SC_09: 取消后 single-flight 恢复可用

- **GIVEN** 第一个 loopback 请求持有 single-flight 锁且 adapter 协程正在运行
- **WHEN** 第一个请求被取消并完成子进程回收后，第二个请求到达
- **THEN** 第一个请求传播 CancelledError，锁已释放，第二个请求能够进入 adapter 并完成选择
- 测试层：unit
- 依据：`J6`, `J7`
- 来源：adversarial-review (assumption:cancel-releases-single-flight)

### Scenario SC_10: 非法 adapter 输出无法成为 cwd

- **GIVEN** macOS adapter 返回不存在路径或普通文件路径
- **WHEN** DirectoryPickerManager 校验选择结果
- **THEN** Manager 返回可判定失败，selected 响应与业务 onChange 均不会发生
- 测试层：unit
- 依据：`J2`, `J6`
- 来源：adversarial-review (assumption:adapter-output-validation)
