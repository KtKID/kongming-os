---
name: kmh-speed-up-perf
description: 排查或优化 Kongming 层启动开销时使用——启动链路（scripts/kmh.mjs → DSH 启动）、配置解析与 patch 组合（profiles/、bundles/ 的 cordis.patch.yml）、插件装载（packages/kmh-*）与四预设差异；也用于设计如实的启动测量，把性能证据变成保持行为的修复。Session/Web 运行时性能、长会话剖析与 CI 性能门属于 DSH 子模块，不在本技能范围。
---

# KMH 启动性能提速

把"让它更快"的宽泛请求变成可复现的启动路径测量与小步、有证据的修复。本技能是指引而非配额或脚本：广泛盘点、跟随实测成本，否决对用户实际工作负载没有改善的诱人改动。Kongming 层的可控面是启动链路与配置组合；耗时一旦进入 DSH 应用内部，改用子模块技能（见[边界](#边界)）。

## 确定范围与现状

先读根 [AGENTS.md](../../../AGENTS.md)、[运行时架构](../../../docs/architecture/kongming-runtime.md)与[底座入口](../../../docs/kmh/README.md)，确认当前 checkout 与子模块指针一致。明确用户可见端点（哪条命令、哪个 profile 的启动）、可接受的次要行为差异与停止条件。

Kongming 层的优化只能改变 Kongming 拥有的东西：`scripts/kmh.mjs`、`launch.config.json`、profiles/ 与 bundles/ 的配置内容、`packages/kmh-*` 插件包。DSH 应用初始化、配置装载器实现与运行时行为属于子模块。测量时区分"Kongming 组合开销"与"DSH 应用开销"——只有前者是本层的修复对象。

## 认识启动链路

`node scripts/kmh.mjs <mode>` 的固定顺序：

1. **prepareProfiles**：扫描 `profiles/` 各目录的 package.json，为 bundle 的 `link:` 依赖建立 node_modules 链接，并在 `KMH_HOME/profiles` 登记 profile 链接。已存在的等价链接只做 realpath 校验；目录冲突直接报错。
2. **readLaunchProfiles**：读取 `launch.config.json`，校验命令到 profile 名称的映射与 profile 目录存在。
3. **spawn DSH 入口**：以 `DSH_HOME=KMH_HOME`、调用者工作目录、继承 stdio 启动 `third_party/dsh/apps/cli/lib/bin.js --profile <name> ...`，转发参数并原样返回退出状态。

之后的 profile 配置组合（cordis.yml 与 cordis.patch.yml 叠加、bundle patch 挂载、插件装载）由 DSH 执行，但组合的内容由 Kongming 的 profiles/ 与 bundles/ 决定：

- `kmh-web` 在 [profiles/kmh-web/cordis.patch.yml](../../../profiles/kmh-web/cordis.patch.yml) 中完整展开 base、Web 与全部预设（Agent 子插件、persona），装载条目最多；字段说明见 [kmh-web/README.md](../../../profiles/kmh-web/README.md)。
- `kmh-headless` 与 `kmh-sdk` 选择 DSH 对应应用后叠加 `@kmh/bundle-kongming`（当前定义 Kongming persona）。
- `kmh-mini` 的插件树由 `@kmh/bundle-mini` 独立定义，用于组合验证。

装载条目数量与 patch 层数直接进入启动耗时。四预设的差异本身就是可测量的对照：同一机器上比较各 profile 的启动时间与最终配置，可以定位开销来自条目数量还是组合方式。

一次性成本不是测量对象：`pnpm run setup` 初始化子模块与依赖、`pnpm build` 构建产物，属于变更后的必要步骤；产物缺失时启动器直接报错，这本身不是性能问题。冷热启动要分开：首次启动创建 KMH_HOME 链接，此后每次启动走 realpath 校验路径。

## 测量手段

全部使用仓库现有命令与 Node 内建工具，不新增基准设施：

- **计时**：`time node scripts/kmh.mjs cli <task>` 直测启动器，绕开 pnpm 包装开销；对照 `time pnpm cli <task>` 可以单独看出 pnpm 包装的成本。固定输入与 KMH_HOME 状态，同机空闲时交替取样，报告全部样本与所选聚合（如中位数），不要只挑最快一次。
- **最终配置对比**：`pnpm config:web`（即 `kmh.mjs web --dump-config`）输出 Web 最终配置；`pnpm dsh --profile kmh-headless --dump-config`（`--profile kmh-sdk` 等同理）输出任一 profile 的解析结果。优化前后 dump 结果一致，是"组合未变"的行为证据。
- **链接与目录状态**：`pnpm profiles` 列出 profile、bundle 与运行数据目录，确认测量前的登记状态一致。
- **CPU 剖析**：`DSH_HOME=<KMH_HOME> node --cpu-prof third_party/dsh/apps/cli/lib/bin.js --profile <name>` 对 DSH 入口取样，定位耗时在 Kongming 配置装载还是 DSH 应用初始化。注意 `--cpu-prof` 加在启动器上只覆盖 kmh.mjs 自身——spawnSync 出的子进程不会被剖析。
- **首次初始化成本**：把 `KMH_HOME` 指向新目录再运行，可单独测 prepareProfiles 建链接的冷成本；同目录重跑即为热路径。

## 设计如实的启动测量

启动测量没有独立基准设施，结论直接建立在上述命令的对照样本上。动手前记录一张测量卡：

| 字段 | 需要的决定 |
|---|---|
| 用户操作 | 确切命令（如 `node scripts/kmh.mjs web`）与外部可观察的完成条件（如服务端口可访问） |
| 工作负载 | profile 选择、KMH_HOME 冷/热状态、固定输入与构造常数 |
| 入口路径 | 直接 `node scripts/kmh.mjs` 或经 pnpm 包装；被排除的外部成本 |
| 计时 | 计时起止；冷（首次建链接）与热（realpath 校验）分开；排除的成本（如浏览器首屏） |
| 判定 | 全部样本、所选聚合、噪声余量；负控制（见下） |
| 行为 | 归属的功能检查（`pnpm test`、dump-config 前后一致）与允许的次要差异 |

原则保留并落到启动语境：

- **冷热分离**：冷样本使用全新 KMH_HOME 与新鲜子进程；热样本显式保留既定状态。准备步骤不得悄悄加热冷场景。
- **两侧对齐**：对照与候选使用相同输入、相同完成条件与相同可达输出；"解析后即丢弃"与"完整装载后可用"不可比。
- **排除模型/网络成本并写明排除**，不把结果称为完整产品时延。
- **每次只改一个因果因素**；要求负控制：收紧的断言必须在原始实现或受控重新引入被测成本时失败，否则不是保护。预算过宽放走回归、低于噪声底都不可靠。

## 先证明回归，再删除工作

改动生产代码前先跑未优化工作负载，保存命令、revision、平台、样本维度、原始测量与判定。把失败场景缩到仍能锻炼真实瓶颈，列出可证伪的假设再打补丁；用剖析、阶段计时或工作计数区分它们。

常见的、值得检验而非自动套用的模式：

- **条目数量先行**：对比各 profile 的 dump-config，确认慢在"装载多少"还是"怎么装载"。删除无人使用的插件条目、合并重复定义属于简化，证据标准参照 [kmh-find-simplifications](../kmh-find-simplifications/SKILL.md)。
- **patch 层数**：同一插件条目在多个预设重复展开时，评估能否由 bundle 依赖表达；任何重组后用 `--dump-config` 前后对比加 `pnpm test` 验证组合等价。
- **启动器自身的重复工作**：prepareProfiles 每次启动做目录扫描与 manifest 解析。先测量再判断；为省几毫秒引入缓存或状态文件，通常是复杂度大于收益。
- **构建产物状态**：插件装载使用构建产物（如 packages/kmh-echo 的 lib/）；过期产物造成行为错位而非单纯变慢。`pnpm test` 的 pretest 已包含 `build:kmh`，不要为此另建机制。

优化使端到端收益消失、典型工作负载明显回退、复杂度超过小收益、或取消/留存语义无法解释与测试时，放弃该优化；简短记录被否决的假设，不为它扩大范围。

## 保持行为与所有权

性能测量补充功能证据，不替代它。启动器行为改动后运行或补上窄的归属测试（现行归属在 `tests/runtime/`，如 launcher.test.mjs）：转发语义（调用者 cwd、凭据环境、stdio 继承、真实退出状态）、profile 校验报错、目录冲突报错。`pnpm test` 必须通过。涉及配置组合的改动用 `pnpm config:web` 或对应 profile 的 `--dump-config` 核对最终结果；Web 用户流程用实际浏览器验证，报告分别说明源码检查与运行结果。

写明任何有意为之的次要可见差异。收益无法端到端成立或行为语义无法保持时，回到上一节重新评估，而不是放宽验收。

## 边界

- **Session/Web 运行时性能**（长会话剖析、浏览器响应、历史读取、流式更新）与 **CI 性能门**属于 DSH 子模块。深入 DSH 时参照 [dsh-speed-up-perf（子模块原技能）](../../../third_party/dsh/.agents/skills/dsh-speed-up-perf/SKILL.md)；其基准设施与性能门按子模块自身的 benchmarks/ 与决策记录维护，本技能不重复其内容。
- Kongming 层当前没有独立 CI 性能门，启动耗时也不是 `pnpm test` 的断言。如需建立，按子模块模式在子模块内实施；Kongming 不另建平行设施。
- 子模块内部代码路径的优化遵循其 AGENTS.md，不在 Kongming 层重复规定。
- 测试的隔离、时钟与异步清理问题参照 [kmh-ci-test-reliability](../kmh-ci-test-reliability/SKILL.md)；本技能只处理启动耗时测量本身。

## 交付有边界的可复查结果

按约定提交：提交信息 type(scope): 中文 subject（scope 英文 kebab-case）。推送前的检查选择参照 [kmh-pre-push-checks](../kmh-pre-push-checks/SKILL.md)，只报告实际执行过的证据。

每项结果按以下格式总结：工作负载 → 优化前后绝对值与比率 → 端点与内存语义（适用时）→ 行为证据（dump-config 一致、pnpm test）→ 负控制 → 实际运行的命令 → 排除项。区分历史报告数字与本次本地实测。停在约定的场景与修复范围；留下简短的候选清单，不追逐无关机会。
