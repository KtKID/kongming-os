import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
/** kmh-team 界面文案集中在本插件字典。 */
export const zh = {
  title: "团队会话",
  summary: "保存固定角色，按点名传递最近对话并展示完整回复。",
  owner: "主 Agent",
  model: "模型",
  chooseModel: "请选择可用模型",
  defaultModelUnavailable: "当前默认模型暂时不可用，请选择其他模型。",
  modelsUnavailable: "当前没有可用模型，请检查模型插件后重试。",
  modelUnavailable: "所选模型暂时不可用，请重新选择模型。",
  serviceUnavailable: "团队服务加载失败，请重启 KMH 后重试。",
  joined: "已加入",
  available: "可选角色",
  cancel: "取消",
  confirm: "确认",
  close: "关闭",
  name: "Agent 名称",
  instructions: "职责说明",
  createRole: "创建角色",
  save: "保存",
  pending: "待保存",
  saved: "已保存",
  contextCount: "传递上下文数量",
  countHint: "包含本次用户消息，默认最近 20 条。",
  working: "工作中",
  stop: "停止",
  stopping: "停止仍待确认",
  ended: "当前回应已经结束",
  retry: "重试",
  you: "用户",
  loading: "正在读取",
  error: "操作失败：{reason}",
  required: "请填写名称与职责说明。",
  invalidCount: "请输入大于零的整数。",
  taskEmpty: "请补充任务内容。",
  invalidMember: "请重新选择团队成员。",
  copy: "复制",
  copied: "已复制",
  footnotes: "脚注",
  roles: "固定角色",
  empty: "暂无角色，可以在插件详情页创建。",
  unavailable: "主 Agent 或模型暂时不可用。",
  choose: "选择加入或移除角色",
  readError: "读取失败，已有记录继续保留。",
  saveFailed: "保存失败，已填写内容继续保留，请重试。",
  settingsChanged: "配置已发生变更，已填写内容继续保留，点击重试保存。",
  createFailed: "创建失败，成员和模型选择继续保留，请检查后重试。",
  sendFailed: "发送失败，草稿继续保留，请重试。",
  memberFailed: "成员回应失败，请重新点名。",
  attachments: "本版本团队会话支持文字及正文成果链接。请先移除附件后发送。",
};
export type LocaleKey = keyof typeof zh;
export const en: Record<LocaleKey, string> = {
  title: "Team chat",
  summary:
    "Save reusable roles, mention members with recent conversation context and show full replies.",
  owner: "Main Agent",
  model: "Model",
  chooseModel: "Select an available model",
  defaultModelUnavailable:
    "The default model is temporarily unavailable. Select another model.",
  modelsUnavailable:
    "No models are available. Check the model plugins and retry.",
  modelUnavailable:
    "The selected model is temporarily unavailable. Select again.",
  serviceUnavailable: "Team services failed to load. Restart KMH and retry.",
  joined: "Joined",
  available: "Available roles",
  cancel: "Cancel",
  confirm: "Confirm",
  close: "Close",
  name: "Agent name",
  instructions: "Responsibilities",
  createRole: "Create role",
  save: "Save",
  pending: "Pending save",
  saved: "Saved",
  contextCount: "Context message count",
  countHint: "Includes this message; defaults to the latest 20.",
  working: "Working",
  stop: "Stop",
  stopping: "Waiting for stop confirmation",
  ended: "Current replies have ended",
  retry: "Retry",
  you: "You",
  loading: "Loading",
  error: "Operation failed: {reason}",
  required: "Enter a name and responsibilities.",
  invalidCount: "Enter a positive integer.",
  taskEmpty: "Enter a task.",
  invalidMember: "Select the team member again.",
  copy: "Copy",
  copied: "Copied",
  footnotes: "Footnotes",
  roles: "Reusable roles",
  empty: "Create roles in the plugin details.",
  unavailable: "The main Agent or model is temporarily unavailable.",
  choose: "Select a role to add or remove",
  readError: "Read failed. Existing records remain visible.",
  saveFailed: "Save failed. Your entries remain available. Try again.",
  settingsChanged:
    "Settings changed. Your entries remain available. Retry to save.",
  createFailed:
    "Creation failed. Member and model choices remain available. Check and retry.",
  sendFailed: "Send failed. Your draft remains available. Try again.",
  memberFailed: "The member reply failed. Mention the member again.",
  attachments:
    "This version supports text and result links in team chats. Remove attachments to send.",
};
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "kmh-team": LocaleKey;
  }
}
export type Translate = PropsLocale<"kmh-team">["t"];

/** @param error - 操作错误。 @param t - 插件文案。 @param fallback - 操作对应的恢复提示。 @returns 用户可操作的简明说明。 */
export function errorReason(
  error: unknown,
  t: Translate,
  fallback: LocaleKey,
): string {
  const text = String(error);
  if (text.includes("SettingsConflictError")) return t("settingsChanged");
  if (text.includes("model-unavailable")) return t("modelUnavailable");
  if (text.includes("owner-required")) return t("unavailable");
  if (text.includes("without inject") || text.includes("in inactive context"))
    return t("serviceUnavailable");
  if (text.includes("member-unavailable") || text.includes("mention-invalid"))
    return t("invalidMember");
  if (text.includes("task-empty")) return t("taskEmpty");
  return t(fallback);
}
