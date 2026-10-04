# 验证策略与演进

## 单元测试

| 测试 | 覆盖 |
|------|------|
| `test_agent_role_manager_lists_empty_roles_with_create_hint` | 空角色库返回空列表和 `empty_message` |
| `test_create_agent_role_saves_json_and_returns_roster` | 创建角色、保存文件、返回 current_roundtable_agents |
| `test_create_role_existing_returns_existing_and_dedupes_roster` | 重复创建返回 existing 并去重 roster |
| `test_agent_role_manager_roster_is_session_scoped` | 不同 session 的 roster 互不串扰 |
| `test_agent_role_manager_rejects_invalid_role_id` | role id 为空、含路径分隔符或超长时失败 |
| `test_agent_role_manager_rejects_invalid_text` | title/role 为空或超长时失败 |
| `test_agent_role_manager_skips_corrupt_role_file` | 损坏 JSON 被跳过，可读角色继续返回 |
| `test_write_workflow_snapshot` | manager 写入 workflow roles.json |
| `test_create_agent_role_tool_saves_and_returns_roster` | tool 调用 manager 并原样返回 manager result |
| `test_create_agent_role_tool_rejects_non_string_fields` | tool 不把非字符串参数改写成字符串 |
| `test_roundtable_review_strategy_writes_review_board` | roundtable 从 `participants.select` 解析内置 code review 角色并写 `roles.json` |
| `test_runner_fake_llm_creates_role_then_runs_roundtable` | Runner 级 fake LLM 按 `list -> create -> run_agent_workflow` 调用真实 tool 链路 |
| `test_roundtable_review_rejects_invalid_participants` | `reviewers`、`participants.create`、`participants.preset`、unknown key、empty select、unknown role 全部返回参数错误 |
| `test_run_exposes_workflow_and_role_tools_to_cli_llm` | CLI enabled tools 包含 workflow + role tools，并共享同一个 role manager |
| `test_agent_role_tools_are_silent_allowed` | 默认 `config/setting.yaml` 下 list/create 角色工具命中 silent allow |
| `test_tools_template_mentions_workflow_tools` | TOOLS 模板提示 list/create/participants.select |
| `test_minimax_parent_creates_agent_role_and_runs_roundtable` | 真实 MiniMax M3 父 LLM 调用 list/create/run_agent_workflow 并写 roles.json |
| `test_minimax_parent_runs_real_us_iran_roundtable_and_writes_child_logs` | 真实 MiniMax M3 父 LLM 创建两个局势分析角色，真实启动 2 个 reviewer + arbiter，断言 child session JSONL 全部存在且 final_report 无 fallback |

## 集成测试

`test_runner_fake_llm_creates_role_then_runs_roundtable` 覆盖 fake LLM 链路：

1. LLM 第一次调用 `list_agent_roles`。
2. 工具返回空角色库。
3. LLM 调用 `create_agent_role` 创建角色。
4. 工具返回 updated roster。
5. LLM 调用 `run_agent_workflow(mode="roundtable_review")`，payload 使用 `participants.select`。
6. fake `SubAgentManager` 执行动态角色任务，workflow 写入 `roles.json`。

## 验证命令

```bash
uv run pytest tests/unit/test_agent_workflow_manager.py tests/unit/test_agent_workflow_strategy_manager.py tests/unit/test_agent_workflow_map_reduce.py tests/unit/test_agent_workflow_roundtable_review.py tests/unit/test_agent_role_manager.py tests/unit/test_agent_role_tool.py tests/unit/test_safety_chain.py tests/unit/test_safety_grant_store.py tests/unit/test_safety_trust_resolver.py tests/unit/safety/test_schedule_consent_capability.py tests/unit/test_prompts_loader.py tests/unit/test_cli_main.py -q
uv run ruff check src/application/agent_roles src/tools/agent_role_tool.py src/application/agent_workflows/manager.py src/application/agent_workflows/strategies/roundtable_review src/tools/agent_workflow_tool.py src/hosts/cli/main.py src/safety/approval/default_rules.py src/safety/guards/trust.py tests/unit/test_agent_role_manager.py tests/unit/test_agent_role_tool.py tests/unit/test_agent_workflow_manager.py tests/unit/test_agent_workflow_strategy_manager.py tests/unit/test_agent_workflow_map_reduce.py tests/unit/test_agent_workflow_roundtable_review.py tests/unit/test_safety_chain.py tests/unit/test_safety_grant_store.py tests/unit/test_safety_trust_resolver.py tests/unit/safety/test_schedule_consent_capability.py tests/unit/test_prompts_loader.py tests/unit/test_cli_main.py
KONGMING_E2E_REAL_MODEL=1 uv run pytest tests/e2e/test_agent_role_roundtable_live.py -q -s
KONGMING_E2E_REAL_MODEL=1 uv run pytest tests/e2e/test_agent_role_roundtable_live.py -q -s -k us_iran
KONGMING_E2E_REAL_MODEL=1 uv run pytest tests/e2e/test_agent_role_roundtable_live.py -q -s -k creates_agent_role
```

## 风险

| 风险 | 控制 |
|------|------|
| 主 agent 创建过多一次性角色 | `AgentRoleManager` 每次创建返回 session roster，让模型能看到已加入列表 |
| 角色描述太长污染 prompt | `role` 字段限制长度，LLM 可见列表只含三字段 |
| 长期角色库被低质量角色污染 | 后续补 role review / archive，本版先保留手动文件可编辑 |
| roundtable 仍偏代码 review | code review preset 迁出，participants.select 成为唯一显式入口 |
| 无审批写入有风险 | 工具路径固定为 `.kongming/agent_roles/`，不接收任意 path |

## 演进

1. 角色版本：`id@v2` 或 role JSON 增加 `version`。
2. 角色标签：增加 `tags` 辅助主 agent 选择。
3. 角色评分：根据 workflow 结果给角色打分。
4. Web 管理：展示、编辑、归档角色。
5. 多编排复用：map_reduce mapper、debate、pipeline 都引用 `AgentRolePreset`。
