---
description: 保存与查看核心任务对已确认技术设计及 KMH 开发规范的技术验收。
---

# 访问记录核心功能 · 技术验收

2026-10-23 验收范围为 task-access-records-core，即 feat01 保存和 feat02 本机查看。用户回复“同意，走 req dev verify”确认本版方案。设计主定义及确认时内容见 [baselines](task-access-records-core/baselines/README.md)，当前设计补充交付链接及探针退役状态，行为与 13 条用例主定义保持一致。

代码基线为提交前 HEAD `aa46100d7086f72bb1a80c17423b36e343a91d78` 加最终暂存内容；产品、测试和配置逐文件散列见 [source-manifest.json](task-access-records-core/evidence/source-manifest.json)。DSH 提交为 `be34e35b39ae32b6e7e6f202e82acc4266ef190e`，受版本管理文件及指针保持原值。适用规范为根 AGENTS.md、x-tech-design 开发规范 R1—R7，以及 KMH 文档、文字、UI、CI 测试与交付检查规范。

**范围内技术符合性通过**：适用 10 项通过，失败 0，未验证 0；跨语言协议 1 项不适用。全仓测试状态单列于末尾。

## 适用项证据

| 设计 / 规范                            | 实现与实际验收                                                                                                                                                                                                                          | 结果 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 取得一次密码终态；R7                   | `proxy.mjs/beginAttempt` 在提交进入时捕获来源，首个终态交付一次；表单、URL 与握手路径连接同一回调。SAVE-01/02/03 使用真实代理与文件，含请求中断后第二终态及自动凭据路径                                                                 | 通过 |
| 共享记录约定；R2                       | `shared/access-records.ts` 为字段及边界的唯一 schema 来源，类型从 schema 推导；save 输入、文件读回、Query 输入和客户端返回值实际校验。SAVE-04/07、VIEW-03/04/05 覆盖非法字段、游标和损坏数据                                            | 通过 |
| 文件模块及生命周期；R4/R7              | `access-records.ts` 独占串行写入链；共用初始化，真实 .log 为持久来源，目录与末序号在启动重建，成功写入后维护读取位置；close 等待已接纳任务。Host 卸载先收回代理，再关闭记录器。SAVE-02/05/08、VIEW-03 实测并发、重建、故障与恢复        | 通过 |
| 写前容量和命名；R6                     | `MAX_FILE_BYTES`、`PAGE_SIZE`、`RECORD_VERSION` 集中定义；实际 JSON UTF-8 编码加换行计量，wx 独占创建，短写继续。SAVE-06/07 真实测量 T−1/T/T+1、恰等 T、单条 T+1，检查同日及跨日并发名称、字节和后续恢复                                | 通过 |
| 本机查询边界；R7                       | Proxy 在转发前识别保留路径，HTTP POST 以原 RPC 信封明确拒绝；Host 根据原始 TCP loopback 与 `requestRejection(req)` 构造可信上下文，旧 RPC 缺上下文拒绝。VIEW-05 验证编码/信封/HTTP/WS，受限请求查询调用为零；浏览器实际显示本机限制原文 | 通过 |
| 稳定分页及取消；R4/R7                  | `list` 使用实例、截止序号、文件名及偏移游标，文件位置通过白名单与边界校验；正文按块倒读，读取句柄在 finally 关闭。VIEW-03 使用 1/10/11/20/21 条和 21 个跨日文件，实测追加后的旧页、刷新、取消与迟到响应                                 | 通过 |
| 详情状态与错误；R7、UI 规范            | `RemotePluginPanel` 复用公开 SegmentedTabs/Button，设置保持挂载；取消旧请求，错误保留原文及旧页。VIEW-01—04 运行真实组件；浏览器核对插槽、草稿、内部滚动、浅深主题及保存/读取同时故障、恢复提示                                         | 通过 |
| 模块归属与命名；R1/R5                  | 代码审查追踪 shared → store/panel，入口连接 proxy → service → records 与 web-rpc；跨包使用公开包名，既有 pocket 方法保持名称。三个新增生产模块依赖单向；修改范围限 KMH 自有包，原探针已移除运行接线。此项为源码语义审查                 | 通过 |
| 严格类型、构建与测试隔离；KMH 附加规范 | 本轮实际重跑 build、typecheck、lint、format:check，退出均为 0；专项 13/13、跳过 0。临时 Home、随机监听端口和显式屏障隔离资源，afterEach 收回连接、存储和目录；时区使用独立子进程                                                        | 通过 |
| 四项覆盖率与证据                       | V8 原始计数与开发前快照、固定 Git 基线共同计算新增接线范围，门槛脚本实际退出 0。行 353/353、语句 408/408、函数 56/56、分支 214/214；新增三个模块全量计入。原始计数、全文件 summary 与 scope 清单一并保留                                | 通过 |

开发验收在仓库根重跑 `pnpm --filter @kmh/remote test:records:coverage`、build、typecheck、lint、format:check。提交前使用最终暂存副本复验，执行目录为 `packages/kmh-remote`，环境为 Node 25.6.1、pnpm 11.7.0；复用既有依赖，通过 Node 直接运行各工具入口，实际命令见 [execution.json](task-access-records-core/evidence/execution.json)。输出见 [verify-records-coverage.log](task-access-records-core/evidence/verify-records-coverage.log)、[verify-typecheck.log](task-access-records-core/evidence/verify-typecheck.log)、[verify-lint.log](task-access-records-core/evidence/verify-lint.log)及 [format-check.log](task-access-records-core/evidence/format-check.log)。验收复用现有测试，新增验收测试 0。

## 不适用项及范围限制

R3 跨语言协议：产品使用 JS/TS 同一份 Zod 约定，本任务具有单一协议来源，跨语言生成不适用。

本功能的 Remote 既有回归为 138/138，通过记录见 [dev-report](task-access-records-core/dev-report.md)。全仓 `pnpm test` 为 352 通过、23 失败、11 跳过；当前子模块缺构建产物、React 依赖以及依赖已构建 DSH 的启动路径使全仓验收保持未完成，详见同报告及其原始摘要。相同提交的既有构建产物仅用于隔离运行与依赖链接，当前子模块保持原值。实际 frp 外网可达性由部署环境验收，本轮通过测试 Host 验证公网分类和查询拒绝。
