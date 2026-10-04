# scheduler-task-lifecycle · Gate② R4

> review: independent Q1/Q2/Q3
> result: PASS
> RAG: skipped by user

## Gate

- P0：0
- P1：0
- P2：1，已同步修正文档注释

## 复核结论

- Q1 PASS：`NormalizedMessage.frame_type` 为必填判别字段，Python/TS 的
  `reason`、`durationMs`、requiredness 和 nullability 对齐。
- Q2 PASS：terminal 只移除本地已知 run ID；REST 刷新投影决定最终 idle，
  遗漏 sibling started 的前端仍保持 running。
- Q3 PASS：缺失/非法 discriminant、部分已知 live 集合、真实 REST/浏览器和
  one-shot ExecutionBridge 反例均已覆盖。

## 证据

- Python scheduler REST protocol：`113 passed`。
- scheduler frontend store/realtime/api：`18 passed`。
- Ruff 与 mypy：通过。
- 真实 Playwright scheduler lifecycle：`1 passed`。
