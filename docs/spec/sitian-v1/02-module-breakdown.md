# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| 观察源配置 | 定义扫描目标与规则 | 无 | 可进入 x-req | v1 根入口 |
| 主动扫描器 | 读取各观察源并提取 observations | 观察源配置 | 可进入 x-req | v1 主链路 |
| 司天录存储 | 落 observations、state、suggestions | 主动扫描器 | 可进入 x-req | 全局事实源 |
| 建议引擎 | 基于全局状态生成建议与风险 | 司天录存储 | 可进入 x-req | v1 聚焦 Suggest |
| 控制面展示 | 输出给 CLI / Web / Whiteboard | 建议引擎 | 方案确认 | 等状态模型稳定后进入开发 |

## 模块详情

### 模块 1：观察源配置
**职责**：定义司天应观察哪些路径、按什么频率扫描、使用哪些过滤规则。

**包含范围**：
- `SiTianConfig` 配置模型
- 观察源类型定义
- include / exclude 规则
- scan interval 与 freshness 策略
- 线程路径与项目路径的显式映射

**不包含范围**：
- 运行时动态订阅 source
- 自动推断工作区全部路径
- workflow 控制动作

**依赖**：无

**风险与讨论点**：
- v1 需要显式配置，避免隐式自动发现造成噪音
- 配置里需要区分 path source 和 thread source
- 同一路径可能同时属于多个 work item，需要标签能力

**task 建议**：
- 建议 task 名：`sitian-v1-source-config`
- 是否进入 x-req：是
- 原因：边界清晰，输入输出明确

### 模块 2：主动扫描器
**职责**：按配置遍历观察源，提取结构化 observations。

**包含范围**：
- 路径扫描调度
- 文件读取与摘要提取
- 线程元数据扫描
- 增量扫描与去重
- 扫描失败记录

**不包含范围**：
- 实时事件消费
- workflow 自动推进
- UI 推送

**依赖**：观察源配置

**风险与讨论点**：
- 扫描成本要受控，避免每轮全量深扫
- 对 transcript 类文件需要窗口化读取与摘要策略
- 扫描器需要把“看到了什么”和“推断了什么”分层存储

**task 建议**：
- 建议 task 名：`sitian-v1-active-scanner`
- 是否进入 x-req：是
- 原因：这是 v1 主链路，技术边界稳定

### 模块 3：司天录存储
**职责**：把 observations 物化成统一状态，并保存全局工作区态势。

**包含范围**：
- `SiTianRecords` 目录结构
- observations append-only 日志
- materialized workspace state
- work item 存储
- suggestions 快照

**不包含范围**：
- 业务产物文件托管
- 执行 agent 的原始运行目录接管
- 外部数据库同步

**依赖**：主动扫描器

**风险与讨论点**：
- 需要区分原始事实、派生状态、建议输出
- 需要有稳定的 work item 合并策略
- 需要保留重建能力，避免 state 成为黑箱

**task 建议**：
- 建议 task 名：`sitian-v1-records-store`
- 是否进入 x-req：是
- 原因：数据模型可以先行稳定

### 模块 4：建议引擎
**职责**：基于 `workspace state` 生成建议、阻塞判断、风险排序。

**包含范围**：
- blocker 检测
- stale item 检测
- next action 排序
- 风险信号提炼
- 建议摘要生成

**不包含范围**：
- 自动执行建议动作
- 权限授予决策
- 长链路 workflow 编排

**依赖**：司天录存储

**风险与讨论点**：
- 需要优先输出可执行建议，减少泛化评论
- 建议必须带证据引用
- v1 聚焦 Suggest，v2 承接 Act

**task 建议**：
- 建议 task 名：`sitian-v1-suggestion-engine`
- 是否进入 x-req：是
- 原因：输入输出稳定，适合独立开发

### 模块 5：控制面展示
**职责**：把司天状态与建议输出给 CLI、Web 和 Whiteboard。

**包含范围**：
- JSON 结果读取接口
- 简单摘要渲染
- Whiteboard 投影规则

**不包含范围**：
- 复杂控制台交互
- 实时订阅面板
- 执行动作按钮

**依赖**：建议引擎

**风险与讨论点**：
- v1 适合薄适配层
- 控制台体验需要等数据模型稳定后再定

**task 建议**：
- 建议 task 名：`sitian-v1-read-model-and-ui`
- 是否进入 x-req：否
- 原因：先等前四个模块收敛
