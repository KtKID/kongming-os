/**
 * MadeMe 配置表单：同时注册在插件页声明的 `plugins.bundle.config`（插件
 * 详情页内联）与 `plugins.row.config`（组件行详情）两个槽，以
 * ui-primitives 的 SettingsForm 呈现——staged 编辑、revision 乐观锁保存、
 * 字段覆盖标记与非法值拦截均由共享表单模型承担；快照与动作经注册侧注入
 * 的 controller face（configForms 体系）提供。
 *
 * 连通性测试对当前草稿的服务地址做 no-cors 可达性探测（5 秒超时），结果
 * 以 StateDot 状态点加 12px 辅助文本呈现。附加排版经 styles.ts 注入，对齐
 * DSH 设置表单的字段节奏与 --dsw-* token。
 */
import { useState, type ReactNode } from "react";
import {
  Button,
  SettingsForm,
  SettingsValueField,
  StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
  TranslateNS,
} from "@deepseek-ai/dsh-client-ui-slots";
import { normalizeHttpUrl } from "../config.ts";
import type { MadeMeConfigFace } from "./config-controller.ts";
import { ensureStyles } from "./styles.ts";

ensureStyles();

/** 表单 props：槽 owner 份额（view/form，两槽 owner 同型）+ 注入 face + 词典。 */
export type MadeMeConfigFormProps = PropsRuntime<"plugins.row.config"> &
  PropsLocale<"mademe"> &
  InjectFace<MadeMeConfigFace>;

/** 一次连通性探测的结果。 */
interface HealthResult {
  ok: boolean;
  ms: number;
}

/** 测试按钮区域的状态。 */
interface HealthState {
  running: boolean;
  invalid: boolean;
  service: HealthResult | undefined;
}

/** 以 no-cors 请求探测一个地址的可达性；5 秒超时视为不可达。 */
async function probeHealth(url: string): Promise<HealthResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    controller.abort();
  }, 5000);
  const started = performance.now();
  try {
    await fetch(url, {
      mode: "no-cors",
      signal: controller.signal,
      cache: "no-store",
    });
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - started) };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * 渲染一行探测结果：StateDot 状态点 + 标签与结论。
 * @param label - 结果行的标签词典。
 * @param result - 一次探测的结果；未探测时不渲染。
 * @param t - 词典函数。
 * @returns 结果行，或 undefined。
 */
function healthRow(
  label: string,
  result: HealthResult | undefined,
  t: TranslateNS<"mademe">,
): ReactNode {
  if (result === undefined) return undefined;
  return (
    <div
      className={
        result.ok ? "mademe-health-row" : "mademe-health-row mademe-health-fail"
      }
    >
      <StateDot state={result.ok ? "done" : "error"} />
      <span>
        {label}：
        {result.ok
          ? `${t("config.healthOk")}（${result.ms}ms）`
          : t("config.healthFail")}
      </span>
    </div>
  );
}

/**
 * 渲染 MadeMe 配置表单。
 * @param props - 插件详情/行详情的视图请求、controller 注入与词典。
 * @returns 配置表单；非 page 视图返回空。
 */
export function MadeMeConfigForm(props: MadeMeConfigFormProps): ReactNode {
  const { t, view } = props;
  const state = props.useMadeMeConfig((snapshot) => snapshot);
  const actions = props;
  const [health, setHealth] = useState<HealthState>({
    running: false,
    invalid: false,
    service: undefined,
  });

  /** 对当前草稿的服务地址做连通性探测。 */
  const testConnections = (): void => {
    const serviceUrl = normalizeHttpUrl(state.serviceUrl.text);
    if (serviceUrl === undefined) {
      setHealth({
        running: false,
        invalid: true,
        service: undefined,
      });
      return;
    }
    setHealth({
      running: true,
      invalid: false,
      service: undefined,
    });
    const attempt = async (): Promise<void> => {
      const service = await probeHealth(serviceUrl);
      setHealth({ running: false, invalid: false, service });
    };
    attempt().catch(() => {
      setHealth({
        running: false,
        invalid: false,
        service: { ok: false, ms: 0 },
      });
    });
  };

  if (view !== "page") return null;

  return (
    <SettingsForm
      labels={{
        unavailable: t("config.unavailable"),
        readOnly: t("config.readOnly"),
        saveFailed: t("config.saveFailed"),
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
        id="mademe-config-service-url"
        label={t("config.serviceUrl")}
        hint={t("config.serviceUrlHint")}
        overriddenLabel={t("config.overridden")}
        resetLabel={t("config.reset")}
        invalidLabel={t("config.invalidUrl")}
        disabled={!state.writable}
        {...state.serviceUrl}
        onEdit={(text) => {
          actions.edit("serviceUrl", text);
        }}
        onReset={() => {
          actions.resetField("serviceUrl");
        }}
      />
      <div className="mademe-field">
        <div className="mademe-toggle-row">
          <span className="mademe-toggle-label">
            {t("config.testConnection")}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={health.running}
            onClick={() => {
              testConnections();
            }}
          >
            {health.running ? t("config.testing") : t("config.testConnection")}
          </Button>
        </div>
        <div className="mademe-health" role="status">
          {health.invalid ? (
            <div className="mademe-health-row mademe-health-fail">
              <StateDot state="warning" />
              <span>{t("config.healthInvalid")}</span>
            </div>
          ) : health.running ? (
            <div className="mademe-health-row">
              <StateDot state="ongoing" />
              <span>{t("config.testing")}</span>
            </div>
          ) : (
            healthRow(t("config.healthServiceLabel"), health.service, t)
          )}
        </div>
      </div>
    </SettingsForm>
  );
}
