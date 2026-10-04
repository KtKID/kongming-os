---
name: publish
description: 将私有项目的最新改动同步到公开 worktree（kongming-agent-public）并提交。当用户说"同步"、"同步过去"、"同步到public"、"发布"、"publish"、"推到GitHub"、"推到公开"时立即使用此 skill。整个流程分三步：rsync 同步 → 用户确认 commit message → 可选 push。
---

## 前提

- 私有项目根：`/Volumes/machub_app/proj/kongming-agent`
- 公开 worktree：`/Volumes/machub_app/proj/kongming-agent-public`（`main` 分支）
- 发布脚本：`bin/publish.sh`（rsync 白名单同步，排除 `__pycache__` 等产物）

---

## 流程

### 第一步：运行同步脚本

在项目根执行：

```bash
bash bin/publish.sh
```

脚本会把白名单文件 rsync 到公开 worktree，并在末尾打印公开侧的 `git status --short`。把完整输出展示给用户，让他确认同步了哪些文件。

### 第二步：等用户给 commit message，然后提交

用户提供 message 之前**不要自作主张提交**。收到 message 后：

1. 先展示将要提交的内容（让用户能核实）：
   ```bash
   git -C /Volumes/machub_app/proj/kongming-agent-public add -A
   git -C /Volumes/machub_app/proj/kongming-agent-public status --short
   ```

2. 用户确认后再执行提交：
   ```bash
   git -C /Volumes/machub_app/proj/kongming-agent-public commit -m "<用户提供的 message>

   Co-Authored-By: Codex Sonnet 4.6 <noreply@anthropic.com>"
   ```

### 第三步：可选 push

用户说"push"或"推上去"时：

1. 先跑 dry-run 让用户看清楚推什么：
   ```bash
   git -C /Volumes/machub_app/proj/kongming-agent-public push --dry-run public
   ```

2. 用户确认后再真正推：
   ```bash
   git -C /Volumes/machub_app/proj/kongming-agent-public push public
   ```

---

## 安全原则

- **commit 和 push 都必须由用户明确触发**——用户没说"提交"或"push"时，只做同步，不动 git
- **每次 mutation 前都要展示将要做什么**，让用户有机会叫停
- 绝对不要用 `git push --all` 或 `git push --mirror`
