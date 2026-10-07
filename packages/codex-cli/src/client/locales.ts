/** 详情卡片文案（中英）。 */
export type LocaleKey =
  | "title"
  | "liveTitle"
  | "liveGreen"
  | "liveGray"
  | "liveRed"
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
  | "capabilitiesLabel"
  | "capabilityUnavailable"
  | "capabilityNextTurn"
  | "openAuthorize"
  | "signIn"
  | "cancelLogin"
  | "signOut"
  | "probe"
  | "logoutNote";

export const zh: Record<LocaleKey, string> = {
  title: "Codex CLI",
  liveTitle: "Codex CLI 连接状态",
  liveGreen: "通信正常",
  liveGray: "已停止",
  liveRed: "状态异常",
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
  capabilitiesLabel: "原生能力",
  capabilityUnavailable: "不可用",
  capabilityNextTurn:
    "调整立即保存并下一回合生效；进行中的回合保持原选择。原生技能独立选择，默认由 KMH 技能体系接管。",
  openAuthorize: "打开官方授权页",
  signIn: "登录",
  cancelLogin: "取消登录",
  signOut: "退出账号",
  probe: "测试连接",
  logoutNote: "退出账号作用于本机官方 Codex CLI 的登录态（~/.codex）。",
};

export const en: Record<LocaleKey, string> = {
  title: "Codex CLI",
  liveTitle: "Codex CLI connection",
  liveGreen: "Connected",
  liveGray: "Stopped",
  liveRed: "Abnormal",
  summary:
    "Official Codex CLI transport: account, version check, connection test",
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
  capabilitiesLabel: "Native capabilities",
  capabilityUnavailable: "Unavailable",
  capabilityNextTurn:
    "Changes save immediately and apply from the next turn; turns in flight keep their selections. Native skills are selected separately and default to KMH skills.",
  openAuthorize: "Open authorization page",
  signIn: "Sign in",
  cancelLogin: "Cancel sign-in",
  signOut: "Sign out",
  probe: "Test connection",
  logoutNote:
    "Sign out affects the local official Codex CLI login state (~/.codex).",
};
