---
description: 访问记录专项覆盖率使用的固定 Git 基线与统计范围。
---

# 覆盖率基线

功能和用例主定义见[现行规格](../../../spec.md)与[技术设计](../../../tech-design.md)，首次交付内容由 Git 提交 `b6cad43` 定位。

`git-base.json` 固定开始开发前的 Git 提交。五个 TS/TSX 业务模块全量计入；四份 Host 文件统计相对该提交的新增或替换行；`client/index.jsx` 只统计 `apply` 注册入口中的新增或替换行。原设置表单由独立设置测试承接。检查器直接读取 Git 差异，输出逐文件散列、统计行与原始计数，四项覆盖率门槛均为 100%。

`client/pocket-locales.js` 的文案合并接线同样按 Git 差异统计。
