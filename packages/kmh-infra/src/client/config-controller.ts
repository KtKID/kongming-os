/**
 * kmh-infra 配置页的暂存表单：把 settings 体系的配置引用桥接成页面 staged form。
 * 字段一律复用 ui-primitives 的现成字段模型（文本、数值），只有地址与布尔两类
 * 按本项目需要自定义：
 *
 * - 地址字段在 parse 层做规范化与拦截（无 scheme 补 https、非法地址阻塞保存），
 *   与宿主 schema 里的原始字符串字段分工，不重复维护同一份校验；
 * - 布尔字段以 "true"/"false" 文本暂存，控件用 Switch 呈现；
 * - 数值字段在现成模型之上要求正整数：宿主 schema 对这些字段有 min(1) 约束，
 *   表单层先拦住非法值，避免把校验不过的值写进 profile 的 Cordis patch。
 */
import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
import {
  SettingsFormModel,
  settingsNumberField,
  settingsTextField,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
  type SettingsFieldSpec,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { normalizeHttpUrl } from "../config.ts";

/** 本页编辑的字段集合（宿主命名空间 kmh-infra 的全部八个配置项）。 */
export interface InfraSettings {
  /** x-dash 面板地址：内嵌目标，同时是查询目标。 */
  dashUrl?: string;
  /** 暗号所在的环境变量名。 */
  tokenEnvVar?: string;
  /** Python 可执行文件。 */
  pythonCommand?: string;
  /** x-infra-mcp 检出目录。 */
  mcpModuleDir?: string;
  /** 面板加载超时（毫秒）。 */
  panelLoadTimeoutMs?: number;
  /** 连通性探测超时（毫秒）。 */
  probeTimeoutMs?: number;
  /** 单次查询等待上限（毫秒）。 */
  toolCallTimeoutMs?: number;
  /** 是否把服务查询能力接入助手。 */
  mcpEnabled?: boolean;
}

/** 页面渲染的表单状态。 */
export interface InfraConfigState extends SettingsFormShell {
  dashUrl: SettingsFieldState;
  tokenEnvVar: SettingsFieldState;
  pythonCommand: SettingsFieldState;
  mcpModuleDir: SettingsFieldState;
  panelLoadTimeoutMs: SettingsFieldState;
  probeTimeoutMs: SettingsFieldState;
  toolCallTimeoutMs: SettingsFieldState;
  mcpEnabled: SettingsFieldState;
}

/** 注册侧注入页面的 face：快照 hook 加表单动作。 */
export interface InfraConfigFace extends SettingsFormActions {
  hooks: {
    /** 表单快照，渲染器绑定为 useInfraConfig。 */
    infraConfig: SnapshotStore<InfraConfigState>;
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

/** 布尔字段：以 "true"/"false" 文本暂存，控件用 Switch 呈现。 */
function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (value === true ? "true" : "false"),
    parse: (text) => ({ kind: "set", value: text === "true" }),
  };
}

/**
 * 正整数字段：在现成数值字段之上要求整数且不小于 1。
 * @param field - 命名空间里的字段名。
 * @returns 字段规格；非法草稿返回 undefined 以阻塞保存。
 */
function settingsPositiveIntegerField(field: string): SettingsFieldSpec {
  const base = settingsNumberField(field);
  return {
    field,
    format: base.format,
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === "") return { kind: "clear" };
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        return undefined;
      }
      return { kind: "set", value: parsed };
    },
  };
}

/** 把一个配置条目的共享表单桥接到页面的暂存表单。 */
export class InfraConfigController {
  private readonly form: SettingsFormModel<InfraSettings>;
  private readonly store: SnapshotStore<InfraConfigState>;

  /** @param scope - kmh-infra 条目的共享配置表单（configForms.get）。 */
  constructor(scope: SettingsFormScope<InfraSettings>) {
    this.form = new SettingsFormModel(scope, [
      settingsHttpUrlField("dashUrl"),
      settingsTextField("tokenEnvVar"),
      settingsTextField("pythonCommand"),
      settingsTextField("mcpModuleDir"),
      settingsPositiveIntegerField("panelLoadTimeoutMs"),
      settingsPositiveIntegerField("probeTimeoutMs"),
      settingsPositiveIntegerField("toolCallTimeoutMs"),
      settingsBooleanField("mcpEnabled"),
    ]);
    this.store = this.form.bind(() => this.projection());
  }

  private projection(): InfraConfigState {
    return {
      ...this.form.shell(),
      dashUrl: this.form.field("dashUrl"),
      tokenEnvVar: this.form.field("tokenEnvVar"),
      pythonCommand: this.form.field("pythonCommand"),
      mcpModuleDir: this.form.field("mcpModuleDir"),
      panelLoadTimeoutMs: this.form.field("panelLoadTimeoutMs"),
      probeTimeoutMs: this.form.field("probeTimeoutMs"),
      toolCallTimeoutMs: this.form.field("toolCallTimeoutMs"),
      mcpEnabled: this.form.field("mcpEnabled"),
    };
  }

  /**
   * 构造注入页面的 face。
   * @returns 表单快照与动作。
   */
  inject(): InfraConfigFace {
    return { hooks: { infraConfig: this.store }, ...this.form.actions() };
  }

  /** 释放表单订阅。 */
  dispose(): void {
    this.form.dispose();
  }
}
