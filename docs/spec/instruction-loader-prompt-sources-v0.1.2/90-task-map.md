# Task Map

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|------|--------------|----------------|----------|----------|
| Instruction Source Collection | `prompt-source-loader-contracts` | 是 | 无 | 方案确认 |
| Prompt Build Assembly | `prompt-build-assembler-wiring` | 是 | `prompt-source-loader-contracts` | 方案确认 |
| Runtime Wiring | `prompt-runtime-build-flow` | 否 | `prompt-build-assembler-wiring` | 探索中 |
| Validation And Observability | `prompt-build-test-matrix` | 是 | `prompt-source-loader-contracts` | 可进入 x-req |
