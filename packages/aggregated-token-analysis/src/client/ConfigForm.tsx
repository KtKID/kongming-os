/**
 * 聚合 Token 分析配置表单：注册在插件页声明的 `plugins.bundle.config`
 * （插件详情页内联）与 `plugins.row.config`（组件行详情）两个槽，以
 * ui-primitives 的 SettingsForm 呈现——staged 编辑、revision 乐观锁保存、
 * 字段覆盖标记与非法值拦截均由共享表单模型承担；快照与动作经注册侧注入
 * 的 controller face 提供。
 *
 * 两个配置项都在这一页，用户不需要改配置文件。数值字段带单位与默认值，
 * 非法草稿在字段旁原位提示并阻塞保存（不落到 profile 的 Cordis patch 里）。
 * 本插件不做"测试连接"（spec 确认记录：按剃刀法则删去）。
 */
import type { ReactNode } from "react";
import {
  SettingsForm,
  SettingsValueField,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type { TokenAnalysisConfigFace } from "./config-controller.ts";
import { ensureStyles } from "./styles.ts";

ensureStyles();

/** 表单 props：槽 owner 份额（view/form，两槽 owner 同型）+ 注入 face + 词典。 */
export type TokenAnalysisConfigFormProps = PropsRuntime<"plugins.row.config"> &
  PropsLocale<"tokenAnalysis"> &
  InjectFace<TokenAnalysisConfigFace>;

/**
 * 渲染聚合 Token 分析配置表单。
 * @param props - 插件详情/行详情的视图请求、controller 注入与词典。
 * @returns 配置表单；非 page 视图返回空。
 */
export function TokenAnalysisConfigForm(
  props: TokenAnalysisConfigFormProps,
): ReactNode {
  const { t, view } = props;
  const state = props.useTokenAnalysisConfig((snapshot) => snapshot);
  const actions = props;

  if (view !== "page") return null;

  const disabled = !state.writable;
  const shared = {
    overriddenLabel: t("config.overridden"),
    resetLabel: t("config.reset"),
    disabled,
  };

  return (
    <SettingsForm
      labels={{
        unavailable: t("config.unavailable"),
        readOnly: t("config.readOnly"),
        saveFailed: state.errorMessage ?? "",
        save: t("config.save"),
        saving: t("config.saving"),
      }}
      state={state}
      onSave={() => {
        actions.save();
      }}
      onDiscard={() => {
        actions.discard();
      }}
    >
      <SettingsValueField
        id="token-analysis-config-page-url"
        label={t("config.pageUrl")}
        hint={t("config.pageUrlHint")}
        invalidLabel={t("config.invalidUrl")}
        {...shared}
        {...state.pageUrl}
        onEdit={(text) => {
          actions.edit("pageUrl", text);
        }}
        onReset={() => {
          actions.resetField("pageUrl");
        }}
      />
      <SettingsValueField
        id="token-analysis-config-load-timeout"
        label={t("config.pageLoadTimeout")}
        hint={t("config.pageLoadTimeoutHint")}
        invalidLabel={t("config.invalidNumber")}
        {...shared}
        {...state.pageLoadTimeoutMs}
        onEdit={(text) => {
          actions.edit("pageLoadTimeoutMs", text);
        }}
        onReset={() => {
          actions.resetField("pageLoadTimeoutMs");
        }}
      />
    </SettingsForm>
  );
}
