/**
 * 聚合 Token 分析配置页的暂存表单：把 settings 体系的配置引用桥接成页面
 * staged form。字段规格两种，全部复用 ui-primitives 的现成字段模型：
 *
 * - 地址字段在 parse 层做规范化与拦截（无 scheme 补 https、非法地址阻塞
 *   保存），与宿主 schema 里的原始字符串字段分工，不重复维护同一份校验；
 * - 数值字段在现成模型之上要求不小于 1 的整数：宿主 schema 对该字段有
 *   min(1) 约束，表单层先拦住非法值，避免把校验不过的值写进 profile 的
 *   Cordis patch。
 */
import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
import {
  SettingsFormModel,
  settingsNumberField,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
  type SettingsFieldSpec,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { normalizeHttpUrl } from "../normalize-url.ts";

/** 本页编辑的字段集合（宿主命名空间 aggregated-token-analysis 的全部配置项）。 */
export interface TokenAnalysisSettings {
  /** 聚合 Token 分析页地址：内嵌打开的目标。 */
  pageUrl?: string;
  /** 页面加载超时（毫秒）。 */
  pageLoadTimeoutMs?: number;
}

/** 页面渲染的表单状态。 */
export interface TokenAnalysisConfigState extends SettingsFormShell {
  /** 宿主拒绝或传输失败时的原文错误；随 failed 状态展示。 */
  errorMessage: string | undefined;
  pageUrl: SettingsFieldState;
  pageLoadTimeoutMs: SettingsFieldState;
}

/** 注册侧注入页面的 face：快照 hook 加表单动作。 */
export interface TokenAnalysisConfigFace extends SettingsFormActions {
  hooks: {
    /** 表单快照，渲染器绑定为 useTokenAnalysisConfig。 */
    tokenAnalysisConfig: SnapshotStore<TokenAnalysisConfigState>;
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
export class TokenAnalysisConfigController {
  private readonly form: SettingsFormModel<TokenAnalysisSettings>;
  private readonly store: SnapshotStore<TokenAnalysisConfigState>;
  private errorMessage: string | undefined;

  /**
   * @param scope - aggregated-token-analysis 条目的共享配置表单（configForms.get）。
   * @param write - 保留宿主错误原文的配置写入函数。
   */
  constructor(
    scope: SettingsFormScope<TokenAnalysisSettings>,
    write: SettingsFormScope<TokenAnalysisSettings>["mutate"],
  ) {
    const formScope: SettingsFormScope<TokenAnalysisSettings> = {
      getSnapshot: () => scope.getSnapshot(),
      subscribe: (listener) => scope.subscribe(listener),
      mutate: async (ops, revision) => {
        this.errorMessage = undefined;
        try {
          return await write(ops, revision);
        } catch (error) {
          this.errorMessage =
            error instanceof Error ? error.message : String(error);
          throw error;
        }
      },
    };
    this.form = new SettingsFormModel(formScope, [
      settingsHttpUrlField("pageUrl"),
      settingsPositiveIntegerField("pageLoadTimeoutMs"),
    ]);
    this.store = this.form.bind(() => this.projection());
  }

  private projection(): TokenAnalysisConfigState {
    return {
      ...this.form.shell(),
      errorMessage: this.errorMessage,
      pageUrl: this.form.field("pageUrl"),
      pageLoadTimeoutMs: this.form.field("pageLoadTimeoutMs"),
    };
  }

  /**
   * 构造注入页面的 face。
   * @returns 表单快照与动作。
   */
  inject(): TokenAnalysisConfigFace {
    return {
      hooks: { tokenAnalysisConfig: this.store },
      ...this.form.actions(),
    };
  }

  /** 释放表单订阅。 */
  dispose(): void {
    this.form.dispose();
  }
}
