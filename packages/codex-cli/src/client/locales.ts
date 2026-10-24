/** 详情卡片文案（中英）。 */
type BaseLocaleKey =
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

const baseZh: Record<BaseLocaleKey, string> = {
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

const baseEn: Record<BaseLocaleKey, string> = {
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

const quotaZh = {
  quotaTitle: "账号额度",
  quotaShort: "短周期",
  quotaWeekly: "每周",
  quotaPeriodUnknown: "周期待确认",
  quotaMinutes: "分钟",
  quotaRemaining: "剩余",
  quotaResetUnknown: "重置时间暂未提供",
  quotaResetPending: "正在确认重置后的额度",
  quotaPending: "状态待更新",
  quotaSignIn: "登录 Codex 后查看额度",
  quotaUnsupported: "当前账号或 CLI 版本暂不支持额度展示",
  quotaLoading: "正在读取额度…",
  quotaFailed: "额度暂不可用",
  quotaTimedOut: "额度读取超时",
  quotaSettingsTimedOut: "显示设置读取超时，请重新连接后重试",
  quotaReadError: "读取失败，请在下次可刷新时间重试",
  quotaSectionError: "该项信息暂时无法读取",
  quotaRetry: "重试",
  quotaUpdated: "更新于",
  quotaCredits: "额外 Credits",
  quotaUnlimited: "无限额",
  quotaUnknown: "账号暂未提供",
  quotaBalanceUnknown: "余额暂未提供",
  quotaExpiryUnknown: "到期时间暂未提供",
  quotaSpend: "已用 / 消费上限",
  quotaResets: "可用重置卡",
  quotaResetCard: "重置卡",
  quotaDetailsUnknown: "详情暂不可用",
  quotaRefresh: "刷新",
  quotaFrequency: "额度每五分钟更新",
  quotaCooldown: "下次可刷新",
  quotaSettings: "额度显示设置",
  quotaMode: "输入框额度",
  quotaPercent: "百分比",
  quotaBar: "进度条",
  quotaOff: "关闭",
  quotaAlerts: "低额度颜色提醒",
  quotaShortThreshold: "短周期剩余额度低于",
  quotaWeeklyThreshold: "每周剩余额度低于",
  quotaRange: "请输入 1–100 的整数",
  quotaSave: "保存显示设置",
  quotaSaving: "保存中…",
  quotaReadonly: "当前连接的显示设置为只读",
  quotaSettingsLoading: "正在读取显示设置…",
  quotaClose: "关闭额度详情",
  quotaDetails: "Codex 额度详情",
};
const quotaEn: Record<keyof typeof quotaZh, string> = {
  quotaTitle: "Account quota",
  quotaShort: "Short",
  quotaWeekly: "Weekly",
  quotaPeriodUnknown: "Period pending",
  quotaMinutes: "minutes",
  quotaRemaining: "remaining",
  quotaResetUnknown: "Reset time unavailable",
  quotaResetPending: "Confirming quota after reset",
  quotaPending: "Awaiting update",
  quotaSignIn: "Sign in to Codex to view quota",
  quotaUnsupported: "Quota is unavailable for this account or CLI version",
  quotaLoading: "Reading quota…",
  quotaFailed: "Quota unavailable",
  quotaTimedOut: "Quota read timed out",
  quotaSettingsTimedOut: "Display settings timed out; reconnect to retry",
  quotaReadError: "Read failed; retry at the next refresh time",
  quotaSectionError: "This section is temporarily unavailable",
  quotaRetry: "Retry",
  quotaUpdated: "Updated",
  quotaCredits: "Extra Credits",
  quotaUnlimited: "Unlimited",
  quotaUnknown: "Account has not provided this",
  quotaBalanceUnknown: "Balance unavailable",
  quotaExpiryUnknown: "Expiry unavailable",
  quotaSpend: "Used / spending limit",
  quotaResets: "Available reset cards",
  quotaResetCard: "Reset card",
  quotaDetailsUnknown: "Details unavailable",
  quotaRefresh: "Refresh",
  quotaFrequency: "Quota updates every five minutes",
  quotaCooldown: "Next refresh",
  quotaSettings: "Quota display settings",
  quotaMode: "Composer quota",
  quotaPercent: "Percentage",
  quotaBar: "Progress bar",
  quotaOff: "Off",
  quotaAlerts: "Low quota color",
  quotaShortThreshold: "Short quota below",
  quotaWeeklyThreshold: "Weekly quota below",
  quotaRange: "Enter an integer from 1 to 100",
  quotaSave: "Save display settings",
  quotaSaving: "Saving…",
  quotaReadonly: "Display settings are read-only for this connection",
  quotaSettingsLoading: "Reading display settings…",
  quotaClose: "Close quota details",
  quotaDetails: "Codex quota details",
};
export type LocaleKey = BaseLocaleKey | keyof typeof quotaZh;
export const zh: Record<LocaleKey, string> = { ...baseZh, ...quotaZh };
export const en: Record<LocaleKey, string> = { ...baseEn, ...quotaEn };
