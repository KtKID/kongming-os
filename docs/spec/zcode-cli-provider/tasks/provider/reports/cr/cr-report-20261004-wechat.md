# ZCode 扫码登录调查

> Schema: x-cr-v2
> Mode: known-issue
> Scope: task
> Review 日期：2026-10-04

## 调查对象

用户微信扫码返回 404。期望为使用惯常的微信账号授权并接入本机官方 CLI。归属 spec 为 `docs/spec/zcode-cli-provider/spec.md`，定位来自同目录 task 的 dev-checklist。实际 Web 链接将 `state` 和 `response_type` 放入 callback 路径。

## 模块模型与审查范围

| 层级 | 对象 | 输入与信任属性 | guard / 状态所有者 | 副作用 / 下游 | 证据 |
|---|---|---|---|---|---|
| 主模块 | runtime.runLogin | CLI stderr，进程输入 | attempt ID、域名检查 | 状态 authorizeUrl | runtime.ts 的 URL 正则 |
| 契约邻居 | 官方 login | 官方 OAuth URL | 官方初始化、轮询 | 官方凭据 | 本机 0.16.9 打包源码 |
| 状态/权限所有者 | runtime、connection | 浏览器请求 | 本地认证、取消 ID | 进程与账号文件 | web.ts、runtime.ts |
| 入口适配层 | browser | 后端状态 | URL origin | QR 与链接 | browser.ts |
| 证据 | fixture | 假授权 URL | 隔离目录 | 行为测试 | zcode-cli.test.mjs |

## 不变量覆盖

| INV-ID | 来源类型 | 不变量 | 来源 / 依据 | 本次触达路径 | 最小反例 | 结论 | 关联问题 |
|---|---|---|---|---|---|---|---|
| INV-SPEC-01 | spec 声明 | 二维码承载完整官方授权链接 | feat02 场景1 | CLI stderr → URL → QR | 完整 chat.z.ai URL 内嵌 zcode callback | 破坏 | B1 |
| INV-SPEC-02 | spec 声明 | 取消后旧尝试保持终态，凭据受保护 | feat02 场景2、4 | controller → process → status | 取消后迟到输出 | 保持 | - |
| INV-SPEC-03 | spec 声明 | 真人授权由用户完成 | feat02 场景5 | 自动初始化 → 人工交接 | 尚未授权的官方页面 | 保持 | - |
| INV-CAND-01 | 补充候选 | 登录渠道与用户现有微信账号一致 | 本轮用户明确说明 | providerId → CLI login | 微信账号配合固定 Z.ai provider | 破坏 | B2 |

### 补充候选与 spec 关系

| INV-ID | 关系 | 证据 | 后续 |
|---|---|---|---|
| INV-CAND-01 | spec 缺口 | 既有 spec 固定“登录 Z.ai”；用户明确微信账号 | 更新 BigModel 微信场景与账号桥接 |

## 贝叶斯根因调查

| H | 关联 INV-ID | 先验 | 证据 E | 影响 | 更新后置信度 | 下一步 |
|---|---|---|---|---|---|---|
| H1: 错误提取内嵌 callback | INV-SPEC-01 | 中 | 实际 href 缺少 query，正则匹配 zcode 域名子串；官方 CLI probe 返回 chat.z.ai 完整 URL | 支持 | 已确认 | 按完整输出行提取 |
| H2: 官方服务整体故障 | INV-SPEC-01 | 中 | 原生 CLI 初始化成功；BigModel 初始化 HTTP 200、code 0 | 削弱 | 低 | 使用完整官方入口 |
| H3: 渠道选择错误 | INV-CAND-01 | 中 | 本机登录代码固定 provider zai，国内官方入口为 bigmodel.cn/login | 支持 | 已确认 | 使用官方 BigModel OAuth 初始化和轮询 |

## 审查结论

### P0：阻断性正确性错误

无。

### P1：生产正确性风险

| ID | 状态 | 来源 | INV-ID | 检查项 | 文件:位置 | 置信度 | 根因分类 | 描述 |
|---|---|---|---|---|---|---|---|---|
| B1 | ✅已修复 | 用户与代码 | INV-SPEC-01 | 完整授权 URL | runtime.ts:receive | 已确认 | 实现过程偏移 | 正则从内嵌 redirect_uri 提取 callback，QR 指向错误路径 |
| B2 | ✅已修复 | 用户与官方源码 | INV-CAND-01 | 微信账号渠道 | config.ts:providerId | 已确认 | spec 缺口 | 固定 Z.ai 登录与用户国内微信账号的入口存在差异 |

### P2：正确性证据或契约缺口

| ID | 状态 | 来源 | INV-ID | 检查项 | 文件:位置 | 置信度 | 根因分类 | 描述 |
|---|---|---|---|---|---|---|---|---|
| B3 | ⚠️ | 运行验收 | INV-SPEC-03 | 真实授权和模型调用 | dev-checklist:T5 | 已确认 | 证据不足 | 用户完成真人授权后验收模型工具往返 |

## 问题详情

### B1: 二维码链接被截断

**严重程度**： P1

**置信度**: 已确认

**关联不变量**: INV-SPEC-01

**根因分类**: 实现过程偏移

实际输出为完整 `https://chat.z.ai/api/oauth/authorize?...redirect_uri=https://zcode.z.ai/api/v1/oauth/cli/callback/zai&state=...`。正则固定查找 zcode.z.ai 子串，返回 callback 及后续 query 内容；URL 构造器把这些内容视为路径，浏览器与 QR 共同传播错误。调用方域名检查保留了这一错误；fixture 使用顶层 zcode.z.ai 简单 URL，覆盖缺口已确认。最短反例为在分片 stderr 中写入包含 redirect_uri 的完整官方 URL，并独立断言最终 URL 相等。

### B2: 微信账号使用 BigModel 官方入口

**严重程度**： P1

**置信度**: 已确认

**关联不变量**: INV-CAND-01

**根因分类**: spec 缺口

本机 0.16.9 login 固定初始化 `{provider:'zai'}`；官方公开源码支持 BigModel 初始化与轮询，国内官方 OAuth 配置为 bigmodel.cn/login。直接初始化官方 `{provider:'bigmodel'}` 返回 HTTP 200、code 0 及完整国内授权地址。修复由 KMH 账号桥接调用此官方授权协议，CLI 继续承载模型通信；取消、原有 Z.ai 账号和日志凭据隔离继续维持。

### B3: 真人授权验收待用户完成

**严重程度**： P2

**置信度**: 已确认

**关联不变量**: INV-SPEC-03

**根因分类**: 证据不足

目前证据覆盖初始化和已有离线工具循环。真实微信授权、账号权益、模型请求和 read 往返等待用户授权后的验收。

## 覆盖声明

本次已检查登录、取消、凭据、网页展示、官方账号协议、相关 spec 和测试。模型生成与既有启动默认行为由原有测试覆盖；本次授权验收缺口登记为 B3。调查根因已确认。

## 修复备注

| ID | INV-ID | 严重程度 | 处置结果 | 修复方式 | 反例 / 验证 |
|---|---|---|---|---|---|
| B1 | INV-SPEC-01 | P1 | ✅已修复 | 按完整 URL 输出行解析，前后端共用官方 origin 校验，拒绝顶层 callback；错误输出产生受控失败 | 完整内嵌 redirect_uri、分片行、非法 origin 的测试通过 |
| B2 | INV-CAND-01 | P1 | ✅已修复 | KMH BigModel 账号桥接与专用 profile 选择国内账号；官方 CLI 保留模型通道 | 加密存储、取消重试、官方本地注册与 logout；Chrome 真实微信登录区域 |
| B3 | INV-SPEC-03 | P2 | 等待用户授权 | 真人登录后验收模型与 read 往返 | 页面保留在微信快捷登录步骤 |

`pnpm test` 39/39、插件 Host/Browser typecheck、`pnpm lint`、format:check、两个专用 profile dump-config 通过。原有 Z.ai 账号用例保留原样，新增国内账号 fixture 使用独立临时目录。
