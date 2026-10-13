/** 详情卡片文案（中英）。 */
export type LocaleKey =
  | "toolDisabled"
  | "toolRunning"
  | "toolCompleted"
  | "preparationWaiting"
  | "title"
  | "liveTitle"
  | "liveGreen"
  | "liveGray"
  | "liveRed"
  | "liveRetrying"
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
  | "toolSelectionScope"
  | "openAuthorize"
  | "signIn"
  | "cancelLogin"
  | "signOut"
  | "probe"
  | "logoutNote";

export const zh: Record<LocaleKey, string> = {
  toolDisabled: "工具已关闭",
  toolRunning: "执行中",
  toolCompleted: "执行完成",
  preparationWaiting: "工具准备待重试",
  title: "Codex CLI",
  liveTitle: "Codex CLI 连接状态",
  liveGreen: "通信正常",
  liveGray: "已停止",
  liveRed: "状态异常",
  liveRetrying: "连接失败，正在重试",
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
  capabilitiesLabel: "原生技能",
  capabilityUnavailable: "不可用",
  capabilityNextTurn:
    "原生技能调整后下一回合生效；进行中的回合保留原选择。默认由 KMH 技能体系接管。",
  toolSelectionScope:
    "工具开关仅对普通新建会话生效；已有会话保留创建时的工具。",
  openAuthorize: "打开官方授权页",
  signIn: "登录",
  cancelLogin: "取消登录",
  signOut: "退出账号",
  probe: "测试连接",
  logoutNote: "退出账号作用于本机官方 Codex CLI 的登录态（~/.codex）。",
};

export const en: Record<LocaleKey, string> = {
  toolDisabled: "Tool disabled",
  toolRunning: "Running",
  toolCompleted: "Completed",
  preparationWaiting: "Tool preparation awaiting retry",
  title: "Codex CLI",
  liveTitle: "Codex CLI connection",
  liveGreen: "Connected",
  liveGray: "Stopped",
  liveRed: "Abnormal",
  liveRetrying: "Connection failed, Retrying",
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
  capabilitiesLabel: "Native skills",
  capabilityUnavailable: "Unavailable",
  capabilityNextTurn:
    "Native skill changes apply from the next turn; turns in flight keep their selections. KMH skills remain the default.",
  toolSelectionScope:
    "Tool switches apply only to newly created conversations; existing conversations keep their original tools.",
  openAuthorize: "Open authorization page",
  signIn: "Sign in",
  cancelLogin: "Cancel sign-in",
  signOut: "Sign out",
  probe: "Test connection",
  logoutNote:
    "Sign out affects the local official Codex CLI login state (~/.codex).",
};
