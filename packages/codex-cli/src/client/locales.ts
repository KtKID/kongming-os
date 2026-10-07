/** 详情卡片文案（中英）。 */
export type LocaleKey =
  | "title"
  | "summary"
  | "loading"
  | "versionLabel"
  | "versionSupported"
  | "versionUnsupported"
  | "versionMissing"
  | "accountLabel"
  | "accountSignedIn"
  | "accountWaiting"
  | "accountStarting"
  | "accountFailed"
  | "accountSignedOut"
  | "credentialLabel"
  | "modelLabel"
  | "modelCatalogFirst"
  | "probeLabel"
  | "probeNever"
  | "probePass"
  | "probeFail"
  | "nativeTools"
  | "nativeToolsHint"
  | "openAuthorize"
  | "signIn"
  | "cancelLogin"
  | "signOut"
  | "probe"
  | "logoutNote";

export const zh: Record<LocaleKey, string> = {
  title: "Codex CLI",
  summary: "官方 Codex CLI 传输：账号登录、版本检查与连接测试",
  loading: "状态加载中…",
  versionLabel: "CLI 版本",
  versionSupported: "受支持",
  versionUnsupported: "不受支持",
  versionMissing: "未检测到",
  accountLabel: "账号状态",
  accountSignedIn: "已登录",
  accountWaiting: "等待授权",
  accountStarting: "发起登录中",
  accountFailed: "登录失败",
  accountSignedOut: "未登录",
  credentialLabel: "凭据来源",
  modelLabel: "默认模型",
  modelCatalogFirst: "目录首选",
  probeLabel: "最近连接测试",
  probeNever: "未测试",
  probePass: "通过",
  probeFail: "失败",
  nativeTools: "使用原生 Codex 工具与技能",
  nativeToolsHint:
    "默认关闭，仅用 KMH 的工具与技能；进行中的回合不受影响，下一回合生效。",
  openAuthorize: "打开官方授权页",
  signIn: "登录",
  cancelLogin: "取消登录",
  signOut: "退出账号",
  probe: "测试连接",
  logoutNote: "退出账号作用于本机官方 Codex CLI 的登录态（~/.codex）。",
};

export const en: Record<LocaleKey, string> = {
  title: "Codex CLI",
  summary: "Official Codex CLI transport: account, version check, connection test",
  loading: "Loading status…",
  versionLabel: "CLI version",
  versionSupported: "Supported",
  versionUnsupported: "Unsupported",
  versionMissing: "Not detected",
  accountLabel: "Account",
  accountSignedIn: "Signed in",
  accountWaiting: "Awaiting authorization",
  accountStarting: "Starting sign-in",
  accountFailed: "Sign-in failed",
  accountSignedOut: "Signed out",
  credentialLabel: "Credential source",
  modelLabel: "Default model",
  modelCatalogFirst: "Catalog default",
  probeLabel: "Last connection test",
  probeNever: "Never tested",
  probePass: "Passed",
  probeFail: "Failed",
  nativeTools: "Use native Codex tools and skills",
  nativeToolsHint:
    "Off by default; only KMH tools and skills run. Turns in flight keep their state; the next turn follows the new one.",
  openAuthorize: "Open authorization page",
  signIn: "Sign in",
  cancelLogin: "Cancel sign-in",
  signOut: "Sign out",
  probe: "Test connection",
  logoutNote:
    "Sign out affects the local official Codex CLI login state (~/.codex).",
};
