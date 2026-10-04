# Fix Report — web-thread-state-authority — 20260729 R1

## 修复对象

Gate① `SC24-SC25-browser-e2e` 的双浏览器点击时序抖动。

## 根因

`ApprovalToastQueue` 使用 240ms Framer Motion 入场动画。Playwright 普通
`locator.click()` 会等待元素稳定；两个浏览器同时点击时，一端先提交并触发服务端
authoritative remove，另一端仍在等待动画稳定，随后 locator 被移除并超时。

## 修复

两端卡片均可见后等待 300ms，让入场动画完成，再通过同一个 `Promise.all` 同时点击。
服务端仲裁、remove 广播和前端 reducer 保持真实实现，测试仍断言两次 resolve 尝试、
一次 accepted 和 pending 清零。

## 聚焦验证

`pnpm exec playwright test --config=playwright.thread-state-authority.config.ts`

预期：`2 passed`。
