---
description: KMH SDK 审批桥接拟议模块、公开接口复用、维护归属和评审决策。
---

# 模块设计

本页为待评审模块草案。所有模块保持探索中；方案评审、流程格式对齐和后续实施指令共同决定何时进入任务拆解。

## 模块总览

拟议代码集中在 packages/sdk-approval/，协议、承载、桥接和客户端以包内模块组织。公开能力复用 DSH 包导出。

| 模块 | 职责 | 依赖 | 边界类/对外契约 | 风险 | 决策回指 | 状态 | 回指 Requirement |
|---|---|---|---|---|---|---|---|
| KMH 审批协议 | 请求、决定和关联类型 | DSH 公共会话与审批类型 | KMH 客户端协议导出 | 中：客户端版本匹配 | D1 | 探索中 | 客户端审批决定 |
| KMH SDK 承载 | 唯一 transport、SDK 方法、会话归属、关闭 | DSH SDK 服务类与 transport | Cordis 插件入口及包内能力接口 | 高：归属竞争、stdio 与释放 | U3、D2 | 探索中 | SDK 接入与释放 |
| KMH 审批桥接 | 监听审批事件、发送请求、返回有效决定 | 承载、协议、DSH 审批服务 | approval/request 应答方 | 高：隔离、取消与晚答复 | U2、D3 | 探索中 | 客户端审批决定、SDK 接入与释放 |
| KMH 客户端适配 | 双向请求应答和业务回调 | 协议、DSH transport | onApproval 回调与单连接客户端 | 中：客户端生命周期 | D4 | 探索中 | 客户端审批决定、SDK 接入与释放 |
| KMH 方案文档 | 保存需求、设计与验证计划 | 仓库证据、流程技能 | 本方案包 | 低：实现状态表达 | D5 | 探索中 | 方案文档保存 |

## 关键决策

这些选择用于方案评审，最终稳定后再进入开发清单。

| D-ID | 决策 | 依据 U/J | 选择理由 | 备选与否决原因 | 重评条件 |
|---|---|---|---|---|---|
| D1 | 审批扩展类型由 KMH 包拥有 | U2、U3 | 类型与实际桥接、客户端同步维护 | 扩展 DSH 协议类型：增加底座补丁维护 | 官方协议提供完整审批接入 |
| D2 | KMH 接管 SDK 插件入口，组合 DSH 公开服务类 | U3、J2、J5 | 直接持有 transport，复用会话与协议处理 | 并排挂载两个 stdio transport：重复读取；访问私有 transport：依赖内部实现；复制 SDK 服务类：增加维护量 | 官方服务公开共享 transport 的注入能力 |
| D3 | 桥接使用 DSH 审批事件，所有监听通过 effect/on 释放 | U2、J1 | 保留底座策略、审计与取消所有权 | KMH 重写审批服务：扩大策略与持久化维护范围 | 存在 DSH 公共扩展点无法表达的已确认需求 |
| D4 | 首版提供 KMH 客户端应答入口与回调 | J3、J4 | 接通双向应答，保持界面方案可独立评审 | 仅迁服务端：客户端缺少审批响应；修改官方 HarnessClient 私有成员：耦合内部状态 | 客户端产品、语言和载体明确，或官方提供应答入口 |
| D5 | 当前只写方案，实施前对齐流程版本 | U4、U5、J6 | 保存用户方向与可评审技术方案 | 直接生成 task 并实现：超出本轮文档授权 | 用户确认方案、对齐流程格式并授权实施 |

## 模块详情

下列路径为拟议落点，文件创建属于后续实施阶段。

### 模块：KMH 审批协议

输入字段保留 sessionId、toolName、可选 callId、reason、displayReason；结果 outcome 使用 allowed-once、rejected、cancelled。每次审批以独立身份关联，定位依据为 D1。类型落点为 packages/sdk-approval/src/protocol.ts，状态探索中，回指客户端审批决定。

### 模块：KMH SDK 承载

拟议插件 @kmh/sdk-approval 在 src/index.ts 创建唯一 JsonRpcLineTransport，并组合 HarnessSdkJsonRpcServer。承载保留 Loader 就绪、initialize、session/prompt、shutdown、stdout 帧完整性和根运行时关闭语义。包内接口向桥接提供 ask、会话归属查询和关闭信号。接入位置为 profiles/kmh-sdk/cordis.patch.yml 的 sdk-jsonrpc-server 条目与 profile 依赖清单。依据 U3、D2，状态探索中，回指 SDK 接入与释放。

会话归属由承载的明确登记流程维护。登记必须在首个任务可能触发审批前完成，并结合实际 Agent 身份核对；请求失败时清理临时登记。具体同步点与 DSH 服务类公开接口的组合方式属于评审事项，首个 prompt 的并发测试是实施前置要求。

### 模块：KMH 审批桥接

src/bridge.ts 接收 approval/request，确认根会话归属后通过承载发送 approval/ask。有效决定返回给 DSH 审批服务，其他会话或无效结果调用 next()。取消、卸载和连接关闭必须终止传输待决请求，DSH 继续提交自己的审计结果。依据 U2、D3，状态探索中，回指客户端审批决定、SDK 接入与释放。

### 模块：KMH 客户端适配

src/client.ts 提供双向请求处理和 onApproval 回调；具体 UI 由调用者负责。生命周期与 DSH 的启动、会话通知和关闭语义对齐，复用公共 transport，使用受支持的 profile 启动。Python 与手机适配列入后续载体评审。依据 D4，状态探索中，回指客户端审批决定、SDK 接入与释放。

### 模块：KMH 方案文档

spec.md 保存用户要求和验收，modules.md 保存模块与决策，design.md 保存交互、迁移、故障和后续验证计划。依据 D5，状态探索中，回指方案文档保存。
