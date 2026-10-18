# 小艺移动助手

小艺使用 `kmh-mobile-assistant` profile 和 `mobile-assistant` preset，定位为持续聊天、文件整理、记录、资料检索和设备状态查询的个人助手。组合由 [Mobile Assistant Bundle](../../bundles/mobile-assistant/README.md) 管理，助手运行时由 [Mobile Assistant Runtime](../../packages/mobile-assistant-runtime/README.md) 管理。

## 已有技能与工具

| 技能 | 用途 |
| --- | --- |
| `mademe-save` | 记录碎片、保存结论、归档指定对话 |
| `conversation-memory` | 保存原文、集中索引并查回历史讨论 |
| `pain-analysis` | 整理问题、改进方向和最低成本验证 |
| `pdf` | 读取、合并、拆分、生成和整理 PDF |
| `fnos` | 飞牛设备文件、监控、存储和应用状态 |
| `my-cloud-server` | 按现有连接档案和权限查看服务器 |
| `x-health` | 读取、同步和导出已有健康数据 |
| `x-infra-tools` | 本地服务配置、健康监控与语音转写接入 |

助手技能覆盖写作、学习、论文阅读、音乐和音视频处理。开发流程技能覆盖探索、规格、技术设计、任务拆解、实现、排查、修复和验收；子代理、工作流、插件管理和规划目标工具一并保留。组合裁剪 CUA 和浏览器控制，助手定位及持续会话保持。技能目录和完整工具清单只有一个维护入口，见 [bundle 的工具与技能](../../bundles/mobile-assistant/README.md#工具与技能)。Skills 继续引用原目录，适用工具、CLI 安装和设备授权由各技能现有说明决定。MadeMe 知识库另以 MCP 直接提供 5 个 `mcp__mademe__*` 工具，接入方式与"只有新建会话可见"的生效时机见 [profile 的 MadeMe 工具](../../profiles/kmh-mobile-assistant/README.md#mademe-工具)。

## 持续聊天与回收

网关按外部 `params.sessionId` 查找内部 UUID。配置持久映射后，内部 UUID 在网关重启和空闲回收后保持，助手 SDK 通过 DSH 会话日志恢复聊天。映射文件只保存版本与内部 UUID，外部 id 用 SHA-256 摘要作为文件名，原始对话保存在 KMH 的 JSONL 会话日志中。

当前网关仍按会话运行一组 KMH 进程。空闲扫描只回收已完成全部在途和排队轮次的会话；下一条消息启动进程并恢复历史。创建、清除与回收按外部 id 串行化，关闭网关等待会话进程释放写 ownership。`clearContext` 清除映射并分配新 UUID，旧历史继续保留。

网关新增可选配置：

```ini
DSH_MODE=session
DSH_SDK_PROFILE=kmh-mobile-assistant
DSH_SDK_PROVIDER=codex-cli
DSH_SDK_MODEL=gpt-6.1-sol
DSH_SDK_REASONING_EFFORT=medium
SESSION_TIMEOUT_S=-1
SESSION_RECOVERY_DIR=/absolute/path/to/mobile-assistant/session-links
SESSION_IDLE_TIMEOUT_S=600
SESSION_SWEEP_INTERVAL_S=30
```

默认模型为 Codex CLI 的 `gpt-6.1-sol`，思考强度为 `medium`；ZCode CLI 同时作为可选提供方接入。SDK 的实际路由由网关 initialize 字段决定。

`SESSION_IDLE_TIMEOUT_S` 和 `SESSION_SWEEP_INTERVAL_S` 与持久目录一起配置。10 分钟空闲、30 秒扫描是建议部署值，实际值由网关配置注入。`SESSION_TIMEOUT_S` 继续控制对话过期；正数触发过期时会更换内部 UUID，`-1` 保留同段对话。持久恢复要求网关接入支持 resume 的助手 SDK profile。

设备端需要继续携带同一个对话 id。新对话 id 创建独立上下文；当前网关是单机主部署，多个用户共享服务时应加入经鉴权的用户标识。后台工作、提醒及远程动作的跨重启继续执行应各自采用持久任务状态。

## 验证入口

Kongming 中运行 `node --test tests/runtime/mobile-assistant.test.mjs`，使用真实 profile 与本机 Messages 模型夹具验证 skill 加载、文件读写、助手正文和跨进程聊天。小艺网关中运行 `KMH_MOBILE_REPO=/absolute/path/to/kongming-agent npm test -- tests/mobile-assistant-e2e.spec.ts`，验证真实 HTTP/SSE、空闲进程回收、网关重启恢复和清除上下文；仓库路径为已构建的 Kongming checkout。验证使用隔离目录与测试凭据，手机和云端交互另行验收。

## 新增能力建议

1. 统一设备状态查询：以专用只读工具返回电脑、NAS、服务器的 CPU、内存、磁盘、温度、电量及服务状态，并标明设备与采样时间。
2. 持久提醒和任务回访：保存触发时间、完成条件、结果与通知回执，恢复后按状态继续处理；手机通知接入小艺对应通道。
3. 文件操作回执和撤销：记录保存位置、变更摘要和备份引用，支持用户定位结果及恢复误操作。

## 开发备注

无。
