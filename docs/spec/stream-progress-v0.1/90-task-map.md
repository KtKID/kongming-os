# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| Normalizer 扩展 | `stream-progress` | 无 | DoD#1~#5, #7 | 低 | 可进入 x-req | 后端核心改动 |
| WS 协议扩展 | `stream-progress` | 无 | DoD#5, #6 | 低 | 可进入 x-req | 与 Normalizer 同步改 |
| 前端状态渲染 | `stream-progress` | WS 协议 | DoD#2~#4 | 低 | 可进入 x-req | 前端消费层 |

## 建议

三个模块合并为 **一个 task** `stream-progress`：

1. 改动范围小（后端 ~40 行，前端一个新组件 + hook 修改）
2. 无技术风险（SDK 事件已有，只是之前丢弃）
3. 模块间耦合紧密（normalizer 产出 → 协议定义 → 前端消费）
4. 拆开反而增加协调成本

**开发顺序**（在同一 task 内）：

```
1. llm_protocol.py 加字段定义        ← 5 min
2. normalizer.py 扩展 _handle_stream ← 30 min
3. test_normalizer.py 补测试          ← 20 min
4. 前端 TS 类型 + hook + 组件        ← 1 hr
5. 手动验证                           ← 15 min
```

预计总工时：**2-3 小时**。
