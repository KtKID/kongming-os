---
description: KMH SDK 审批桥接的需求、维护归属和验收场景，供方案评审使用。
---

> spec_version: 2

# KMH SDK 审批桥接

本包记录拟议功能，状态为方案待评审。本轮产物限于方案文档；模块保持探索中，实施与任务拆解等待后续指令。需求见本页，模块见 [modules.md](modules.md)，交互、迁移和验证计划见 [design.md](design.md)。

## 需求说明

用户通过接入 KMH 的客户端决定当前操作是否获准，审批扩展与客户端接入由 KMH 维护。

### 需求本质

将现有 SDK 审批桥接草稿迁入 KMH 自有插件，复用 DSH 已提供的审批服务、策略和审计机制。

### 系统目标

需要审批的操作等待客户端决定。一次允许只作用于当前请求；拒绝、取消与客户端故障保留安全停止结果。KMH 自有插件通过 profile 加载，DSH 审批服务与 SDK 通用源码保持当前提交版本。

### 范围边界

包含 KMH SDK 自有协议、SDK 承载插件、审批桥接、客户端应答入口、profile 接入以及验证后撤回独立 DSH 中的审批草稿。首版只处理本 SDK 连接创建并拥有的根会话审批。

延后 Web/手机审批界面的视觉实现、CLI 审批迁移、子 Agent 审批转交、跨连接恢复、永久授权和会话级授权。客户端首版提供应答回调，供具体界面接入。当前记录阶段保存全部既有代码与运行配置。

### 关键约束

DSH 运行时仍由受支持的 dsh profile 启动。KMH 保存新增类型、插件和客户端适配代码；每条 stdio 连接由一个入口统一管理。源码接入使用公开导出与现有事件。诊断写入 stderr 或 KMH 私有日志目录。

### 系统不变量

- DSH 审批服务保持策略判定、取消处理和 approval/asked、approval/decided 审计配对的所有权。
- 客户端的一次允许仅作用于对应请求；并发请求按独立身份关联。
- 会话归属在审批发送前得到确认；首个 prompt 与审批之间的并发顺序必须有验证证据。
- 请求取消后保留 cancelled 终态，晚到允许结果保持失效。
- 插件卸载、连接关闭和进程关闭释放监听器、待决请求与连接资源。
- 标准输出持续满足 JSON-RPC 帧要求；既有 initialize、session/prompt、shutdown 行为保留。

## 用户要求追溯

用户要求按功能与结构分别回指，记录行为和维护归属。

| U-ID | 用户原话要求 | 对应目标 | 落实位置 |
|---|---|---|---|
| U1 | “这个审批功能是我想加的” | 客户端审批决定 | spec.md#requirement-客户端审批决定 |
| U2 | “在kmh作为独立插件” | KMH 审批桥接 | modules.md#模块kmh-审批桥接 |
| U3 | “尽量不想改dsh，改动尽量放kmh” | KMH SDK 承载 | modules.md#模块kmh-sdk-承载 |
| U4 | “把方案写下来放kmh那边” | 方案文档保存 | spec.md#requirement-方案文档保存 |
| U5 | “只记录方案，先不实现” | 方案文档保存 | spec.md#requirement-方案文档保存 |

## 判断依据

仓库事实来自 2026-10-05 源码检查；设计选择和暂定默认供评审使用。

| J-ID | 判断 | 来源类型 | 证据或推断说明 | 确认状态 |
|---|---|---|---|---|
| J1 | DSH 提供审批应答事件和策略、审计所有权 | 仓库事实 | [审批事件](../../../third_party/dsh/packages/interaction/user-approval/src/types.ts)、[审批服务](../../../third_party/dsh/packages/interaction/user-approval/src/index.ts) | 已确认 |
| J2 | 服务插件局部创建 transport，服务类公开接收 transport | 仓库事实 | [SDK 插件入口](../../../third_party/dsh/packages/sdk/server/src/index.ts)、[SDK 服务类](../../../third_party/dsh/packages/sdk/server/src/server.ts) | 已确认 |
| J3 | transport 支持双向请求和取消，本机 TS 客户端仅安装通知处理器 | 仓库事实 | [transport](../../../third_party/dsh/packages/sdk/protocol/src/transport.ts)、[客户端](../../../third_party/dsh/packages/sdk/client/src/client.ts) | 已确认 |
| J4 | 首版处理根会话，客户端通过应答回调接入 | 暂定默认 | 对齐独立 DSH 草稿的会话过滤范围，减少首版客户端界面与子 Agent 归属设计 | 待确认 |
| J5 | KMH 自有 SDK 入口可组合公开服务类并持有 transport | LLM 推断 | 根据 J2、J3 选择组合方式；运行、生命周期和首个 prompt 的并发行为待实施验证 | 待确认 |
| J6 | 当前 x-spec2 模板声明 V2，已装校验器拒绝 V2 | 仓库事实 | 本轮读取 x-spec2 模板与 x-dev/scripts/xdev.py 所加载的 x-spec/scripts/validator.py；后者要求 V3 | 已确认 |

## 建模覆盖声明

动态关系由设计页承载，核心约束由需求页承载。

| 元组 | 落点或不适用理由 |
|---|---|
| 数据流 | design.md#数据流 |
| 状态 | design.md#状态流转 |
| 时序 | design.md#时序 |
| 资源 | design.md#资源 |
| 不变量 | spec.md#系统不变量 |
| 故障 | design.md#故障与恢复 |

## 验收

以下场景定义未来交付标准；本轮检查只验收方案文档保存。

### Requirement: 客户端审批决定

系统应将当前操作的审批请求送达所属客户端，并使用对应的单次决定继续或结束该操作。

依据：U1、J1、J3、J4。

#### Scenario: 一次允许与拒绝

- **GIVEN** 用户的当前操作等待审批
- **WHEN** 用户选择一次允许或拒绝
- **THEN** 当前请求得到对应结果，下一个请求独立等待决定
- 验证: auto

#### Scenario: 并发与会话隔离

- **GIVEN** 两个根会话各自等待审批，另有其他入口创建的会话
- **WHEN** 客户端分别作出决定
- **THEN** 每个结果对应自己的请求，其他入口的会话继续由其所属应答方处理
- 验证: auto

#### Scenario: 取消与异常应答

- **GIVEN** 请求已取消，或客户端断开、应答内容无效
- **WHEN** 允许结果晚到或客户端无法完成有效决定
- **THEN** 已取消请求保持取消结果，故障请求保留安全拒绝或审批不可用结果
- 验证: auto

### Requirement: SDK 接入与释放

KMH 应通过自己的可加载入口接入审批，同时保持原有会话交互和可释放的连接生命周期。

依据：U2、U3、J2、J3、J5。

#### Scenario: 正常 SDK 会话

- **GIVEN** 客户端通过 KMH SDK 连接运行时
- **WHEN** 初始化、发送任务并关闭连接
- **THEN** 会话事件与原有交互保持可用，关闭后释放连接拥有的资源
- 验证: auto

#### Scenario: 首个任务与卸载

- **GIVEN** 首个任务立即触发审批，或审批期间卸载插件
- **WHEN** 运行时处理请求与释放
- **THEN** 请求归属明确，卸载终止待决请求，重复加载保持单份有效监听
- 验证: auto

### Requirement: 方案文档保存

KMH 应保存需求、模块和动态设计，并明确本轮授权为文档记录。

依据：U4、U5、J6。

#### Scenario: 本轮文档交付

- **GIVEN** 用户只授权记录方案
- **WHEN** 保存本方案包
- **THEN** 新增需求、模块和动态设计文档，记录待评审事项，既有源码与运行配置保持原样
- 验证: manual
