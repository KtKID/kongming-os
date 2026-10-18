# Mobile Assistant Bundle

移动助手组合使用 `mobile-assistant` preset，面向持续沟通、文件整理、记录、资料检索与设备状态查看。运行入口为 [kmh-mobile-assistant profile](../../profiles/kmh-mobile-assistant/README.md)，通过 SDK stdio 接入小艺网关。

## 工具与技能

本组合裁剪 CUA 与浏览器控制，保留子代理、开发工作流、插件管理、规划、目标与 MCP 资源服务。文件和精选技能工具由 preset 提供，协作与规划工具沿用 DSH base。当前 macOS 实际模型工具目录为 25 项：

| 用途 | 工具 |
| --- | --- |
| 文件与搜索 | `read`、`write`、`edit`、`read_image`、`glob`、`grep` |
| 命令与后台进程 | `bash`、`job_list`、`job_output`、`job_kill` |
| 技能与网页资料 | `skill`、`web_search`、`web_fetch` |
| 子代理与工作流 | `subagent`、`subagent_fork`、`list_agents`、`send_message`、`interrupt_agent`、`workflow` |
| 规划与目标 | `todo_write`、`exit_plan_mode`、`create_goal`、`get_goal`、`update_goal` |
| 插件管理 | `plugin_manager` |

Windows 使用 `pwsh` 执行命令。MCP 资源工具根据已连接资源注册；可选工具沿用 DSH base 的启用条件。文件、命令、沙箱、审批、日志、存储与上下文压缩服务沿用 DSH。插件管理作用于整个 profile，并遵循现有授权与审批。[kmh-mobile-assistant profile](../../profiles/kmh-mobile-assistant/README.md#mademe-工具) 在本组合之上接入 5 个 MadeMe 工具并关闭 MCP 资源工具，模型实际可见 30 项。

[skills.json](skills.json) 选择 32 个已有技能，按任务分组：

- 助手技能：`conversation-memory`、`fnos`、`mademe-save`、`my-cloud-server`、`pain-analysis`、`pdf`、`x-health`、`x-infra-tools`。
- 写作：`x-writer`、`khazix-writer`。
- 学习：`feynman-learn`、`interactive-teaching`。
- 论文阅读：`x-paper-baseread`、`x-paper-reader`。
- 音乐：`x-music-mcp`、`xmusic-recommend`。
- 音视频：`x-vidkit`、`x-video-aitech`。
- 开发流程：`dev-ts`、`x-explore`、`x-spec`、`x-tech-design`、`x-req`、`x-dev`、`x-qdev`、`x-cr`、`x-fix`、`x-verify-spec`、`x-verify-tech`、`x-qa-gate`、`x-adversarial-risk`、`x-dev-rag-call`。

技能内容与附属脚本、参考资料仍由现有技能目录维护；KMH 启动器只建立目录链接。

`KMH_MOBILE_SKILL_SOURCE` 指定已有技能的绝对路径，默认 `~/.agents/skills`。清单的 `sourcePaths` 指定技能在该目录中的相对位置，其中三个开发技能来自已有 `dev_preset` 子目录。启动器将所选技能链接到 `$KMH_HOME/skills/mobile-assistant`；目标缺失或已有链接冲突时启动失败，并报告路径。`KMH_MOBILE_SKILL_DIR` 可以指定使用者准备好的精选目录，替代自动链接目录。技能 provider 在隔离的 skills 服务中只扫描这一目录，目录修改由现有 filesystem provider 观察。

设备状态查询通过命令执行及 `fnos`、`my-cloud-server`、`x-infra-tools` 的现有入口完成。每个入口需要对应 CLI、设备授权和可达服务；技能列表表示可加载的操作指南，实际授权与操作结果分别核对。

音乐播放与收听查询需要可达的 x-music 服务和已连接的 MCP；音乐推荐也可按技能说明读取本地收听记录。视频下载与字幕提取需要 yt-dlp 和 ffmpeg。视频制作需要对应工程的 Remotion 依赖；浏览器截图验收由具备预览能力的环境承接。技能目录复用现有完整内容，工具仍按本组合的配置加载。

## 验证

`node --test tests/runtime/mobile-assistant.test.mjs` 通过真实 profile 和本机 Messages 模型夹具验证工具快照、五类新增技能的正文加载、工作目录内文件写入及读取、正常回复和跨进程历史恢复。精确的模型工具快照位于 [mobile-assistant-tools.json](../../tests/runtime/expected/mobile-assistant-tools.json)，记录的是 kmh-mobile-assistant profile 的完整工具面（本组合 25 项加 profile 接入的 5 个 MadeMe 工具）。完整接入和新增能力建议见[小艺移动助手](../../docs/integrations/xiaoyi-mobile-assistant.md)。

## 开发备注

无。
