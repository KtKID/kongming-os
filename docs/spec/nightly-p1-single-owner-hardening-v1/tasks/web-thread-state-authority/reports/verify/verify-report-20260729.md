# Verify Report — web-thread-state-authority — 20260729

## Gate① 结果

- pass：2 个 auto block。
- fail：1 个 auto block（`SC24-SC25-browser-e2e`）。
- uncovered：由失败块连带标记；后端和前端块自身均已通过。

## 完整失败清单

### SC24-SC25-browser-e2e

- 命令：`pnpm exec playwright test --config=playwright.thread-state-authority.config.ts`
- 结果：`1 passed, 1 failed`
- 失败位置：`web/tests/e2e/thread-state-authority.spec.ts:111`
- 事实：双浏览器审批用例中，一个 `locator.click()` 等待 Framer Motion
  240ms 入场动画稳定；另一浏览器已完成点击并收到 authoritative remove，前一个
  locator 随后从 DOM 移除并等待到 30s 超时。
- 分诊：测试同步问题。服务端只接受一次并广播 remove 的生产链已完成；E2E 需要先
  等待两端卡片动画稳定，再同时触发两个决议。

## x-fix 输入

在双浏览器卡片均可见后增加显式动画稳定同步点，保持两个点击并发执行，聚焦复跑
`SC24-SC25-browser-e2e`，通过后复跑完整 Gate①。

## R1 后复跑

三个命令块均执行成功，Gate 仍返回 uncovered 13。原因是 req 合同要求每个
`scenario:` 只填写一个 Scenario ID；原报告把多个 ID 以逗号写在同一个字段，
verify 将整串视为一个未知 ID。

处理：按 SC_01—SC_09、SC_23—SC_25、SC_27 拆成 13 个独立 verify block，每块
使用聚焦命令精确回指一个 Scenario。

## 最终复跑

- 命令：
  `uv run python /Volumes/machub_app/proj/x-dev-pipeline/tools/xdev.py verify docs/spec/nightly-p1-single-owner-hardening-v1/tasks/web-thread-state-authority --json`
- 结果：PASS。
- pass：13。
- fail：0。
- uncovered：0。
- manual：0。

最终 Gate① 已覆盖 `SC_01`—`SC_09`、`SC_23`—`SC_25`、`SC_27`，前述失败和
报告格式问题均已关闭。

## Gate② 修复后复跑

独立 QA 登记六个 P1 后完成 x-fix R3，并再次执行完整 Gate①：

- pass：13。
- fail：0。
- uncovered：0。
- manual：0。

补充分层证据：后端聚焦回归 149 passed；Composer/图片/SlashMenu 完整草稿合同
69 passed；TypeScript typecheck、协议漂移检查、Ruff、mypy 全部通过。
