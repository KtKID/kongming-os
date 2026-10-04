# 模板：升级指南

用于 Kongming 层一次对外可感知的破坏性变更的迁移说明，落在 `docs/kmh/`；现行升级入口见 [docs/kmh/README.md 的"版本升级"节](../../../../docs/kmh/README.md)。范围、位置与维护规则由 [kmh-create-upgrade-guide](../../kmh-create-upgrade-guide/SKILL.md) 承担，本模板只提供骨架与各节核查要求。

## frontmatter

```yaml
---
description: "被破坏的对外可感知表面与替代方式。"
---
```

## 骨架

````markdown
# <具体破坏，例如：`--profile` 取代 `--preset`>

## 变更

说明该表面的旧行为与新行为，以及谁会观察到差异。

## 迁移

1. 指名要修改的精确文件、键、命令或符号；代码比文字短时给出前后对照片段。
2. 说明如何确认迁移成功。
````

## 规则

- 一次破坏一篇指南；变更节与迁移节只描述该破坏，不扩展成版本总览。
- 迁移步骤中的每条命令实际运行后再写入（要求见 [SKILL.md 的事实核查节](../SKILL.md#事实核查测试而非假设)）。
- 单语简体中文；Kongming 文档不要求双语配对。
- frontmatter 只写 `description`。
