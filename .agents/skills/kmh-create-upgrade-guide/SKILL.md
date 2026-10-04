---
name: kmh-create-upgrade-guide
description: 当 Kongming 层改动破坏外部可感知面——launch.config.json 的键与语义、profiles/*/cordis.patch.yml 与 bundles/*/cordis.patch.yml 的键、KMH_HOME 与启动器转发行为、packages/kmh-* 插件入口与导出、.publish/include.txt 白名单语义——或改动某条升级说明已覆盖的面时使用：把迁移说明写入 docs/kmh/README.md 的"版本升级"节（或该节链接的专门文档）。
---

# KMH 升级影响面说明

升级说明告诉一个停留在旧状态的使用者：要改成什么，才能在下一个状态下继续运行。它写在引入破坏的那次改动里，破坏一经识别就写；不要推迟到发布准备时。

## 适用范围

只为升级后仓库外部的人能观察到的破坏写说明。Kongming 的外部可感知面包括：

- `launch.config.json` 的键与语义，以及 `pnpm cli`、`pnpm web`、`pnpm sdk` 等短命令对应的 profile 选择方式；
- `profiles/*/cordis.patch.yml` 的键与取值，例如 `webserver.config.port`、`web-runtime.config.openBrowser`；
- `bundles/*/cordis.patch.yml` 的键与叠加顺序；
- `KMH_HOME` 的含义，以及启动器的转发行为（调用者工作目录、模型凭据、真实退出状态）；
- `packages/kmh-*` 插件的包名、入口与导出；
- `.publish/include.txt` 白名单的语义（哪些路径进入公开发布）。

内部 API 的所有消费方都在同一次改动内更新的，不需要说明。

## 与 DSH 子模块的职责边界

子模块面的破坏性变更——`cordis.yml`、settings 键、持久化数据、SDK 与 wire API、发布包入口——由 DSH 子模块自己的升级指南机制负责，参照子模块原技能 [dsh-create-upgrade-guide](../../../third_party/dsh/.agents/skills/dsh-create-upgrade-guide/SKILL.md)；本技能不重复其范围。

本技能只回答一个问题：子模块升级传导到 KMH 层时，Kongming 的配置、文档与发布白名单需要跟着什么变。典型传导是 Web 配置：升级时导出新版 DSH Web 配置，与 `profiles/kmh-web/upstream.cordis.yml` 比较，再审查并合入实际 profile；子模块指针升级与检查流程见 [docs/kmh/README.md 的"版本升级"节](../../../docs/kmh/README.md#版本升级)。

## 落点

Kongming 层的升级说明写入 [docs/kmh/README.md](../../../docs/kmh/README.md#版本升级) 的"版本升级"节，或该节链接的专门文档，与子模块指针升级说明放在一起：

- 单次破坏内容较短时，作为该节内的一个小节。
- 内容较长时，在 `docs/kmh/` 下新建 kebab-case 文件名的专门文档，并从该节链接过去。
- 骨架与各节核查要求使用 [kmh-doc 的升级指南模板](../kmh-doc/templates/upgrade-guide.md)。

Kongming 文档为简体中文单语，不要求双语配对。

## 结构要点

- frontmatter 按 Kongming 文档规则只写 `description`（见 [kmh-doc](../kmh-doc/SKILL.md)），一句话点名被破坏的表面；不引入 `kind` 等元数据字段。
- 一个 `#` 标题，然后固定顺序的 `## 变更` 与 `## 迁移` 两节。
- `变更` 节说明该表面的旧行为与新行为，以及谁会观察到差异。
- `迁移` 节列出有序步骤：指名要修改的精确文件、键、命令或符号，代码比文字短时给出前后对照片段；并说明如何确认迁移成功。
- 说明集中在一个位置：超出指南容量的理由与背景链接到归属文档（源码、包 README、架构文档），不整段复述；反复出现的机械迁移步骤先做成脚本或命令，再由指南调用。句子级契约遵循 [kmh-prose-standard](../kmh-prose-standard/SKILL.md)。

## 维护

一条升级说明描述从旧状态到新状态的一次迁移，不写成跨越多次子模块指针升级的累积清单。

后续改动触及同一表面时，在同一次改动里更新对应说明；破坏被回退时删除对应说明。迁移完成、新行为成为当前行为之后，把长期契约归入它的常规文档归属处，一次性的过渡步骤不再保留——Kongming 文档只写当前状态，规则见 [kmh-doc](../kmh-doc/SKILL.md)。

## 验证

Kongming 没有专门的升级指南检查脚本，验证由以下部分组成：

1. **链接目标存在。** 说明中的相对链接逐个核对到真实文件；引用子模块路径的链接在子模块初始化后核对。
2. **所述命令实际运行。** 迁移步骤与确认方式按事实核查流程执行（见 [kmh-doc](../kmh-doc/SKILL.md)）；配置面的最终结果可用 `pnpm config:web` 或 `pnpm run dsh --profile kmh-headless --dump-config` 核对。
3. **伴随改动的既有检查。** 配置与启动面运行 `pnpm test`，脚本修改运行 `pnpm lint`；push 前参照 [kmh-pre-push-checks](../kmh-pre-push-checks/SKILL.md)。

最后重读完整 diff，核对说明只覆盖声明的破坏，且没有把子模块面的变更误纳入 Kongming 迁移步骤。
