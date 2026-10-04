完整分层
API telemetry 分类：classifyAPIError()
位置：[src/services/api/errors.ts (line 965)](/Volumes/machub_app/proj/kongming-agent/other/claude-code-main/src/services/api/errors.ts:965)
返回值：
aborted、api_timeout、repeated_529、capacity_off_switch、rate_limit、server_overload、prompt_too_long、pdf_too_large、pdf_password_protected、image_too_large、tool_use_mismatch、unexpected_tool_result、duplicate_tool_use_id、invalid_model、credit_balance_low、invalid_api_key、token_revoked、oauth_org_not_allowed、auth_error、bedrock_model_access、server_error、client_error、ssl_cert_error、connection_error、unknown。
Assistant/API error enum：SDKAssistantMessageError
位置：[src/entrypoints/sdk/coreSchemas.ts (line 1256)](/Volumes/machub_app/proj/kongming-agent/other/claude-code-main/src/entrypoints/sdk/coreSchemas.ts:1256)
返回值：
authentication_failed、billing_error、rate_limit、invalid_request、server_error、unknown、max_output_tokens。
Query loop 内部终止 reason
位置：实际 return { reason: ... } 在 [src/query.ts (line 646)](/Volumes/machub_app/proj/kongming-agent/other/claude-code-main/src/query.ts:646)
当前可确认：
blocking_limit、image_error、model_error、aborted_streaming、prompt_too_long、completed、stop_hook_prevented、aborted_tools、hook_stopped、max_turns。
SDK 最终 result error subtype
位置：[src/entrypoints/sdk/coreSchemas.ts (line 1428)](/Volumes/machub_app/proj/kongming-agent/other/claude-code-main/src/entrypoints/sdk/coreSchemas.ts:1428)
返回值：
error_during_execution、error_max_turns、error_max_budget_usd、error_max_structured_output_retries。
你提到的两个点
turn 到达次数：query.ts 初始化 turnCount = 1，每轮工具结果回灌前计算 nextTurnCount = turnCount + 1。超过 maxTurns 时产出 max_turns_reached attachment，并返回 reason: 'max_turns'。QueryEngine.ts 接到这个 attachment 后输出 SDK result：subtype: 'error_max_turns'、num_turns、errors: ["Reached maximum number of turns (...)"]。见 [src/query.ts (line 1678)](/Volumes/machub_app/proj/kongming-agent/other/claude-code-main/src/query.ts:1678) 和 [src/QueryEngine.ts (line 841)](/Volumes/machub_app/proj/kongming-agent/other/claude-code-main/src/QueryEngine.ts:841)。
用户打断：前端/提交路径调用 abortController.abort('interrupt')，例如 [src/utils/handlePromptSubmit.ts (line 319)](/Volumes/machub_app/proj/kongming-agent/other/claude-code-main/src/utils/handlePromptSubmit.ts:319)。streaming 阶段打断返回 aborted_streaming，tool 阶段打断返回 aborted_tools，同时可能插入 [Request interrupted by user] 或 [Request interrupted by user for tool use]。见 [src/query.ts (line 1015)](/Volumes/machub_app/proj/kongming-agent/other/claude-code-main/src/query.ts:1015)、[src/query.ts (line 1484)](/Volumes/machub_app/proj/kongming-agent/other/claude-code-main/src/query.ts:1484)、[src/utils/messages.ts (line 207)](/Volumes/machub_app/proj/kongming-agent/other/claude-code-main/src/utils/messages.ts:207)。
局部分类器
还有这些局部分类器：
classifyToolError()：Error:ENOENT 这类 errno、稳定 error.name、Error、UnknownError。
classifyAxiosError()：auth、timeout、network、http、other。
classifyFetchError()：dns_or_refused、timeout、conn_reset、auth、not_found、tls、invalid_schema、other。
classifyGcsError()：timeout、http_<status>、network、fs_<code>、fs_other、zip_parse、empty_latest、other。
classifyPluginCommandError()：network、not-found、permission、validation、unknown。
classifyImageError()：数字类型 1-8，对应 module load、processing、unknown、pixel limit、memory、timeout、vips、permission。
推荐按这四张表理解：API 分类看故障归因，Assistant enum 看对话错误，query reason 看 agent loop 结束原因，result subtype 看 SDK/CLI 最终状态。