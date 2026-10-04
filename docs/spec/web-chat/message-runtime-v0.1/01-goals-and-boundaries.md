# 目标与完成标准

## 系统目标

Web 聊天层需要一条清晰、稳定、可扩展的消息运行时。当前入口、线程创建、部分协议类型已经通用，频道内部的发送、接收、历史处理和渲染投影仍有明显分叉，这个 spec 的目标是把这些分叉收口到公共层，让后续功能新增和 `Streamdown` 渲染替换都沿着同一条边界推进。

## 完成目标（DoD）

- [ ] 三个频道都通过 `ChatManager` 对外提供发送、接收、历史加载、打断和状态查询能力
- [ ] 发送输入结构固定为 `common + provider` 两段模型，文本、图片、思考等级等公用字段只定义一次
- [ ] 历史回放与实时流式帧统一进入 `ChatTimelineStore`，时间线排序、turn 合并、tool 状态聚合由公共层负责
- [ ] 当前 React 视图只消费 `ChatRenderAdapter` 输出，后续替换 `Streamdown` 时只改渲染层
- [ ] 现有 Claude / Codex / Generic 后端 wire 协议和创建时机保持兼容

## 范围边界

**包含**：
- 前端聊天运行时重构方案
- `NetworkManager` 与 `ChatManager` 的公共接口边界
- provider 专有协议的适配层设计
- 历史与实时帧的统一事件模型
- 首发 pending 会话在首次发送时创建 thread 的时序约束

**不包含**：
- 后端路由协议统一
- provider JSONL 历史解析器统一
- `Streamdown` 渲染库的真实落地
- 旧消息组件的视觉重构

## 关键约束

- 现有线程创建语义继续保持：新建会话进入 pending，真实 thread 在首条消息发送时创建
- 现有 provider wire 协议继续保持：Claude、Codex、Generic 继续各走现有 route / service
- 现有 `NetworkManager` 公共能力继续复用，避免再生成新的连接管理器
- 发送输入需要支持未来扩展项，至少覆盖文本、图片、思考等级、工作目录、provider 独有选项
- 这轮优先统一前端消息运行时，后端只做兼容性配合

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| `ChatManager` 统一对外能力 | `ChatManager` + `ChatProvider` + `NetworkManager` | `chat-provider-contract` + `chat-manager-runtime` | 待实现 |
| `common + provider` 发送结构稳定 | `ChatManager` + `ChatProvider` + `types.ts` | `chat-input-contract` | 待实现 |
| 历史与流式统一时间线 | `ChatTimelineStore` + `ChatProvider` | `chat-timeline-store` | 待实现 |
| 视图只消费 adapter 输出 | `ChatRenderAdapter` + 频道视图薄壳 | `chat-render-adapter` + `chat-view-migration` | 待实现 |
| 创建时机与现有协议兼容 | `ChatManager` + `ChatProvider` + 线程 store | `chat-first-send-orchestration` | 待实现 |

> DoD 与模块是一一映射关系。缺少模块支撑的 DoD 说明方案有空洞；缺少 DoD 对应的模块说明 scope 偏大。
