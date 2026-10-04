# web-chat

> Web 聊天运行时模块，负责统一多频道的消息发送、接收、历史回放与渲染边界。

## Spec 导航

| Spec | 状态 | 说明 |
|------|------|------|
| [message-runtime-v0.1](./message-runtime-v0.1/) | 方案确认 | 先统一发送、接收、历史合并与渲染适配边界，为后续接入 Streamdown 做准备 |
| [generic-new-thread-v0.1](./generic-new-thread-v0.1/) | 历史首版 | 通用频道加号进入空白新对话页，首条 user message 持久化成功时创建真实 thread，并从已有 thread 项目列表选择 cwd |
| [generic-new-thread-v0.2](./generic-new-thread-v0.2/) | 可进入 x-req | 在 v0.1 基础上增加“选择新项目”文件夹选择器，首发创建时把已有项目、新项目或 home 映射为 cwd |
| [thread-task-progress-v0.1](./thread-task-progress-v0.1/) | 可进入 x-req | 当前 thread 顶部进度入口、session 同目录任务进度文件、LLM 写入接口与 Web 刷新合同 |

状态：探索中 / 方案确认 / 可进入 x-req / 开发中 / 已完成 / 历史首版
