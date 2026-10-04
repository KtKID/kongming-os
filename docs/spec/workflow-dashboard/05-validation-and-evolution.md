# 验证策略与演进

## 验证策略

### 单元测试

- **覆盖模块**：Scanner、Workflow Core（Store CRUD）
- **框架**：pytest（后端）、vitest（前端）
- **重点场景**：
  - Scanner：目录不存在 / 空目录 / 只有 spec 无 task / 只有 task 无 spec / README 无 spec 引用
  - Scanner：各阶段产物文件存在/不存在的组合
  - Workflow Core：预置模板加载 / run 创建 / 节点状态更新 / event 追加
  - Workflow Core：JSON 持久化原子写入 / schema_version 校验 / 空文件 bootstrap
  - 前端 Store：轮询数据合并 / 空状态展示

### 集成测试

- **端到端链路**：
  1. 准备 mock 的 `docs/` + `dev-pipeline/tasks/` 目录结构
  2. 启动 Scanner → 触发一次扫描
  3. 通过 REST API 查询扫描结果
  4. 创建 WorkflowRun 绑定 task
  5. 再次扫描 → 验证节点状态更新
  6. 查询 events → 验证状态变更日志
- **环境要求**：临时目录（`tmp_path`），不需要真实 LLM 服务
- **触发方式**：`make test-unit`（Scanner 测试归入 unit）；REST API 测试走 `TestClient`

### 手动验证

- **必须人工过的场景**：
  - 看板 UI 布局和交互体验
  - 节点状态颜色是否清晰可辨
  - spec → task 树形展开/折叠
  - 多 task 并列展示的可读性
- **验收人**：用户本人
- **工具**：Playwright MCP 浏览器验证

## 测试覆盖要求

| 模块 | 最低覆盖率 | 重点文件 |
|------|-----------|---------|
| Scanner | 80% | scanner.py |
| Workflow Core (Store) | 80% | store.py |
| REST API | 70% | router 集成测试 |
| Dashboard UI | 手动验证 | WorkflowDashboard.tsx |

## 演进路线

### 短期（v1 本轮）

- [x] 文件产物扫描 + 阶段推断
- [x] 四对象模型 + 预置模板
- [x] REST API + 看板只读展示
- [x] 可配扫描间隔

### 中期（v2）

- [ ] 拖拽式工作流编辑器（自定义节点连线）
- [ ] port 类型校验（artifactType 匹配）
- [ ] verify / qa-gate 报告 pass/fail 解析
- [ ] "进行中"状态检测（通过 session 事件或心跳）
- [ ] WebSocket 实时推送节点状态变更
- [ ] 节点详情面板（点击节点查看产物文件内容摘要）

### 长期（v3 方向性）

- Web 驱动 skill 执行（点击节点启动对应 skill）
- 自动流转引擎（节点完成自动触发下一节点）
- 跨项目工作流聚合（多个项目的 task 汇总到一个看板）
- 工作流模板市场（导入/导出/分享模板）
