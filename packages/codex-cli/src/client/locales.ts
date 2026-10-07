/** 详情卡片文案（中英）。 */
export type LocaleKey =
  "title" | "versionLabel" | "accountLabel" | "nativeTools" | "probe";

export const zh: Record<LocaleKey, string> = {
  title: "Codex CLI",
  versionLabel: "CLI 版本",
  accountLabel: "账号状态",
  nativeTools: "使用原生 Codex 工具与技能",
  probe: "测试连接",
};

export const en: Record<LocaleKey, string> = {
  title: "Codex CLI",
  versionLabel: "CLI version",
  accountLabel: "Account",
  nativeTools: "Use native Codex tools and skills",
  probe: "Test connection",
};
