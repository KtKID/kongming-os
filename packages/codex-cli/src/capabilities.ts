/** 原生能力逐项选择（feat02 修订版）：能力清单、选择模型与旧开关迁移。 */
import type { VersionStatus } from "./status.ts";

/** 一份原生能力选择：工具四项与独立的原生技能（默认全关）。 */
export interface NativeSelection {
  /** 原生命令执行（shell）。 */
  commandExecution: boolean;
  /** 原生文件修改（apply_patch）。 */
  fileChange: boolean;
  /** 原生查看图片。 */
  viewImage: boolean;
  /** 原生网络搜索。 */
  webSearch: boolean;
  /** 原生技能（独立于工具选择，默认关闭）。 */
  skills: boolean;
}
/** 默认选择：仅 KMH 工具/技能与既有原生图片生成（R1 已确认）。 */
export const DEFAULT_SELECTION: NativeSelection = {
  commandExecution: false,
  fileChange: false,
  viewImage: false,
  webSearch: false,
  skills: false,
};
/** 全开选择：旧总开关 true 的迁移映射（已支持项全选）。 */
export const FULL_SELECTION: NativeSelection = {
  commandExecution: true,
  fileChange: true,
  viewImage: true,
  webSearch: true,
  skills: true,
};
/** 旧总开关布尔到逐项选择的迁移。 */
export function selectionFromLegacy(enabled: boolean): NativeSelection {
  return enabled ? { ...FULL_SELECTION } : { ...DEFAULT_SELECTION };
}
/** 选择字段校验：合法布尔字段保留，缺失或非法回落默认。 */
export function selectionOf(value: unknown): NativeSelection {
  const pick = (key: keyof NativeSelection): boolean => {
    if (value === null || typeof value !== "object")
      return DEFAULT_SELECTION[key];
    for (const [name, item] of Object.entries(value))
      if (name === key && typeof item === "boolean") return item;
    return DEFAULT_SELECTION[key];
  };
  return {
    commandExecution: pick("commandExecution"),
    fileChange: pick("fileChange"),
    viewImage: pick("viewImage"),
    webSearch: pick("webSearch"),
    skills: pick("skills"),
  };
}
/** 详情页能力条目：标识、文案与可用状态（服务端给出，客户端只渲染）。 */
export interface NativeCapabilityView {
  id: keyof NativeSelection;
  label: string;
  description: string;
  available: boolean;
  /** 不可用的已知原因（场景6）。 */
  reason?: string;
}
/** 能力条目的静态文案（顺序即详情页展示顺序）。 */
const CAPABILITY_LABELS: readonly {
  id: keyof NativeSelection;
  label: string;
  description: string;
}[] = [
  {
    id: "commandExecution",
    label: "命令执行",
    description: "原生 shell 命令执行（经审批档位决定是否询问）",
  },
  {
    id: "fileChange",
    label: "文件修改",
    description: "原生 apply_patch 文件修改",
  },
  {
    id: "viewImage",
    label: "查看图片",
    description: "原生图片查看工具",
  },
  {
    id: "webSearch",
    label: "网络搜索",
    description: "原生联网搜索工具",
  },
  {
    id: "skills",
    label: "原生技能",
    description:
      "官方 CLI 自带技能目录（默认关闭，$技能名 由 KMH 技能体系接管）",
  },
];
/**
 * 组装详情页能力列表：当前版本检查结果决定可用性（场景6）。
 * 版本不可用是当前唯一部署级已知原因；账号与模型粒度的限制在任务
 * 发起时按实际可见工具核对，此处如实展示已知部分。
 * @param version - 版本检查结果。
 * @returns 按展示顺序的能力条目。
 */
export function capabilityViews(
  version: VersionStatus,
): NativeCapabilityView[] {
  const available = version.ok;
  return CAPABILITY_LABELS.map((entry) => {
    if (available) return { ...entry, available };
    return {
      ...entry,
      available,
      reason: version.reason ?? "CODEX_CLI_UNAVAILABLE",
    };
  });
}
