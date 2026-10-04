# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| A. Scanner + B. Workflow Core + C. REST API | `workflow-dashboard-backend` | 无 | D1, D2, D3, D4, D5, D7 | 低 | 可进入 x-req | 后端三模块合并为一个 task |
| D. Dashboard UI | `workflow-dashboard-frontend` | workflow-dashboard-backend | D6, D8 | 低 | 可进入 x-req | 依赖后端接口 |

## 开发顺序建议

```
workflow-dashboard-backend（P0）
├── Scanner（文件扫描 + 阶段推断 + spec↔task 关联）
├── Workflow Core（四对象模型 + 预置模板 + JSON 持久化）
└── REST API（8 个端点）
    ↓
workflow-dashboard-frontend（P0）
└── Dashboard UI（看板入口 + 树形列表 + 节点状态图）
```

## 拆分理由

- 后端三模块（Scanner / Core / API）紧密耦合，接口在同一个进程内，拆成三个 task 反而增加集成成本
- 前端独立一个 task：可以在后端接口就绪后并行开发（用 mock 数据先行），也可以串行等后端完成
- 两个 task 总量适中，预计各 1-2 天
