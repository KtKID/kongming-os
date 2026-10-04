# Kongming Harness（KMH）

KMH 插件框架工作区位于 Kongming 仓库根。基础框架层直接复用 DeepSeek Harness（DSH）基线源码（提交 `85805356f6b5fbc55d06ea129fc4e98e4b903ed3`）。迁移范围见 [框架与 CLI 范围](../architecture/kmh-dsh-framework-cli-scope.md)，迁入记录见 [迁移交付报告](../architecture/kmh-dsh-foundation-migration.md)。

## 布局（与 DSH 同构）

```
kongming-agent/            ← 仓库根与 Node 工作区根
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  tsconfig.base.json
  tsconfig.paths.json
  tsconfig.json
  vitest.config.ts
  vendor/                  ← Cordis 框架内嵌（@deepseek-ai/* scope，含 DSH 全部本地加固）
    cordis/ cosmokit/ schemastery/ loader/ include/ group/ timer/ logger-console/ hmr/
  packages/
    boot/                  ← profile/bundle/patch 装配、命令与插件管理
    core/                  ← agent、agent-loop、session、tools
    llm/                   ← 模型服务与适配器
    session/               ← 会话格式、持久化与投影
    shell/ subprocess/     ← 命令执行与子进程
    ...                    ← 其他能力组；目录清单见 packages/
  apps/cli/                ← dsh CLI（bin：profile 启动、插件管理、配置与 schema 查看、启动诊断）
  legacy/                  ← 2026-10 前旧 KMH 扁平工作区归档（已排除出 workspace，仅存档）
  scripts/                 ← Node 维护脚本与既有 Python/Web 脚本
  src/                     ← 既有 Python 实现
  web/                     ← 既有 Web 应用及独立依赖配置
```

## 常用命令

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm dsh --help
pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts
```

启动 profile 时用 `DSH_HOME` 指定隔离目录（默认 `~/.dsh`）：

```sh
DSH_HOME=/tmp/kmh-dsh-home pnpm dsh --profile <name> --dump-config
```

## 开发模型（继承自 DSH）

- 包间解析走根 `tsconfig.json`（solution 文件，`extends` 携带 `tsconfig.paths.json` 的
  paths 映射）：tsx 源码启动把 `@deepseek-ai/*` 解析到各包 `src/`，`const enum` 等仅
  源码形态存在的导出因此可用；预构建 `lib/` 同时保留，供 exports 消费。
- `tsc -b tsconfig.json` 的 `references` 是当前类型检查集合；集合外包和测试排除项分别在根配置中登记。
- vendor 包保持与 DSH 基线 1:1（scope、版本、本地修改），后续同步以 DSH vendor
  manifest 为准；不要在本工作区内单独发散 vendor。
- 能力组级 `README.md` / `README.zh.md` 由 `python scripts/sync_dsh_group_readmes.py`
  从 DSH 基线同步：正文 1:1 原样移植，文首自动插入「KMH 迁移注记」标明该组实际迁入
  的子包（DSH 侧更新后重跑即可刷新）；`--check` 只核对漂移不写入。
- 双语配对记录 `README.i18n.yaml` 由 DSH 迁移来的 `pnpm run verify-translation-pairing`
  工具生成与校验（scripts/ 下 7 个文件 1:1 自 DSH）。不拷贝 DSH 的旧记录——哈希基于
  DSH 原文，对带注记的 KMH 文本必失配；README 变更后用
  `pnpm run verify-translation-pairing --write packages/<组>/README.md` 重新生成。
  当前 check 模式对每组报告 1 条 locale 链接分歧，原因是组 README 链接的
  `docs/subsystems` 等目标尚未迁入 KMH（与死链清单同一缺口），随目标迁入逐步归零。

## 旧工作区上移

`scripts/move-node-workspace.mjs` 将原 `packages/` 工作区整体上移：功能包进入 `packages/<能力组>/<包>`，vendor 与 CLI 进入根目录的 `vendor/`、`apps/`，维护脚本合并进 `scripts/`。原工作区说明移至本文件，根产品 README 保留。包内相对引用随整体搬移保留。

```sh
node scripts/move-node-workspace.mjs          # 预览清单与冲突
node scripts/move-node-workspace.mjs --apply  # 执行一次上移；已完成时报告当前状态
pnpm install --frozen-lockfile               # 重建安装链接和命令入口
```

脚本在写入前检查同名文件、现有根依赖和同名环境变量冲突。根 `.env` 与原 Node `.env` 合并，原件和根 Vite 缓存保存在本地忽略目录 `tmp/node-workspace-migration-backup/`。当前本地 `tmp/kmh-dsh-home/profiles/` 中的插件路径会批量修复；迁移后创建的外部 profile 使用新的包路径。

包名到源码的映射集中在 `tsconfig.paths.json`。根 solution 只继承映射，包编译由 `tsconfig.base.json` 继承映射并声明 Node 编译选项，Web 构建器使用自身的编译配置。

## 上移验证（2026-10-03）

- `pnpm install --frozen-lockfile`：78 个 workspace 项目按原锁文件完成安装。
- `pnpm typecheck`：通过；源码旁本地产物清理数量为 0。
- `.venv/bin/pytest tests/unit/scripts/test_move_node_workspace.py tests/unit/scripts/test_node_workspace_cli.py -q`：12 用例通过。迁移脚本覆盖预览、文件与环境变量冲突、缓存备份、软链和 profile 脚本路径；CLI 覆盖根目录帮助、配置组合、timer 插件实际加载与本地回声模型驱动的完整 headless 任务。
- `pnpm exec vitest run packages/boot/app-boot/tests/linked-resolution-matrix.spec.ts packages/util/package-manifest/tests packages/subprocess/subprocess-local/tests/spawn.spec.ts packages/subprocess/subprocess-local/tests/spawn-runner.spec.ts`：3 个测试文件、4930 用例通过。
- 映射独立后，`pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts packages/subprocess/subprocess-local/tests/spawn-runner.spec.ts`：2 个测试文件、69 用例通过。
- `npm --prefix web run build`：TypeScript 检查与生产构建通过，ES2024 编译目标警告已消除。
- `node scripts/diff-with-dsh.mjs`：77 个已迁移包的 `src/` 与 DSH 核对为零差异；台账已刷新。
- `.venv/bin/ruff check`、`.venv/bin/ruff format --check`（两个新增 Python 测试文件）、`node --check scripts/move-node-workspace.mjs`、`git diff --check`：通过。
