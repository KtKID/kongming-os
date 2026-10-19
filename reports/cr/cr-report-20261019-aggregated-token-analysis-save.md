---
description: 聚合 Token 分析插件保存失败的配置组合复现、错误提示链路与修复建议；记录 2026-10-19 当前工作区的调查结果。
---

# 聚合 Token 分析插件保存失败调查

> Report ID: 20261019-aggregated-token-analysis-save
> Schema: x-cr-v2
> Mode: known-issue
> Scope: module
> Review 日期：2026-10-19
> 审查范围：aggregated-token-analysis 的挂载、配置保存与失败提示

## 调查对象

插件通过 bundle 与 profile 各插入一个同 ID 条目，保存补丁更新后插入的条目，宿主校验读取先插入的条目，因此拒绝落盘。宿主错误把有效配置差异归为 home patch / CLI overlay；浏览器表单又把全部失败归为并发修改。

| 字段 | 内容 |
|------|------|
| 用户现象 | 插件详情页持续保存失败，截图提示并发修改 |
| 用户提供的宿主错误 | `Configuration for "aggregated-token-analysis" is overridden by a home patch or command-line overlay` |
| 期望 | 配置保存、持久化并立即生效 |
| 归属 spec | [spec](../../docs/spec/aggregated-token-analysis-view-v0.1/spec.md)，C2/C5/C6、feat03 场景1 |
| spec 定位方式 | 按插件目录与 ID 检索 |
| 调查方式 | 源码、启动记录、实际配置组合函数与内存反例 |

## 模块模型与审查范围

| 层级 | 对象 | 输入 / guard / 状态所有者 | 副作用与证据 |
|------|------|--------------------------|--------------|
| 主模块 | [profile 清单](../../profiles/kmh-web/package.json:30)、[profile patch](../../profiles/kmh-web/cordis.patch.yml:59)、[bundle patch](../../packages/aggregated-token-analysis/cordis.patch.yml:3) | bundle 选择和两次同 ID 插入 | 当前组合返回两个同 ID 条目 |
| 入口适配层 | [配置控制器](../../packages/aggregated-token-analysis/src/client/config-controller.ts)、[页面](../../packages/aggregated-token-analysis/src/client/ConfigForm.tsx:58) | URL / 正整数校验、共享表单 | 提交 settings namespace mutation |
| 状态所有者 | [settings](../../third_party/dsh/packages/settings/settings/src/index.ts:378) | volatile 字段、revision 检查 | 调用 ConfigEditor.edit |
| 持久化所有者 | [ConfigEditor](../../third_party/dsh/packages/boot/config-editor/src/index.ts:138) | 组合候选文件，取首个匹配 ID，比较 next | 相等才原子写 profile；此次在写入前失败 |
| 契约邻居 | [patch 组合](../../third_party/dsh/vendor/include/src/index.ts:57)、[层级读取](../../third_party/dsh/packages/boot/app-boot/src/profile-context.ts:63) | 插入保留两个对象，ID 索引指向最后对象 | 后续配置覆盖更新最后插入的对象 |
| 失败提示 | [共享表单](../../third_party/dsh/packages/client/ui-primitives/src/settings-form/form-model.ts:301)、[词典](../../packages/aggregated-token-analysis/src/client/locales.ts:18) | catch 统一置 failed；页面固定文案 | 全部保存失败均提示并发修改 |

## 不变量覆盖

| INV-ID | 来源类型 | 不变量 | 来源 / 依据 | 本次触达路径 | 最小反例 | 结论 | 关联问题 |
|--------|----------|--------|-------------|--------------|----------|------|----------|
| INV-SPEC-01 | spec 声明 | 用户可在详情页修改、保存地址和超时并立即生效 | C2/C5/C6、feat03 场景1 | 表单 → settings → ConfigEditor → 候选组合检查 | 两次同 ID insert 后设置 pageUrl，首条 config 为 {}，next 含新值 | 破坏 | B1 |
| INV-CAND-01 | 补充候选 | 提示表达已有证据支持的失败原因 | 词典、共享表单、用户截图 | 宿主异常 → 表单 catch → saveFailed | 确定的组合差异显示为并发修改并建议重试 | 破坏 | B2 |
| INV-CAND-02 | 补充候选 | 宿主成功返回前验证最终有效配置与 next 一致 | ConfigEditor:138-142 | 组合 → 比较 → 写文件 | 组合首条 config 与 next 有差异 | 保持 | - |

### 补充候选与 spec 关系

| INV-ID | 关系 | 证据 | 后续 |
|--------|------|------|------|
| INV-CAND-01 | spec 缺口 | feat03 定义了输入错误；保存异常分类由当前通用组件和插件词典表达 | 修复时补入准确失败提示要求 |
| INV-CAND-02 | 已被 spec 覆盖 | feat03 场景1 的保存并生效，宿主持久化 guard 提供保护 | 保留宿主保护 |

## 贝叶斯根因调查

| H | 关联 INV-ID | 先验 | 证据 E | 影响 | 更新后置信度 | 下一步 |
|---|-------------|------|--------|------|--------------|--------|
| H1：home patch / CLI config 覆盖 | INV-SPEC-01 | 高 | 当前 home 为 /Users/kid/.kmh-os；其中 cordis.patch.yml 文件缺席；PID 61172 参数为 --profile kmh-web --no-open；空 overlays 即可复现 | 削弱 | 低 | 按组合差异继续追踪 |
| H2：重复同 ID 挂载触发校验差异 | INV-SPEC-01 | 中 | 两处 insert；实际组合生成两条；写入候选 config 更新第二条，首条保留 {}；移除重复插入后校验通过 | 支持 | 已确认 | 按单一挂载归属修复 |
| H3：revision 并发冲突 | INV-SPEC-01 | 中 | 用户提供的错误对应 ConfigEditor 的有效配置校验；静态配置即可复现同一差异 | 削弱 | 低 | 修复组合后再做真实保存验收 |
| H4：通用失败被固定翻译为并发修改 | INV-CAND-01 | 高 | configForms 将失败响应转为 false；form-model catch 也只置 failed；ConfigForm 使用固定 saveFailed 词典 | 支持 | 已确认 | 在共享表单链路保留并显示宿主原文错误 |

## 审查结论

### P0：阻断性正确性错误

0 项。

### P1：生产正确性风险

| ID | 状态 | 来源 | INV-ID | 检查项 | 文件:位置 | 置信度 | 根因分类 | 描述 |
|----|------|------|--------|--------|-----------|--------|----------|------|
| B1 | ✅已修复 | 配置组合反例 | INV-SPEC-01 | 保存被确定性阻断 | profiles/kmh-web/cordis.patch.yml:59 | 已确认 | 实现过程偏移 | bundle 与 profile 双重插入；写末条、验首条 |
| B2 | ✅已修复 | 用户截图与错误路径 | INV-CAND-01 | 保存失败原因误报 | packages/aggregated-token-analysis/src/client/locales.ts:18 | 已确认 | spec 缺口 | 固定并发提示掩盖确定性配置组合问题，README 建议持续失败时重启 |

### P2：正确性证据或契约缺口

0 项。实际修复后的浏览器保存与重启保留属于后续修复验收，本轮覆盖配置组合与现有失败链路。

## 问题详情

### B1: 同 ID 双重插入导致候选保存校验失败

**关联不变量**：INV-SPEC-01。**严重程度**：P1。**置信度**：已确认。**根因分类**：实现过程偏移。

`profiles/kmh-web/package.json:30` 选择插件 bundle，其 patch 插入一个实例。`profiles/kmh-web/cordis.patch.yml:59` 再插入一个实例。`applyEntryPatches` 保留两个对象并让 ID 索引指向后者，配置覆盖因此更新后者。`ConfigEditor:138` 的 find 取前者，比较失败后在原子写入前抛出用户提供的错误。

最小反例与当次结果：使用已构建的 app-boot 导出加载当前 profile，通过 `readProfilePatches` 与 `composeEntries` 组合，向内存候选追加 `{ id, name, config: next }`。next 为 pageUrl=`http://127.0.0.1:60009/`、pageLoadTimeoutMs=8000。

```text
current: count=2, configs=[{}, next], hostPrewriteCheckPass=false
keep bundle + remove profile insertion: count=1, configs=[next], hostPrewriteCheckPass=true
PASS: 两组结果均经独立 assert 断言；生产配置保持调查前状态。
```

反证检查：当前 home patch 文件缺席，启动参数只有 profile 与 no-open；URL 和超时通过插件输入约束；错误位置在 config 校验之后、写文件之前；静态配置即可产生该差异。home / CLI 的优先级机制本身成立，错误字符串对差异来源的归因范围过窄。

**修复建议**：保留 profile 清单中的插件依赖与 bundle 选择；移除 profile patch 的重复 insert 子项。未来部署覆盖使用顶层 `- id: aggregated-token-analysis` 的覆盖补丁。增加最终组合中目标 ID 恰为一条的断言，并覆盖候选保存的有效配置检查。

**处置结果**：✅已修复

**处置说明**：保留 bundle 的 insert，profile 改为顶层配置覆盖。实际浏览器成功保存地址和超时；重启后两项保持，最终组合的目标 ID 为一条。

### B2: 全部保存异常均提示并发修改

**关联不变量**：INV-CAND-01。**严重程度**：P1。**置信度**：已确认。**根因分类**：spec 缺口。

共享 SettingsFormModel 的 catch 仅记录 failed，插件页面固定显示词典 `config.saveFailed`。当前中英文词典均把失败解释成并发修改；README 的配置说明进一步建议重试和重启。重复挂载持续存在时，这些操作持续触发同一校验差异。

**修复建议**：按用户 2026-10-19 的明确要求，页面直接显示宿主返回的原文错误。settings-controller 已保留错误 message；configForms 的 mutate 在响应失败时执行恢复读取并返回 false，原文在此丢失；SettingsFormModel 的 catch 同样只保留 failed。修复需让失败消息经过 configForms、SettingsFormModel 和 SettingsForm 传到页面，并保留恢复读取、草稿与 revision 语义。上述共享链路归属 DSH，执行子模块修改须取得单独授权。同步修正插件 README 中的恢复说明。

**处置结果**：✅已修复

**处置说明**：使用 KMH 自有 `config-write.ts` 调用公开 settings Remote，在共享 configForms 入口丢弃原文之前接收写入结果；成功应答经公开 `acceptView` 回填共享镜像。控制器捕获错误原文并交给现有 SettingsForm 的 label 显示。实际双页面冲突显示宿主完整原文并保留草稿，后续成功保存清除错误。DSH 文件保持原状。

### MadeMe 对照

当次使用实际 profile 组合函数核对：MadeMe 实例数为 1，Token 分析实例数为 2。两者均声明包依赖与包自身的 dsh.bundle.patch；这些声明分别提供模块解析和 bundle 入口元数据。当前 profile 的 dsh.profile.bundles 只选择了 Token 分析 bundle，MadeMe 通过 profile patch 的 insert 挂载。Token 分析的 bundle patch 与 profile patch 各执行一次 insert，从而产生重复实例。

同一插件包可以拥有多个实例，各实例使用唯一 ID；同一实例可以在 bundle 中 insert，并由 profile 中顶层 id 补丁覆盖配置。两层以同一 ID 分别 insert 会保留两个条目，并触发本次校验差异。

## 修复方案与验收

建议以 bundle 为唯一实例来源，完成 B1 的去重和 B2 的宿主原文错误透传。此次内存模拟已证明去重后宿主的保存前比较通过。

后续修复验收：

1. 检查最终组合中目标 ID 恰为一条，运行仓库要求的配置检查 `pnpm test`。
2. 重新启动 Web，使 bundle 启动组合与当前文件一致；在真实浏览器更改地址、超时并保存，核对 profile 文件和实际页面生效。
3. 刷新与重新启动后核对值保留，再验字段 Reset。保留调查前配置以便恢复。

以上为方案及验收要求；当次执行限于内存组合复现和现有插件冒烟测试。

## 覆盖声明

| 范围 | 状态 | 证据或缺口 |
|------|------|------------|
| spec 相关不变量 | 完成 | C2/C5/C6 中与保存相关的要求已合并至 INV-SPEC-01；页面内容、外站加载、启停生命周期属于其他路径 |
| 主模块与契约邻居 | 完成 | manifest、两份 patch、组合函数与 settings 调用链 |
| 状态/权限所有者 | 完成 | settings volatile/revision guard、ConfigEditor 校验及原子写入顺序 |
| 入口、失败路径和副作用 | 完成 | 表单提交、catch、固定词典、候选文件校验 |
| 测试与运行证据 | 完成 | 当前 profile 的组合反例和去重对照断言；8/8 插件冒烟测试通过；启动 launch.json 与进程参数核对。真实浏览器修复验收列入后续步骤 |

调查阶段保留既有修改并新增本报告。调查结论为根因已确认，P0=0、P1=2、P2=0。修复后的结果见下表与修复报告。

## 修复备注

> 修复执行日期：2026-10-19；执行 x-fix；按用户授权限定 KMH 层。

| ID | INV-ID | 严重程度 | 文件 | 处置结果 | 修复方式 | 反例/验证 | 备注 |
|----|--------|----------|------|----------|----------|-----------|------|
| B1 | INV-SPEC-01 | P1 | profiles/kmh-web/cordis.patch.yml | ✅已修复 | bundle 插入、profile 覆盖 | 唯一 ID 回归、实际保存与重启后读回 | 最终 60009/、8000 ms |
| B2 | INV-CAND-01 | P1 | packages/aggregated-token-analysis/src/client | ✅已修复 | 公开 Remote 写入适配、错误原文展示 | 原始拒绝与传输异常回归；双页面实际冲突显示原文 | 公共表单与 DSH 源码保持原状 |

修复与验证证据见 [修复报告](../fix/fix-report-20261019-aggregated-token-analysis-save.md)。已修复 2 条，无需修复 0 条，待确认 0 条，已跳过 0 条。
