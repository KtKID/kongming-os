# Fix Report — web-thread-state-authority — 20260729 R2

## 修复对象

Gate① 第二次复跑的 Scenario 覆盖对账失败。

## 根因

dev-report 的三个 verify block 在单个 `scenario:` 字段中填写了逗号分隔的多个
ID。req 合同要求一块精确回指一个 Scenario，verify 因此把 13 个场景全部列为
uncovered；三个命令自身均已通过。

## 修复

将证据拆为 13 个独立 verify block，每块绑定一个 Scenario ID。unit/smoke 使用
聚焦 pytest/Vitest，SC_05、SC_24、SC_25 使用 Playwright grep 跑对应真实
双浏览器链路。

## 验证

复跑完整 `xdev.py verify ... --json`，预期 `pass 13`、`fail 0`、
`uncovered 0`。
