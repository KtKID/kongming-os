---
name: kmh-pre-push-checks
description: 在 push、force-push、把改动标记为 ready 或声称检查通过之前，以及重写历史的推送刚发布之后使用：按改动面选择覆盖本次 diff 的最小本地检查，而不是条件反射地运行全量套件。
---

# KMH Push 前检查

在向 private-main 推送之前，用本技能收集一次与改动相关的本地证据。Git 钩子刻意保持精简：pre-commit 检查暂存格式、代码文档分离与脚本语法；pre-push 运行当前 Node 启动测试。钩子之外没有普适的本地全量基线，更广的覆盖不会因 push 而自动发生。

## 先确认检出与分支

```sh
git status --short --branch
```

确认当前分支、与远端的关系以及未提交改动。Kongming 的推送目标是 private-main。提交遵循 type(scope): 中文 subject（scope 为英文 kebab-case），代码、测试与文档分别提交。

再确认待推送的改动面：取得已验证的基线 ref（通常为 origin/private-main），对照它检查完整改动范围。

```sh
git fetch origin private-main
git diff --stat origin/private-main...HEAD
```

合并基线变化后，重新评估合并后的改动面能影响的行为，只重跑被合并作废的检查。

## 按改动面选择证据

每项行为改动都需要一个能因它的回归而失败的最小检查；只为 diff 真正触及的面增加更广的检查。

| 改动面 | 最小检查 |
| --- | --- |
| `scripts/kmh.mjs` 或其他脚本改动 | `pnpm lint` |
| `launch.config.json`、`profiles/`、`bundles/` 配置改动 | `pnpm test`；必要时 `pnpm config:web` 核对最终配置；web 相关用户流程用实际浏览器验证，报告分别说明源码检查与运行结果 |
| `packages/kmh-*` 插件改动 | `pnpm build` + `pnpm test` |
| `third_party/dsh` 子模块改动 | 遵循子模块 AGENTS.md 与其自身检查；深入 DSH 时参照子模块原技能 [dsh-pre-push-checks](../../../third_party/dsh/.agents/skills/dsh-pre-push-checks/SKILL.md) |
| 文档改动 | 链接有效；命令说明与实际执行结果一致 |
| 涉及公开发布的改动 | 核对 [.publish/include.txt](../../../.publish/include.txt) 白名单；流程见 [.publish/README.md](../../../.publish/README.md) |

改动新增或修改了占用资源、依赖异步时序的测试、fixture 或辅助脚本时，先用 [kmh-ci-test-reliability](../kmh-ci-test-reliability/SKILL.md) 判断隔离、恢复与清理方面的可靠性证据是否适用；本技能仍负责挑选命令，不重复已经通过的检查。

不要因为接下来要 commit 或 push 就手动重跑同一检查。特别是 pre-push 钩子会运行 Node 启动测试；若所选证据就是它，交给钩子执行，不要在 push 前再手动跑一遍只为重复。

## 全量本地演练

仅当用户明确要求、正在排查失败，或改动面横跨仓库到没有可信的更小集合时，才做完整本地近似：按 `pnpm install --frozen-lockfile`、`pnpm run setup`、`pnpm build` 的顺序初始化构建，再运行 `pnpm test`。以当前工作流与 package scripts 为清单，不要凭空另造聚合命令。

## 保护重写历史的推送

rebase 允许用于本地分支，包括审查之后。重写已推送分支前，先取回远端分支并记录其准确 OID，用 `--force-with-lease=<branch>:<observed-oid>` 发布，使并发更新能让推送中止；裸 `--force` 始终不允许。

重写推送之后，重新取回远端 head 并重新核对。重写前的 commit hash 与评论锚点不再是当前证据。

## 处理失败

普通推送前相关检查失败：停下，修复或说明阻塞，不要推送后指望远端结果不同。

失败看似环境相关时，先证明它：

- 记录准确命令、失败测试与平台相关的差异点。
- 确认非平台相关的证据已经通过。
- 该检查是必需项时，优先修复跨平台的不确定性。
- 只有用户明确要求或同意时才绕过本地钩子，并准确报告失败了什么、为什么预期远端不同。

## 推送流程

1. 把所选相关检查跑一次。
2. 正常提交；pre-commit 拦下暂存格式、代码文档分离或脚本语法问题时，先修复再继续。
3. push 前用 `git status --short --branch` 再次确认分支与未提交改动，然后 `git push origin private-main` 正常推送，让 pre-push 钩子运行 Node 启动测试；仅对获准重写的分支使用准确 lease。
4. 核对远端 ref 与本地 HEAD 一致。

```sh
git rev-parse HEAD origin/private-main
```
