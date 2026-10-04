# 历史简化模式

用这些例子校准候选的价值——当"未用符号搜索"不足以确立价值时。它们描述已记录的决策，不是当前的待删机会。**以下所有例子均为 DSH 子模块历史例子**，引文指向子模块的冻结归档：只读被引 note 本身，绝不跟随或修复其外链；套用模式前先核实当前归属与已发布数据的义务。文末给出把各模式落到 Kongming 层的方法，不涉及 Kongming 自己的历史记录。

## 要求完整生效路径

声明、序列化分支加测试可以拼出看似可信的支持而没有生效的特性。追踪两端：必须有东西生产值，必须有实现兑现它。[producerless-variants 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-07-04-prune-producerless-vocabulary-variants.md)删除了没有发射端的保留联合成员与缓存提示；[inert-request-knobs 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-07-04-drop-inert-request-knobs.md)区分了"被所有适配器拒绝的旋钮"与"对钩子可用的有效请求字段"。删除范围包括声明、转发、只测拒绝的测试与生成文档。

零固定调用方是弱于不可达的证据。[skill-registration 否决](../../../../third_party/dsh/.agents/notes/rejected/simplification/2026-07-12-prune-unused-skill-registry-api.md)保留了一条有意的第三方注册路径。对编目的服务，先检查通用插件调用与返回值再宣布死亡。可用的扩展点与没有 provider 能兑现的字段需要不同裁决。

## 在消费决策处减少区分

映射每个公开变体到它启用的消费者行为。[model agent-availability 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-09-15-model-agent-availability-and-team-targets.md)给模型一个可用的 Team 目标，并把多个驻留状态投影到同一可用性，内部路由保留 Session 身份与驻留。[capability-neutral sandbox context 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-07-31-capability-neutral-sandbox-policy-context.md)用真实的条件化策略措辞替代两份近似的能力注册表；精确的工具可用性仍在工具 schema 中。收益包括注册方法、disposal 状态、失效与组合测试。

不要因为一个渲染端忽略就抹掉不同的持久事实。[durable step-boundary 否决](../../../../third_party/dsh/.agents/notes/rejected/simplification/2026-06-20-drop-durable-step-boundaries.md)保留了空失败步骤、崩溃修复与检查所需的显式开始与完成事实。只有底层区分不再必要时才简化投影。

## 用更小的明确承诺换取泛化行为

被使用的特性仍可能是满足所需结果的昂贵方式。[fixed-rate Schedule 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-08-09-bounded-fixed-rate-schedule.md)放弃日历递推与错过补放，删除解析器、求值器、跨记录门、持久变体与积压状态。[non-transactional Loader 决策](../../../../third_party/dsh/.agents/notes/implemented/simplification/2026-09-09-nontransactional-loader.md)放弃自动插件回滚，保留失败报告与消费者自有的激活检查。把通用回滚搬到另一个包只会保留其成本。

把损失说得和删除一样清楚。[interrupted-turn truncation 否决](../../../../third_party/dsh/.agents/notes/rejected/simplification/2026-06-20-truncate-interrupted-turns.md)拒绝了一个更简单的恢复算法，因为未完成的轮次可能包含大量真实工作。便利、更小的联合、更少的测试本身不构成丢失必需数据或行为的理由。盘点可以提出权衡而不隐含实施许可。

## 在消费操作处显式化假设

留意获得了共享存储、同步或确认机制的本地默认值。[explicit Schedule time-zone 决策](../../../../third_party/dsh/.agents/notes/implemented/simplification/2026-08-09-explicit-schedule-time-zone.md)让浏览器事实留在发起请求上，并要求调度操作显式给定时区，删除 Session 默认值与跨标签页冲突状态。[injected-content 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-07-20-unwrap-injected-content-envelopes.md)把框架留在调用方，删除穿过无关层的信封控制。两者都减少了必须解释同一假设的所有者数量。

不要把需求搬到必须强制它的位置之后。[Host-only Remote input-validation 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-09-15-host-only-remote-input-validation.md)删除重复的 Client schema 执行，但保留 Host 在查找与业务调用前的校验，以及本地 arity 与 Context 绑定检查。其记录的代价是畸形输入更晚失败，以及失去 Client 解析作为意外的脱敏。

## 在使用处派生或复用既有交付所有者

对每个缓存或事件订阅，问消费者何时需要该值、权威源是否已留存它。[Feedback telemetry 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-08-06-buffer-free-feedback-telemetry.md)在反馈时读规范 Session 前缀，删除持续复制的 pre-feedback 缓冲与其监听器。[Workspace recency 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-09-10-derived-workspace-recency.md)对当前摘要排序而非持久化晋升历史；手动排序仍是独立的用户状态。[Web subagent projections 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-09-08-web-subagent-catalog-projections.md)复用共享流与投影存储，删除特性通知、重复读取与第二份成员缓存。

时机承诺决定这是否成立。反馈时脱敏不同于捕获时脱敏；手动放置不能从活动时间戳派生；流基线缺失时初始的历史读取可能仍然必要。写明这类残留义务，而不是宣布所有缓存冗余。

## 删除偶然的组合所有者

在信任 demo、support、example 之类名字之前检查真实启动与解析路径。[shared-base-config 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-07-29-shared-base-config-overlays.md)删除重复组合与透传设置；真实 Loader 行为决定 overlay 位置。[owner-local profiles and guides 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-08-24-owner-local-profile-tests-and-guides.md)把测试、指南与随附资产分配给其所有者，删除仅做解析的工作区。[merged subagent service 决策](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-07-26-merge-subagent-control-service.md)用显式部署策略替代从 provider 或兄弟工具存在性推断，同时在内部保留可选依赖。

更小的包数量不充分。分开的调用方意图可能有不同的所有权与完成时机；保留的 Service Definition 可能服务于独立 provider。证明替换的真实组合与依赖行为，并清点所有剩余配置与生命周期胶水。

## 用被否决的实验检验对等主张

[SSE parser 替换](../../../../third_party/dsh/.agents/notes/archived/simplification/2026-07-26-eventsource-parser-for-deepseek-sse.md)删除通用帧封装及其一致性测试，保留 provider 专属的终止 shim 并记录更严格的截断尾部行为。对照地，[timer-promises 否决](../../../../third_party/dsh/.agents/notes/rejected/simplification/2026-07-26-builtin-timer-promises-for-hand-rolled-sleeps.md)记录了一个名义等价的内建破坏了确定性假时钟测试，而删除量很小。[dependency-swap audit](../../../../third_party/dsh/.agents/notes/rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.md)区分可替换的通用代码与库不实现的配置边界、安全规则、生命周期归属与部署行为。

过去的否决是有范围的证伪，不是永久的包黑名单。只有带着针对失败前提的新证据才重访；把实现、胶水、测试、依赖与支持的行为一起度量。

## 在 Kongming 层套用这些模式

以上模式是方法，例子是子模块历史。落到 Kongming 层时的对应关系：

- **完整生效路径**：patch 条目、配置键与字段要能追到生产端（bundle 依赖声明、挂载行）与消费端（DSH 实际兑现的行为）。
- **减少区分**：profiles/ 各预设重复展开的同义条目，若消费者行为相同，是合并候选。
- **更小的明确承诺**：启动器与辅助脚本里的泛化机制，若只为单一调用方服务，可用显式值替代。
- **派生或复用**：docs/ 中被复述的机制说明，改为链接其归属文档，不维护副本。
- **组合所有者**：profiles/README、bundles/README 与 docs/kmh/plugin-index.md 记录现行归属；先读它们再判断某个配置属于谁。
