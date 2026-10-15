/** MadeMe 配置页的暂存表单：桥接 settings 体系的配置引用与页面 staged form。 */

import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
import {
  SettingsFormModel,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
  type SettingsFieldSpec,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { normalizeHttpUrl } from "../config.ts";

/** 本页编辑的字段集合（宿主命名空间 kmh-mademe 的子集）。 */
export interface MadeMeSettings {
  /** MadeMe 服务地址（内嵌网页目标）。 */
  serviceUrl?: string;
  /** MCP 接入地址（streamable-http 端点）。 */
  mcpUrl?: string;
  /** 是否把 MadeMe 工具接入助手。 */
  mcpEnabled?: boolean;
}

/** 页面渲染的表单状态。 */
export interface MadeMeConfigState extends SettingsFormShell {
  serviceUrl: SettingsFieldState;
  mcpUrl: SettingsFieldState;
  mcpEnabled: SettingsFieldState;
}

/** 注册侧注入页面的 face：快照 hook 加表单动作。 */
export interface MadeMeConfigFace extends SettingsFormActions {
  hooks: {
    /** 表单快照，渲染器绑定为 useMadeMeConfig。 */
    madeMeConfig: SnapshotStore<MadeMeConfigState>;
  };
}

/** http(s) 地址字段：空草稿清除；非法地址阻塞保存；合法地址规范化（无 scheme 补 https）。 */
function settingsHttpUrlField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (typeof value === "string" ? value : ""),
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === "") return { kind: "clear" };
      const normalized = normalizeHttpUrl(trimmed);
      return normalized === undefined
        ? undefined
        : { kind: "set", value: normalized };
    },
  };
}

/** 布尔字段：以 "true"/"false" 文本暂存，控件用 Checkbox 呈现。 */
function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (value === true ? "true" : "false"),
    parse: (text) => ({ kind: "set", value: text === "true" }),
  };
}

/** 把一个配置条目的共享表单桥接到页面的暂存表单。 */
export class MadeMeConfigController {
  private readonly form: SettingsFormModel<MadeMeSettings>;
  private readonly store: SnapshotStore<MadeMeConfigState>;

  /** @param scope - kmh-mademe 条目的共享配置表单（configForms.get）。 */
  constructor(scope: SettingsFormScope<MadeMeSettings>) {
    this.form = new SettingsFormModel(scope, [
      settingsHttpUrlField("serviceUrl"),
      settingsHttpUrlField("mcpUrl"),
      settingsBooleanField("mcpEnabled"),
    ]);
    this.store = this.form.bind(() => this.projection());
  }

  private projection(): MadeMeConfigState {
    return {
      ...this.form.shell(),
      serviceUrl: this.form.field("serviceUrl"),
      mcpUrl: this.form.field("mcpUrl"),
      mcpEnabled: this.form.field("mcpEnabled"),
    };
  }

  /** 构造注入页面的 face。
   * @returns 表单快照与动作。
   */
  inject(): MadeMeConfigFace {
    return { hooks: { madeMeConfig: this.store }, ...this.form.actions() };
  }

  /** 释放表单订阅。 */
  dispose(): void {
    this.form.dispose();
  }
}
