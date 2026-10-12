---
description: Codex CLI 接入的生效技术决策、取舍依据、宿主能力限制与验证记录入口。
---

# Codex CLI 生效技术决策

本页保留当前实现使用的决策与依据，原决策编号用于关联任务记录。使用契约及配置归属为[包说明](../../../packages/codex-cli/README.md)，功能目标与交付状态归属为 [spec.md](spec.md)。CLI 0.160.0 为支持基线；历史真机报告中的版本和验收结论按对应日期阅读，升级部署另行验证。

## D1、D4、D11、D12：执行归属与接入

插件通过公开 DSH 服务、事件和客户端槽位接入。KMH 持有系统提示、宿主技能、宿主工具执行、用户审批和外层回合；Codex 持有原生工具执行、内部模型续推和 thread 历史。KMH 工具通过 dynamic tools 回调执行，原生活动通过独立展示块投影，保持单次执行。业务工作目录跟随 KMH 会话，缺失时回落插件配置目录。

这一区分让宿主权限和原生执行分别由对应拥有者管理。公开服务能力决定插件的宿主版本要求，具体接入见 [index.ts](../../../packages/codex-cli/src/index.ts)、[adapter.ts](../../../packages/codex-cli/src/adapter.ts) 和 [turn.ts](../../../packages/codex-cli/src/turn.ts)。

## D2、D8、D9：账号与进程配置

官方 CLI 共享用户 `~/.codex` 登录及配置。插件的隔离覆盖经进程 `-c` 参数单次注入；用户 Codex 配置文件保持原样。原 D7 独立 CODEX_HOME 方案已撤回，当前 `dataDir` 保存 KMH 绑定和游标。

共享 home 满足复用登录的需求，也保留用户 MCP 设备可见这一已接受限制。用户和项目钩子按发现的路径或键关闭。账号状态依据凭据存在性与解析结果，真实模型可用性由连接测试确认；退出操作作用于官方 CLI 登录态。实现归属为 [isolation.ts](../../../packages/codex-cli/src/isolation.ts) 与 [account.ts](../../../packages/codex-cli/src/account.ts)。

## D3、D12、D13：原生能力与工具声明

原生能力逐项选择，图片生成默认保留，原生技能独立选择且默认关闭。基础隔离与显式选择共同确定工具集合；旧总开关的兼容含义以包说明和实现为准。

KMH 工具声明采用 `kmh-<原名>` 前缀及显式映射表，结构化工具引用按同表转换，普通正文保持原文。工具目录在 thread 创建时绑定，变化后的可见性依赖基线重建；投递、结果解析和碰撞校验归属为 [tool-registry.ts](../../../packages/codex-cli/src/tool-registry.ts) 和 [turn.ts](../../../packages/codex-cli/src/turn.ts)。

## D5、D6、D10、D21：历史、差分与流式

差分游标按消息指纹投递新增输入。工具结果作为挂起的服务端请求回执续推同一原生 turn；编辑或重发历史使用原生分叉，失败时新建 thread 并导入重建历史。首轮尾随的宿主上下文随新增用户输入一起投递，以保持模型输入完整。

业务 thread 的压缩由 Codex 管理；KMH 的压缩评估与标题生成使用独立临时会话。正文与思考摘要按增量返回，用量来自 `thread/tokenUsage/updated` 并按 step 投影。差分与投影分别见 [cursor.ts](../../../packages/codex-cli/src/cursor.ts)、[adapter.ts](../../../packages/codex-cli/src/adapter.ts) 和 [turn.ts](../../../packages/codex-cli/src/turn.ts)。

## D15、D17、D18、D20：审批与权限

审批桥直接使用公开 `agents`、`approval` 与 `userQuestions` 服务。原生审批关联当前会话与 turn，按请求类型映射允许、拒绝、取消和不可用结果；缺少应答能力时安全拒绝。用户输入和 MCP elicitation 使用结构化问题应答。具体 wire 方法与字段以 [approval.ts](../../../packages/codex-cli/src/approval.ts) 和 [protocol.ts](../../../packages/codex-cli/src/protocol.ts) 为准。

权限读取 KMH 会话的生效档位：请求审批使用工作区沙箱与用户审查；帮我审批使用工作区沙箱与自动审查；完全权限使用完整访问范围并跳过询问；仅可查看使用只读沙箱与用户审查。官方 `approval_policy=never` 表示关闭询问，其允许范围同时受 sandbox 决定。权限映射由 [index.ts](../../../packages/codex-cli/src/index.ts) 维护。

插件显式声明 `llm`、`subprocess`、`agents`、`approval`、`userQuestions`、`attachments` 六项注入服务，账号 Web 路由另经 `connection` 注入。停止与超时分别处理流等待、挂起审批、官方中断及进程回收，具体失败和等待时限见包说明。

## D14、D19：原生进度呈现

当前原生活动使用助手消息内的独立文本块，随会话历史保存和恢复。命令输出、MCP 进度及 diff 摘要按实现的体积限制合并，回合结束时未确认的活动保留待确认状态。原生观察块与宿主可执行工具调用分别投影，具体归属为 [native-items.ts](../../../packages/codex-cli/src/native-items.ts)。

独立持久观察事件和专用卡片属于后续呈现目标，需重新核对所部署 DSH 的公开扩展点及兼容要求。原 D14 的完整卡片方案收敛为当前文本块交付形态。

## D16、D17、D22：图片交付

图片投影读取官方生成产物，经宿主附件服务保存后进入会话。原图像素与用户要求分别如实展示，完成状态反映实际交付。尺寸转换需作为另行授权的任务处理；原 D16 的自动另存交付图方案已撤回。

同一原生项的活动叙述与图片使用不同流块索引，附件读取或保存失败时保留诊断及原生产物恢复入口。实现归属为 [image-delivery.ts](../../../packages/codex-cli/src/image-delivery.ts) 和 [turn.ts](../../../packages/codex-cli/src/turn.ts)。

## 验证与待验证项

历史混合工具和审批验收见 [task-mixed-e2e](tasks/task-mixed-e2e/dev-checklist.md)，流式与思考等级回归见[对应记录](tasks/task-stream-reasoning-regression.md)，重试、停止与超时见[对应记录](tasks/task-retry-status.md)。报告中的测试计数与真机结果对应当时实现。

真实长上下文压缩、长时间工具挂起，以及停止或刷新时挂起审批的真机验收按包说明、规格及任务清单核对。每次新增验证须记录 CLI 版本和实际执行路径。
