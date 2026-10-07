---
description: 审查 DSH 5719b17 的队列挂起改动、ZCode CLI provider 的独立发布条件，以及 DSH 源码零改动的插件与 Agent loop 替换方案。
---

# DSH 5719b17：ZCode provider 独立发布与队列控制归属审查

审查日期：2026-10-07。目标提交：`5719b17ac92c5b78506e10389abadb8a7e4c1414`；直接父提交：`06df1bee3f4d63cab2f4b5beb16f6c426ce1ee47`。本次完成源码、消费者、配置替换机制和原方法定向探针分析；两个仓库的代码保持本次检查前的内容。

## 结论

纯 ZCode CLI 模型 provider 可以通过 DSH 已有接口独立交付，DSH 源码可以保持零改动。`5719b17` 实现的是停止后的队列挂起、显式继续和补充消息；这些会话交互需要独立的 KMH 功能归属。推荐先让 provider 使用官方 Agent loop，额外的队列控制按独立插件交付；需要精确控制驱动时，发布 KMH 自有 Agent loop 替换插件。

provider 包具备独立发布的接口条件。当前整套 KMH 运行环境使用定制 DSH，因此实际安装兼容性仍需用打包后的插件和干净官方运行时验证。

## 核对的实际状态

- DSH 工作区的 HEAD 为 `ede2c76885626c1695a2878757d1b1c35998987b`。目标提交在它之后，当前本地源码处于目标提交之前；本次使用 `git show` 读取准确提交内容。
- KMH 的 `third_party/dsh` 位于 `9de374a8f3ea3564c71eb8c9cd007c8ac563b452`，包含目标提交，以及 `eb1f00d6b8`、`c863498bc6`、`9de374a8f3` 三笔后续测试、子代理适配和升级指南提交。
- 从目标提交到上述 KMH 子模块 HEAD，Agent loop 实现和 SDK 状态相关源码保持一致。因此本文的实现问题也适用于本次看到的 KMH 子模块。
- 两个工作区已有其他任务变更。本报告保存于 KMH 的 `docs/research/`；定向探针位于本机临时目录。

## 提交改动的责任分布

目标提交修改 22 个文件，增加 455 行、删除 34 行。LLM、subprocess、Session 和 system-prompt 包的实现改动数量为零。

| 改动 | 所属责任 | 对纯 ZCode provider 的必要性 |
| --- | --- | --- |
| `AgentStatus` 增加 `suspended`、`Agent.unsuspend()` | 公共 Agent 协议 | provider 沿用原有接口即可 |
| `armSuspend`、`suspendLatched`、驱动唤醒判断、恢复投影 | 队列控制与生命周期 | 额外的暂停功能使用 |
| Session summary/snapshot、远程 `unsuspend`/`supplement` | 会话 API 与客户端状态 | 可由 KMH 自有 API 提供 |
| InputBar、ChatView、conversation service/slots | 聊天交互 | 可通过既有 slots 或自有 renderer 提供 |
| goal-round-driver、tool-cordis catalog | 新公共 Agent 协议的消费者适配 | 公共协议扩展产生的传播成本 |

架构上的具体问题是：一个模型传输接入需求附带了全局会话语义变更，进而要求无关消费者追随新的公共协议。DSH 的 Agent loop 本身就是插件；选择替换它的自有实现，符合配置组合与独立所有权的设计。

## provider 已有的完整接入路径

现有 [provider 入口](/Volumes/machub_app/proj/kongming-agent/packages/zcode-cli/src/index.ts:23) 只要求 `llm`、`subprocess` 两个 Host 服务，在第 94 行调用 `ctx.llm.registerAdapter(["zcode-cli"], new ZcodeAdapter(runtime))`。

运行路径为：DSH 原有 loop 组装并记录请求 → `LlmAdapter.stream(GenerateOptions)` → 插件转换消息与工具 → 官方 CLI 的 `workspace/generateText` → 插件转换文本、工具调用、usage、finish → DSH 原有工具执行与下一步循环。[请求派发](/Volumes/machub_app/proj/kongming-agent/packages/zcode-cli/src/runtime.ts:788) 使用原有 `options.signal`，第 814 行调用原始模型端点。

`packages/zcode-cli` 的源文件没有调用 `unsuspend`、`supplement`，也没有读取 `suspended`。它使用的 LLM/subprocess 接口在目标提交前后保持一致。插件的账号 API 通过 `ctx.connection.fetch.register` 挂载，账号界面和请求状态通过既有 `plugins.item`、`conversation.composer.dock` slots 提供。

插件保留模型目录、Coding Plan 认证、请求超时、重试、官方取消链路、进程回收与请求状态展示。这些责任可以继续全部留在 `@kmh/zcode-cli`。

当前 package.json 已有 provider、client、prompt 的公开 exports，DSH peers 固定为 `0.2.1-alpha.1`。开发用的 `link:../../third_party/dsh/...` 与对外运行依赖应分别验收。包目前拥有 client 元数据；通过插件管理器一键安装并激活整套配置，还需要一个声明 `dsh.bundle.patch` 的自有 bundle。

## 严格检查发现的问题

### 1. 公共状态扩展传播到了 SDK 协议

[`AgentStatus`](/Volumes/machub_app/proj/kongming-agent/third_party/dsh/packages/core/agent/src/runtime-types.ts:111) 增加了 `suspended`。SDK server 的 `agent/status` 监听把该值直接发送到 `session.status`，SDK protocol 的 `SessionStatusNotification.status` 仍然只声明 `idle | running`。TypeScript SDK 的 `run()` 与 Python SDK 的 `run()` 都以收到 `idle` 作为区间结束条件。

源码支持的结果是：一个 SDK 正在观察的运行区间若最终停在 `suspended`，SDK 会继续等待 `idle`。本次核对了协议与两端消费源码；完整 SDK 场景尚待组合测试。后三笔提交也没有更新这几个生产源码文件。

### 2. 挂起恢复与暂停期间的队列操作冲突

[`suspendedFromFacts()`](/Volumes/machub_app/proj/kongming-agent/third_party/dsh/packages/core/agent-loop/src/suspension.ts:72) 要求最后一次 inbox splice 发生在用户取消的 `turn/end` 之前。在线挂起期间，追加输入、补充文本、编辑或删除仍保留其他消息的队列项，都会产生新的 splice；在线 latch 仍保持挂起，重启恢复判断却变成未挂起。

原投影函数探针给出：用户取消后恢复判断为 `true`；随后发生队列 splice，仍有 pending 输入时，恢复判断变成 `false`。这形成在线状态与重启状态的直接差异。`unsuspend()` 本身也没有持久化释放事实，释放后、驱动领取队列前的进程中断需要额外处理。

### 3. 重复取消让挂起决定偏离首个生效原因

[`cancel()`](/Volumes/machub_app/proj/kongming-agent/third_party/dsh/packages/core/agent-loop/src/agent.ts:206) 每次调用都重写 `armSuspend`；`AbortController.abort()` 则保留首次生效的原因。

执行原 `cancel()` 和 `kick()` 方法的定向探针，结果如下：

| 调用顺序，均保留队列 | 最终取消原因 | 最终状态 |
| --- | --- | --- |
| user → hook | user | idle |
| hook → user | hook | suspended |

因此，停止决定的两个表示分别跟随首个和最后一个调用，恢复投影与在线行为也可能产生差异。

### 4. 取消尚在收敛时的继续请求会再次挂起

[`unsuspend()`](/Volumes/machub_app/proj/kongming-agent/third_party/dsh/packages/core/agent-loop/src/agent.ts:216) 清除 live latch，running 阶段立即返回；取消收敛时 `kick()` 又从 `armSuspend` 写回 latch。原方法探针得到“取消 → 立即继续 → 收敛后 suspended”。普通按钮目前在 running 时隐藏该操作，直接远程调用仍可进入这个时序。

## DSH 源码零改动的实现选择

### A. 当前需求：独立 provider

沿用官方 Agent loop 与现有 Session API；发布 `@kmh/zcode-cli`，用 profile/bundle 插入 provider，并选择 `provider: zcode-cli`。系统提示、技能、工具执行、会话日志和 Agent 循环继续由 Harness 负责。这条路径完全符合当前“底层 provider 接 CLI”的需求。

### B. 公共接口上的独立队列控制插件

工作区已有 [收箱门卫草案](/Volumes/machub_app/proj/kongming-agent/docs/research/session-suspension-plugin-rework.md:41)。它通过 inbox 的公开方法把 pending 消息移到插件自有队列，在释放时重新提交。这个方向可以研究，额外的所有权与恢复工作需要明确：

- inbox 的 `clear/remove` 会记录取消并发送 discarded 通知；自有队列需要明确自己的 UI、消息身份和移交事实。
- inbox 日志与外部 storage 的双写需要可恢复的移交记录、幂等处理和故障注入验证。
- 清空 inbox 后，pre-step 的 runtime-context 及 time-context 等插件仍可以追加消息。原 `preStep()` 的空箱加变化 context 探针产生 `enter` 和 1 条 admitted 消息；时间插件源码也会在满足刷新条件时向 decision 追加消息。草案中“空箱即无模型调用”的保证需要补足。
- 可以研究在暂停期间配合 pre-step 拒绝，并保存已领取的输入；需要验证消息保管、上下文注入、空轮/blocked 轮、子代理、后台唤醒与卸载的完整组合。

单独使用 pre-step 拒绝存在消息移交问题：原 loop 在调用该 waterfall 前已经 `inbox.claim()`。单独使用未释放的 maintenance 任务，则会让 `whenIdle()` 等待到释放，改变正常的取消收敛行为。

### C. 完整驱动控制：KMH 自有 Agent loop 替换插件

需要精确保留队列、驱动静止、重启恢复及取消竞态语义时，可从官方基线复制必要的 Agent loop 私有实现到 `@kmh/agent-loop`，通过原有 [`ctx.agents.setFactory()`](/Volumes/machub_app/proj/agent/deepseek-harness/packages/core/agent/src/index.ts:358) 提供 AgentFactory。该注册槽是单占用，profile 必须先禁用官方 loop。

自有 loop 沿用 `AgentStatus = idle | running`，把暂停状态和 pause/release 操作交给 KMH 自有服务。已静止的驱动返回 idle；paused 是 KMH 额外的队列状态。暂停与释放事实需要持久保存，恢复时由同一个所有者解释；插件拥有的事件定义、类型与投影随包交付。暂停会话的卸载、迁移和恢复也需要明确政策。

KMH 自有 Host API 通过已有 connection 或 Remote 扩展提供继续、补充和状态；补充调用原有 `agent.inject()`。Client 在既有 composer slots 中提供操作和提示。需要把主按钮完全改成原提交的交互时，可发布自有 composer renderer。这样，SessionController、ChatView、goal、subagent、SDK 继续使用原有公共协议。

`ReactLoopAgent` 属于原包的私有实现，包 exports 只有根入口。独立发布方案需要把复制的私有实现和必要的工厂、收件箱、生命周期代码放进自有包，保留许可证，并明确支持的 DSH 版本。它会产生版本维护成本，但所有权、发布依赖和功能范围都可以保持明确。

以下是替换方式示意，自有包仍待实现：

```yaml
- id: agent-loop
  disabled: true

- insert:
    - id: kmh-agent-loop
      name: '@kmh/agent-loop'
      config:
        agents: []
```

这里有一个具体配置细节：id-targeted patch 的 `name` 是原插件名称断言。填写另一个包名会触发 name mismatch 并跳过。正确替换方式是禁用原条目，再插入自有插件；实际配置需要保留原条目的所有必需参数。

## 推荐的拆分与验收

1. 先以官方发布运行时验收 `@kmh/zcode-cli` 的独立安装、模型调用、工具往返、取消和卸载，保留插件侧请求监督与账号 UI。
2. 把目标提交和后三笔配套提交的队列控制实现从运行依赖中移出。回到 `06df1bee` 只能恢复这组变更之前的基线；整套“官方 DSH 零源码改动”验收应使用官方发布包。
3. 队列暂停作为独立 KMH 功能验收。公共接口保管队列路线需先证明移交、暂停时零模型调用和恢复；要求精确驱动控制时，采用自有 loop 替换插件。
4. provider 的包与 bundle 都应允许单独安装；暂停功能应允许独立启用，并覆盖多个模型 provider，保持职责独立。

关键验收包含：原生 profile/Loader 加载、打包后安装到干净官方运行时、取消后 pending 保留、暂停期间来自用户/goal/job/subagent 的唤醒、暂停期间补充与队列编辑后的重启、重复取消、取消与释放竞态、FIFO、双会话隔离、卸载和重装、真实 CLI 停止确认与进程回收。替换 loop 的方案还需要验证两套 SDK 和发布版公共入口。

## 本轮证据与限制

- 用仓库 `change-scope` 脚本读取目标提交相对直接父提交的实际范围。pnpm 包装入口触发依赖自动安装并因缺少 TTY 中止；直接用现有 Node/tsx 执行原检查脚本成功，依赖清理停在 TTY 检查处。
- 用 `git show` 核对准确提交、parent、后续源码差异和所有相关消费者；检查现有 provider 的包入口与源文件依赖。
- [定向探针](/private/tmp/dsh-5719-audit/probe.cjs) 从准确提交提取并执行原 `cancel/unsuspend/kick/preStep` 方法、原恢复投影和配置 patch 函数。替换配置得到唯一启用的 KMH loop；id patch 填写新包名得到名称不匹配警告。探针替代外部服务与已经取消的 turn 收敛，验证的是指定方法与判断；完整 profile、SDK 和真实账号验证仍待验收。
- 本轮没有执行全套测试、发布、回退或业务数据迁移。源码与当前 profile 保持本次检查前的内容。
