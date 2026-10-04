# XSpace Android 远程扫码配对

> 状态：方案确认
> 目标：Kongming Web 生成手机配对二维码，XSpace Android 扫码后获得远程实例凭据并打开已登录 WebView。

## 系统目标

Kongming 侧承接 XSpace Android 远程配对合同，把配对会话、桌面授权、移动设备凭据、Web session handoff 和设备吊销收口到 Kongming Web/Server。XSpace Android 保持轻客户端职责：扫码、claim、轮询、保存实例、打开 handoff URL。桌面 XSpace 保持当前 packaged Kongming 启动路径，并增加打开当前实例手机配对页的入口。

## 最小可用路径

用户在 Kongming Web 打开 `/-/xspace/mobile/connect` → Kongming 创建配对会话并展示二维码 → XSpace Android 扫码 claim → Web 页面展示待授权设备 → 用户批准 → Android exchange 获得 `device_token` 和 `web_session_url` → Android 打开 WebView 完成登录。

## 范围边界

**包含**：
- Kongming Web 生成二维码 payload 和复制链接。
- Kongming Server 管理 pairing session、claim、approve、exchange、device token、handoff token。
- Kongming Web 页面展示二维码、过期倒计时、待授权设备、批准/拒绝动作。
- 设备列表和吊销 API。
- 与 XSpace Android 合同一致的 DTO、错误码和 P0 验收 fixture。

**范围外**：
- XSpace Android 相机扫码 UI 的具体实现。
- XSpace Android secure store 的平台实现。
- push 通知能力。
- 多用户账号体系和组织级设备管理。
- macOS / Windows packaged Kongming 启动链路改造。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| MobilePairingManager | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1mobilepairingmanager) | 是 | 后端唯一业务门户，编排 session、claim、approve、exchange |
| MobilePairingRepository | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2mobilepairingrepository) | 是 | 持久化 pairing、claim、device、token、handoff |
| MobileDeviceTokenService | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3mobiledevicetokenservice) | 是 | 生成 device token 与一次性 handoff token |
| MobilePairingRouter | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4mobilepairingrouter) | 是 | FastAPI REST 和错误码翻译 |
| MobilePairingWebPage | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-5mobilepairingwebpage) | 是 | React 页面、QR 渲染、待授权设备操作 |
| MobilePairingAuditSink | 探索中 | [模块拆分](./02-module-breakdown.md#模块-6mobilepairingauditsink) | 否 | 审计日志 P1，可随 P0 留事件钩子 |

## 文档导航

- [图集：总览 + 各模块局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 先把后端 `MobilePairingManager` + Repository + Token/Handoff 做成第一组 x-req。
2. 第二组 x-req 接 REST router、错误码、鉴权和合同测试。
3. 第三组 x-req 接 Web 页面、QR 渲染、页面轮询或全局 inbox fan-out。
4. 设备 token 形态和持久化介质在进入 x-req 前定稿，建议 P0 用 opaque 随机 token + hash 落盘。
