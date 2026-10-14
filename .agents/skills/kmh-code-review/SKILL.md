---
name: kmh-code-review
description: 审查 Kongming 仓库的 PR 或提交改动时使用：把审查者带到本仓库的标准上下文（根 AGENTS.md 约定、提交拆分、文档单点归属），并列出代码本身看不出的审查点。
---

# 审查 Kongming 的改动

**本技能是指导，不是完整清单。** 先确认待审查改动的真实基线与 head 再读 diff，并读足够的周边代码来理解设计。Kongming OS 的审查对象是本仓提交和 PR；基线采用已核对的 `origin/main` 或用户指定提交。正确性、生命周期、安全与被破坏的必要行为优先于风格；一条有证据的 blocker 比一列小问题更有价值。

## 标准上下文

- 根 [AGENTS.md](../../../AGENTS.md)：脚本顶部中文说明与函数注释三要素（输入、输出与失败行为）、TypeScript 严格类型与包名导入、提交拆分（代码、测试与文档分别提交，type(scope): 中文 subject）、文档单点归属与链接引用。
- [docs/architecture/kongming-runtime.md](../../../docs/architecture/kongming-runtime.md)：当前架构与 Kongming/DSH 职责边界。
- [docs/kmh/README.md](../../../docs/kmh/README.md)：启动与升级流程。
- [docs/kmh/plugin-index.md](../../../docs/kmh/plugin-index.md)：插件功能索引。
- [kmh-doc](../kmh-doc/SKILL.md) 与 [kmh-prose-standard](../kmh-prose-standard/SKILL.md)：文档组织与文字规范。
- [AGENTS.md 的 Git 维护](../../../AGENTS.md#git-维护)：仓库、分支、暂存范围与推送约定。

## 硬性要求

1. **新增文字接受语义审查。** 按 [kmh-prose-standard](../kmh-prose-standard/SKILL.md) 审查每个新增或修改的 Markdown 段落、JSDoc、注释与用户可见字符串。新增脚本顶部有中文功能说明，函数注释说明输入、输出与失败行为；自动检查不能确立这些性质，需要对照所属代码或行为核对覆盖、准确与位置。
2. **文档与行为一致。** 配置键、默认值、命令行为或公开行为变化时，同步更新其唯一归属文档；其他位置链接引用，不复制说明。命令说明以实际执行结果为依据。
3. **TypeScript 约定成立。** 严格类型与包名导入；`packages/kmh-*` 插件的参数与协议依照源码定义。
4. **提交拆分符合规范。** 代码、测试与文档分别提交；type(scope): 中文 subject，scope 为英文 kebab-case，同一功能保持相同 scope。
5. **存在相应证据。** 核对作者按改动面运行过 [kmh-pre-push-checks](../kmh-pre-push-checks/SKILL.md) 选出的本地检查。钩子覆盖不到的语义缺口（pre-commit 只查暂存格式、代码文档分离与脚本语法，pre-push 只跑 Node 启动测试）需要人工审查补上。
6. **公开内容经过核对。** 待发布 diff 与授权范围一致；模型凭据、本地运行数据与机器专用设置保留在忽略目录或机器覆盖中。

## 人工审查点

按 Kongming 层对象组织：

- **启动器（`scripts/kmh.mjs`）：** 转发语义是否被保持——调用者工作目录、模型凭据与真实退出状态原样到达子模块；KMH_HOME 到 DSH_HOME 的转换；失败路径是否吞掉真实退出状态。新增能力通过现有插件服务、事件和 effect 扩展，而不是另造机制。
- **配置（`launch.config.json`、`profiles/`、`bundles/`）：** patch 语义是否落在正确预设——Web 基础配置在 `bundles/dsh-web/cordis.patch.yml`，KMH 插件与部署覆盖在 `profiles/kmh-web/cordis.patch.yml`，组合由 profile 清单选择（端口由 `webserver.config.port` 管，浏览器打开方式由 `web-runtime.config.openBrowser` 管）；`bundles/kongming` 与 `bundles/mini` 各自的 `cordis.patch.yml` + `package.json` 是否影响 headless/SDK 共同 persona 或 mini 预设；四个预设的 Agent 子插件与 persona 改动是否与预设定位一致；是否出现本应集中管理却复制到多处的键。
- **KMH 插件（`packages/kmh-*`）：** manifest 与入口齐全，结构与现有插件一致；遵循现有插件服务、事件与 effect 的扩展方式。
- **文档：** 每项说明集中在一个位置，其他位置链接引用；链接目标存在；命令说明有实际执行结果依据；需要维护者知晓的前提、操作、失败处理与维护归属随改动写入所属文档；按 kmh-doc 与 kmh-prose-standard 组织。
- **公开发布影响：** `origin/main` 到待发布提交的 diff 与授权范围一致；自有代码、测试和文档完整，链接可解析，文件内容适合公开。
- **改动范围与测试强度：** 每个抽象、状态与兼容路径都能对应到当前消费者；质疑无关特性与投机泛化；测试断言会因目标回归而失败，而不是复述实现或转述作者声明。

## 子模块改动

- 审查 `third_party/dsh` 的改动时，先读子模块 [AGENTS.md](../../../third_party/dsh/AGENTS.md) 并遵循其约定与检查；深入 DSH 的审查方法时参照子模块原技能 [dsh-code-review](../../../third_party/dsh/.agents/skills/dsh-code-review/SKILL.md)。
- Kongming 层只核对两件事：子模块指针升级是否指向子模块分支上已有的提交；伴随的 Kongming 侧文档与清单是否同步（[docs/architecture/kongming-runtime.md](../../../docs/architecture/kongming-runtime.md) 与 [docs/kmh/plugin-index.md](../../../docs/kmh/plugin-index.md) 是否反映新行为与新插件）。

## 汇报发现

说明缺陷、位置、影响与证据。局部缺陷放在最小相关的 diff 范围内（inline 评论）；跨切面的架构、范围或整体性问题用 PR 级评论。blocker 与建议分开，不重复已由绿色检查强制的问题。在既有审查线程中回复；收到审查意见时核实每条主张，在技术层面修复或反驳，不做表演性认同。
