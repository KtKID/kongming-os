---
name: private-public-git-flow
description: 设置"私有 Gitea 全量仓库 + 公开 GitHub 发布镜像"的双 remote + worktree 分离流程。通过 orphan 分支 + push refspec 白名单，让私有 commit 物理上不会被推到公开镜像。当用户说"设置双仓库"、"私有+公开分开"、"worktree 分开仓库"、"private public 分支"、"Gitea + GitHub 双推"、"搞个孤立分支放公开版本"、"设置两个 remote 白名单"、"开源版本和私有版本分开"、"公开仓库看不到私有分支"、"private-main"、"private-dev" 时必须触发。也适用于用户担心私有 commit 泄露到公开镜像、想用 orphan 分支维护干净发布历史、或者想把一个项目同时放在自托管 Gitea 和 GitHub 上但只公开一部分内容的场景。
---

# Private/Public 双仓库 Git 流程

本 skill 固化一套经过验证的做法：同一个本地 Git 仓库维护**两条互不相通的历史线**，一条推到私有 Gitea（全量），另一条推到公开 GitHub（仅发布内容）。核心机制是 `orphan 分支 + git worktree + push refspec 白名单`。

## 它解决什么问题

- 日常开发想留私有 commit（实验、wip、内部设计文档、未决定的想法）
- 同时要在 GitHub 维护一个"干净"的公开版本
- 公开版本绝对不能暴露私有 commit——不管是通过 `git log`、`git fetch`，还是手滑敲了 `git push --all`

## 分支命名约定

建议用这套命名，方便团队对齐：

| 分支 | 用途 | 推到哪 |
|---|---|---|
| `private-main` | 私有主干（日常工作整合点） | Gitea（origin） |
| `private-dev` | 日常开发 | Gitea（origin） |
| `private/*` | 实验、wip、单人分支 | Gitea（origin） |
| `main` | **孤立分支**，从零开始的公开历史 | GitHub（public，映射成 main） |

关键：`main` 是孤立分支，和 `private-*` 没有任何共同祖先 commit，所以公开侧的 `git log main` 永远看不到私有 commit。

## 目录布局

用 `git worktree` 把两条分支物理放在两个目录，避免在同一个工作树里反复切换、降低误操作：

```
<project>/              ← 私有工作树，HEAD → private-main
<project>-public/       ← 公开工作树，HEAD → main (orphan)
<project>/.git/         ← 共享对象库（两个 worktree 共用）
```

## 前置确认清单

**所有 git 操作之前必须让用户明确确认**。这个 skill 不允许静默执行 mutation。

逐项确认：

1. 项目是否已在 Git 仓库里？空目录要先 `git init`
2. 当前主分支叫 `main`、`master` 还是别的？——决定 rename 的源名字
3. 有没有未提交改动？有的话先让用户决定是 commit 还是 stash
4. 目标公开 worktree 目录（默认 `../<项目名>-public`）是否已存在？存在就不能覆盖，让用户换一个路径或先清理

## 执行步骤

### 步骤 1：重命名私有分支

无损操作。当前 `main` / `dev` → `private-main` / `private-dev`。HEAD 自动跟随，不需要手动切换。

```bash
git branch -m main private-main
git branch -m dev  private-dev   # 没有 dev 可跳过
git branch -v
```

### 步骤 2：创建 orphan 公开 worktree

**前提：Git ≥ 2.42**（`worktree add --orphan` 是 2.42 引入的）。

```bash
git worktree add --orphan -b main ../<项目名>-public
```

完成后：
- `../<项目名>-public/` 是空目录（只有一个 `.git` 指针文件）
- `main` 分支存在但无 commit（"No commits yet"）
- `.git/` 两边共享

#### Git < 2.42 的 fallback

```bash
# 在主 worktree 里先建 orphan 分支
git switch --orphan main
git rm -rf . 2>/dev/null; true

# 切回私有分支，避免在主 worktree 里误操作 orphan 分支
git switch private-main

# 把 orphan 分支拉到兄弟目录
git worktree add ../<项目名>-public main
```

### 步骤 3：配置 remote

```bash
# origin → 私有 Gitea（全量推送目的地）
git remote add origin <gitea-url>

# public → 公开 GitHub（只接受 main）
git remote add public <github-url>
```

### 步骤 4：给 public 设 push refspec 白名单

**最关键的一步。** 配置后，`git push public`（不带参数）**只会**推本地 `main` 到远端 `main`，其他分支哪怕被意外推入也会被 refspec 忽略。

```bash
git config --add remote.public.push refs/heads/main:refs/heads/main
```

可选加固——禁掉 public 的 fetch，避免从 GitHub 误拉回内容：

```bash
git config --unset-all remote.public.fetch 2>/dev/null; true
```

### 步骤 5：验证

执行这几条命令确认配置正确：

```bash
# 两个 worktree 都在
git worktree list

# 三条分支：main、private-main、private-dev
git branch

# 公开 worktree 的 log 应该是空的
cd ../<项目名>-public && git log main --oneline 2>&1 | head

# dry-run 推送，只应该传 main
git push --dry-run public
```

## 日常使用

### 私有开发

在 `<project>/` 自由 commit 到 `private-main` / `private-dev`，`git push origin <branch>`。

### 公开发布（两档）

**L0 手动模式**（偶尔发布、内容简单时用）：

1. `cd ../<项目名>-public`
2. 手动复制或重写想公开的内容到当前目录
3. 告诉 Codex "commit" + 想要的 message → Codex 先贴 `git status --short` + `git diff --staged --stat` 给你过目，再执行 `git commit`
4. 告诉 Codex "push" → Codex 先跑 `git push --dry-run public` 贴给你看，再执行真推

**L1 脚本模式**（推荐，见下一节配置）：

1. 告诉 Codex "发布" → 它跑 `bin/publish.sh`，把白名单里的文件同步到公开 worktree
2. Codex 把 diff 贴给你看
3. 你给 commit message + 说"push" → Codex 分两步执行，每步都先展示要做什么

## L1 发布自动化（推荐配置）

L0 的痛点是每次手动 `cp` 容易漏文件或多带文件。L1 用**一份白名单 + 一个小脚本**自动化"从私有侧拉指定文件到公开侧"这一步；commit / push 仍由用户触发、Codex 执行、执行前展示内容。

### 白名单文件

项目根 `.publish/include.txt`（文件本身留在私有侧，不发布）。规则：

- 每行一个相对于项目根的路径，目录结尾加不加 `/` 都行（rsync `-a` 会递归）
- **支持 `#` 行首注释和空行**——脚本喂给 rsync 前会过滤掉（原生 rsync `--files-from` 不认注释）

```
# 公开侧需要的文件和目录，按 rsync --files-from 语义
src/
README.md
LICENSE
docs/public/
```

### 发布脚本

`bin/publish.sh`（也只留在私有侧）：

```bash
#!/usr/bin/env bash
set -euo pipefail

PRIVATE="$(git rev-parse --show-toplevel)"
PUBLIC_NAME="$(basename "$PRIVATE")-public"
PUBLIC="$(cd "$PRIVATE/.." && pwd)/$PUBLIC_NAME"

[[ -f "$PRIVATE/.publish/include.txt" ]] || { echo "缺 .publish/include.txt"; exit 1; }
[[ -d "$PUBLIC" ]] || { echo "缺公开 worktree: $PUBLIC"; exit 1; }

# 过滤掉 # 注释和空行后，再喂给 rsync
grep -v '^\s*\(#\|$\)' "$PRIVATE/.publish/include.txt" \
  | rsync -av --delete --files-from=- "$PRIVATE/" "$PUBLIC/"

cd "$PUBLIC"
echo ""
echo "=== 公开 worktree 当前状态 ==="
git status --short
```

### 完整发布流程（与"行为准则"对齐）

用户说"发布" / "publish" / "推 GitHub" 时，Codex 按序执行：

1. 跑 `bin/publish.sh`（只同步，不 commit）
2. 贴 `git status --short` + `git diff --stat` 给用户看
3. 用户给 commit message → 在公开 worktree 里 `git add -A && git commit -m "<msg>"`
4. 跑 `git push --dry-run public` 贴给用户看
5. 用户说"push" → 执行 `git push public`

每一步 mutation 都是**用户触发 + Codex 执行 + 执行前展示**，错误发布的防线在"展示内容让用户过目"这一步。

### L2 可选扩展：内容过滤

公开文件里夹杂少量私有片段时（比如一份 README 里只有几段不想公开），在 `.publish/` 再放 `filter.sed`：

```sed
/<!-- private:start -->/,/<!-- private:end -->/d
s/INTERNAL_API_KEY=.*/# redacted/
```

脚本 rsync 之后追加一步：

```bash
find "$PUBLIC" -type f -name "*.md" -exec sed -i.bak -f "$PRIVATE/.publish/filter.sed" {} \;
find "$PUBLIC" -name "*.bak" -delete
```

这样私有 MD 里用 `<!-- private:start -->` / `<!-- private:end -->` 圈出的段落，发布时自动剔除；敏感字符串自动 redact。

## 安全护栏

- **绝对不要** `git push --all public` 或 `git push --mirror public`——这两个会无视 refspec 白名单，把所有本地分支推过去
- **Gitea 侧**：把 `private-main`、`private-dev`、`private/*` 设成 protected branch，拒绝 force-push（Codex 不替用户在 web UI 设置，只提醒）
- **GitHub 侧**：打开 branch protection，`main` 要求 signed commits 或 push ruleset，作为第三道拦截
- 每次发布前人工跑一遍 `git diff private-main main --stat`，扫一眼 staging 是否带出敏感信息

## 为什么私有 commit 不会泄露（原理）

两层独立的保险：

1. **Orphan 分支隔离历史**：`main` 的根 commit 和 `private-main` 的任何 commit 都没有父子关系。`git push public main` 只传从 `main` tip 可达的对象，私有 commit 物理上不会进入传输包
2. **Refspec 白名单**：`remote.public.push = refs/heads/main:refs/heads/main` 限制 `git push public`（无参数）只推 `main`。团队成员手滑跑 `git push public` 时，其他私有分支不会被带出去

两层独立生效。即使用户显式跑 `git push public private-main:hack`，GitHub 侧 branch protection 还能作为第三层拦截。

## 本 skill 执行时的行为准则

Codex 调用本 skill 时：

1. **只有用户明确要求时才 commit / push**——用户说"提交"、"发布"、"commit 一下"、"推到 GitHub" 才做。用户没提及时**绝不**静默 commit 或 push，哪怕你觉得"一把梭更省事"
2. **commit 之前强制展示 diff**——执行 `git commit` 前先跑 `git status --short` + `git diff --staged --stat` 并**把输出贴给用户**，让用户能在 commit 之前看到"将要提交什么、提交到哪条分支、哪个 worktree"。如果 staged 内容和用户预期不符，停手让用户决定
3. **push 之前再展示一次 dry-run**——跑 `git push --dry-run <remote>`，确认会推哪些 ref、到哪个远端，把输出给用户
4. **rename 分支和创建 worktree 之前必须获得用户明确确认**——即使用户说"按流程走"，具体的分支名（当前主分支是不是真的叫 `main`？要不要改成 `private-main`？）和 worktree 目标路径也要再确认一次
5. **绝对不要**运行 `git push --all` / `git push --mirror`——这两个无视 refspec 白名单
6. **不修改 Gitea / GitHub 侧的仓库设置**——protected branch、webhook、CI 这些交给用户在 web UI 自己配

简要记忆：**commit/push 是用户触发 + Codex 执行 + 执行前展示内容让用户过目**。不是"永远让用户手动"，也不是"静默自动"。

## 针对不同起点的应对

- **项目已有 `main` + 一堆 commit，打算转这套流程**：走步骤 1 → 5 全流程，rename 现有分支
- **空目录 / 刚 init**：跳过步骤 1（没分支可 rename），从步骤 2 开始
- **已经有 origin 指向 GitHub（搞反了）**：先跟用户确认意图，然后 `git remote rename origin public` + `git remote add origin <gitea>`，再配 refspec
- **公开 worktree 目录已存在且非空**：停手，让用户处理——不能覆盖用户文件

## 概念速查

- **git worktree**：一个 Git 仓库可以挂多个工作目录，每个目录 check out 不同分支，`.git` 对象库共享
- **orphan 分支**：用 `git switch --orphan` 或 `git worktree add --orphan` 创建，首 commit 没有父节点，和其他分支完全独立
- **push refspec**：`<local>:<remote>` 格式的推送映射。`remote.<name>.push` 配置了 `git push <name>`（无参数）的默认 refspec；命令行显式指定会覆盖默认
