# Kongming OS

## 当前架构

Kongming 的后端由完整 DSH Git 子模块 third_party/dsh 提供，维护分支 kmh/runtime-core。当前架构说明位于 [docs/architecture/kongming-runtime.md](docs/architecture/kongming-runtime.md)，启动与升级流程位于 [docs/kmh/README.md](docs/kmh/README.md)，插件功能索引位于 [docs/kmh/plugin-index.md](docs/kmh/plugin-index.md)。

Kongming 管理 scripts/kmh.mjs、launch.config.json、profiles/、bundles/ 与自有 packages/。DSH 管理自己的 packages、apps、vendor、native、工作区和锁文件；进入子模块开发时遵循其中的 AGENTS.md。自有插件使用 DSH 服务和事件时遵循其公开 API 与生命周期规则，新增能力通过现有插件服务、事件和 effect 扩展。

Web 的 DSH 基础配置位于 bundles/dsh-web/cordis.patch.yml，profiles/kmh-web/cordis.patch.yml 管理 KMH 自有插件与部署覆盖，profiles/kmh-web/package.json 的 dsh.profile.bundles 选择组合，具体说明见 [Web 配置](profiles/kmh-web/README.md)。端口由 webserver.config.port 管理，浏览器打开方式由 web-runtime.config.openBrowser 管理。standard、ptc、minimal、cordis 与开发模式预设定义各自的 Agent 子插件和 persona。headless/SDK 的共同 persona 由 bundles/kongming 管理。

运行数据与日志路径遵循 [数据目录与运行记录](docs/kmh/runtime-records.md)；启动器将 KMH_HOME 转换成 DSH_HOME。调用者工作目录、模型凭据与真实退出状态由启动器转发。现有 .env、.kongming 和迁移备份保留本地状态。

## 开发与验证

完整安装所需的底座扩展见 [当前依赖状态](README.md#当前依赖状态)。完整安装所需的底座扩展见 [当前依赖状态](README.md#当前依赖状态)。初始化使用 pnpm install --frozen-lockfile、pnpm run setup、pnpm build。短命令使用 pnpm cli、pnpm web、pnpm sdk，pnpm config:web 查看最终配置。安装当前 Node Git 检查钩子使用 pnpm hooks。

启动与配置变更运行 pnpm test，脚本修改运行 pnpm lint；DSH 子模块的改动运行其规定的相关检查。Web 用户流程使用实际浏览器验证，报告分别说明源码检查与运行结果。保留已有工作区修改，目录迁移先提供可复查清单并核对保留文件。

新增脚本顶部使用中文说明功能与关键函数，函数注释说明输入、输出与失败行为。TypeScript 使用严格类型及包名导入，参数与协议依照源码定义；机器可验证规则纳入实际检查。

需要使用者或维护者知晓的前提、操作、失败处理、适用范围和维护归属随改动写入其所属文档。文档记录当前行为与可验证入口；每项说明集中在一个位置，其他位置通过链接引用。按 [kmh-doc](.agents/skills/kmh-doc/SKILL.md) 和 [kmh-prose-standard](.agents/skills/kmh-prose-standard/SKILL.md) 组织说明，命令说明以实际执行结果为依据。

`.agents/skills/` 中的 kmh-* 技能为 Kongming 自有（简体中文），只规范 kongming-os 的 KMH 层，规范文本见 [KMH 技能接入](docs/kmh/skills.md)；仍以符号链接接入的 DSH 技能按链接的真实路径解析配套文件，执行前核对目标仓库和技能适用范围。

## 提交与发布

代码、测试与文档分别提交。提交信息使用 type(scope): 中文 subject，scope 为英文 kebab-case；同一功能保持相同 scope。pre-commit 检查暂存格式、代码文档分离与脚本语法；pre-push 运行当前 Node 启动测试。真实凭据、.env 和运行数据保留在忽略目录。

### Git 维护

本仓为独立公开仓库 `KtKID/kongming-os`，日常工作使用 `main`，远端为 `origin`。开始提交或推送前确认所在仓库、分支、远端与已有工作区修改，只暂存本次授权范围的文件。创建新分支需要用户确认。

提交与推送遵循用户授权和 [KMH Push 前检查](.agents/skills/kmh-pre-push-checks/SKILL.md)。代码、测试与文档分别提交；迁入原仓历史时保留作者、日期、说明与改动内容，核对来源和迁入后的对应关系。说明实际执行的检查和依赖缺口，运行结果与历史验收记录分别报告。

推送前核对待发布内容中的凭据、本地数据与机器专用配置。重写已推送历史使用绑定已观察远端提交的 `--force-with-lease`，远端出现并发更新时中止推送。子模块修改与指针更新需要单独授权，并遵循 DSH 自身规则。
