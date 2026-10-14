/** 区块文案（中英）。 */
export type LocaleKey =
  | "title"
  | "note"
  | "kmhColumn"
  | "nativeColumn"
  | "loading"
  | "loadFailed"
  | "retry"
  | "nativeFailed"
  | "refresh"
  | "saved"
  | "saveFailed"
  | "covers"
  | "native.command-execution"
  | "native.file-change"
  | "native.view-image"
  | "native.web-search"
  | "nativeDesc.command-execution"
  | "nativeDesc.file-change"
  | "nativeDesc.view-image"
  | "nativeDesc.web-search";

export const zh: Record<LocaleKey, string> = {
  title: "工具开关",
  note: "修改仅对普通新建会话生效；已有会话保留创建时的选择。",
  kmhColumn: "KMH 工具",
  nativeColumn: "Codex 原生能力",
  loading: "清单加载中…",
  loadFailed: "清单读取失败：",
  retry: "重试",
  nativeFailed: "原生能力读取失败：",
  refresh: "重新读取",
  saved: "已保存，仅普通新建会话生效",
  saveFailed: "保存失败：",
  covers: "覆盖",
  "native.command-execution": "命令执行",
  "native.file-change": "文件修改",
  "native.view-image": "查看图片",
  "native.web-search": "联网搜索",
  "nativeDesc.command-execution": "原生 shell 命令执行",
  "nativeDesc.file-change": "原生 apply_patch 文件修改",
  "nativeDesc.view-image": "原生图片查看",
  "nativeDesc.web-search": "原生联网搜索",
};

export const en: Record<LocaleKey, string> = {
  title: "Tool switches",
  note: "Changes apply to newly created sessions only; existing sessions keep the selection made at creation.",
  kmhColumn: "KMH tools",
  nativeColumn: "Codex native capabilities",
  loading: "Loading switches…",
  loadFailed: "Failed to load switches: ",
  retry: "Retry",
  nativeFailed: "Failed to read native capabilities: ",
  refresh: "Re-read",
  saved: "Saved; applies to newly created sessions only",
  saveFailed: "Save failed: ",
  covers: "Covers",
  "native.command-execution": "Command execution",
  "native.file-change": "File changes",
  "native.view-image": "View images",
  "native.web-search": "Web search",
  "nativeDesc.command-execution": "Native shell command execution",
  "nativeDesc.file-change": "Native apply_patch file changes",
  "nativeDesc.view-image": "Native image viewing",
  "nativeDesc.web-search": "Native web search",
};
