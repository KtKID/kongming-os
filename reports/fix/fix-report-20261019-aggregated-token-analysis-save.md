---
description: Token 分析插件唯一挂载、保存失败原文展示及实际保存与重启持久化验收；全部代码改动位于 KMH 层。
---

# Token 分析插件保存修复

> 修复日期：2026-10-19
> 修复方式：x-fix，承接 [CR 报告](../cr/cr-report-20261019-aggregated-token-analysis-save.md) 的 B1/B2。

配置页可以保存新地址和超时，失败直接显示宿主或传输层返回的原文错误。浏览器已验证新值生效、失败草稿保留，以及重启后配置保留。

## 处置结果

| ID | 严重度 | 处置 | 修改 | 证据 |
|----|--------|------|------|------|
| B1 | P1 | ✅已修复 | 保留 bundle insert；profile 使用顶层 id 配置覆盖 | 实际组合目标 ID 恰为一条；真实表单保存与重启后读回 |
| B2 | P1 | ✅已修复 | KMH 写入适配调用公开 settings Remote，回填共享镜像，捕获原文供现有 SettingsForm 显示 | 单测覆盖原始宿主拒绝与传输异常；真实双页面版本冲突显示完整原文 |

修复前输入兼容样本为默认配置 `{}`，以及截图对应的自定义地址 `http://127.0.0.1:60009/`、超时 `8000`。配置字段和默认值保持既有定义。新增的写入适配继续转发表单草稿起始 revision，宿主仍负责字段校验与持久化。

## 改动归属

- [profile patch](../../profiles/kmh-web/cordis.patch.yml)：移除重复 insert，添加顶层配置覆盖；最终值经真实页面保存。
- [config-write.ts](../../packages/aggregated-token-analysis/src/client/config-write.ts)：公开 settings Remote 写入、拒绝后的状态恢复、原文错误与共享镜像更新。
- [config-controller.ts](../../packages/aggregated-token-analysis/src/client/config-controller.ts)、[ConfigForm.tsx](../../packages/aggregated-token-analysis/src/client/ConfigForm.tsx)：原文错误快照及现有表单展示。
- [client 入口](../../packages/aggregated-token-analysis/src/client/index.ts)、[词典](../../packages/aggregated-token-analysis/src/client/locales.ts)：接线公开 Remote 与原文错误；服务注入同时声明 remote 和 remote.settings。
- [保存回归](../../packages/aggregated-token-analysis/test/token-analysis-save.test.mjs)、已有注册与冒烟测试：验证唯一挂载、原文错误、草稿、revision、成功回填及注入声明。
- 插件 [README](../../packages/aggregated-token-analysis/README.md)、[spec](../../docs/spec/aggregated-token-analysis-view-v0.1/spec.md)、[技术设计](../../docs/spec/aggregated-token-analysis-view-v0.1/tech-design.md)：同步配置归属与失败处理。

DSH 子模块的代码、构建文件与 Git 指针保持原状。工作区既有的其他修改保留。

## 真实浏览器验证

目标实例为 `http://127.0.0.1:60000/`，数据目录 `/Users/kid/.kmh-os`，profile 为当前仓库 `profiles/kmh-web`。

1. 启动修复后实例 PID 80488。详情页显示一个组件，组件开关具备操作状态。
2. 在表单保存地址 `http://127.0.0.1:60009/` 和超时 `8500`。保存按钮回到禁用状态，profile 顶层配置覆盖写入两个值。
3. 第一页面保留超时 `8700` 的草稿；第二页面先保存 `8600`。第一页面保存后显示宿主原文：

   ```text
   settings namespace "aggregated-token-analysis" changed since it was read (expected revision 1, now 2)
   ```

   第一页面继续显示 `8700` 草稿。原文错误的完整页面截图与插件配置区域截图作为本机验收证据保存。
4. 离开并重进详情页，以当前宿主配置重新编辑，将超时保存为最终值 `8000`；原错误消失，地址保持 `60009/`。
5. 点击 Token 分析，DOM 中 iframe 的 src 为 `http://127.0.0.1:60009/`，内嵌页面显示“x-token / 本地 Token 消耗洞察”。
6. 执行同一实例的 `./kmh.sh restart`，服务 PID 从 80488 变为 84120。浏览器重新加载后，配置页显示地址 `60009/`、超时 `8000`、一个运行组件、禁用的保存按钮。
7. 重启后再用实际配置组合函数读取，结果为 `count=1`，config 为上述最终值；60000 端口由 PID 84120 监听。

重启后配置截图保存在本机 `reports/fix/assets/aggregated-token-analysis/restart-retained.png`；报告图片统一由 Git 忽略。

## 检查结果

| 检查 | 结果 |
|------|------|
| 插件构建及 `node --test packages/aggregated-token-analysis/test/*.test.mjs` | 22/22 通过 |
| 插件 typecheck、lint、format:check | 通过 |
| `git diff --check` | 通过 |
| `pnpm test` | 380/380 通过，exit 0，约 393 秒；初次因沙箱本地 listen 返回 EPERM 后，在允许本地服务的环境完整重跑 |
| CR schema 校验与报告链接 | 通过；两份报告的全部链接与截图文件已检查 |
| `./kmh.sh status` | PID 84120、supervisor PID 84082，60000 端口运行中，崩溃记录为无 |
| DSH 边界 | 子模块 status 为空，Git 指针保持原状 |

初次直接在仓库根运行包内 build 脚本时，TypeScript 按当前目录查找根 tsconfig 并失败；改用包的 `pnpm --filter @kmh/aggregated-token-analysis build` 后构建通过，README 验证入口同步使用该命令。浏览器初测还发现 Remote 根服务需显式声明 inject，补齐后完成真实保存与冲突验收。
