/**
 * kmh-infra 配置表单：注册在插件页声明的 `plugins.bundle.config`（插件详情页
 * 内联）与 `plugins.row.config`（组件行详情）两个槽，以 ui-primitives 的
 * SettingsForm 呈现——staged 编辑、revision 乐观锁保存、字段覆盖标记与非法值
 * 拦截均由共享表单模型承担；快照与动作经注册侧注入的 controller face 提供。
 *
 * 八个配置项都在这一页，用户不需要改配置文件。三个数值字段带单位与默认值，
 * 非法草稿在字段旁原位提示并阻塞保存（不落到 profile 的 Cordis patch 里）。
 * 「测试连接」只探面板地址：查询进程是本地子进程，浏览器侧无法探测，因此
 * 不假装能测；连通性探测的超时取当前草稿里的 `probeTimeoutMs`。
 */
import { useState, type ReactNode } from "react";
import {
  Button,
  SettingsForm,
  SettingsValueField,
  StateDot,
  Switch,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
  TranslateNS,
} from "@deepseek-ai/dsh-client-ui-slots";
import { normalizeHttpUrl } from "../config.ts";
import type { InfraConfigFace } from "./config-controller.ts";
import { ensureStyles } from "./styles.ts";

ensureStyles();

/** 表单 props：槽 owner 份额（view/form，两槽 owner 同型）+ 注入 face + 词典。 */
export type InfraConfigFormProps = PropsRuntime<"plugins.row.config"> &
  PropsLocale<"infra"> &
  InjectFace<InfraConfigFace>;

/** 一次连通性探测的结果。 */
interface HealthResult {
  ok: boolean;
  ms: number;
}

/** 测试按钮区域的状态。 */
interface HealthState {
  running: boolean;
  invalid: boolean;
  dash: HealthResult | undefined;
}

/**
 * 以 no-cors 请求探测一个地址的可达性。
 * @param url - 规范化后的地址。
 * @param timeoutMs - 等待上限（毫秒），来自当前草稿的探测超时。
 * @returns 可达性与耗时；超时或失败按不可达返回。
 */
async function probeHealth(
  url: string,
  timeoutMs: number,
): Promise<HealthResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);
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
  t: TranslateNS<"infra">,
): ReactNode {
  if (result === undefined) return undefined;
  return (
    <div
      className={
        result.ok ? "infra-health-row" : "infra-health-row infra-health-fail"
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
 * 渲染 kmh-infra 配置表单。
 * @param props - 插件详情/行详情的视图请求、controller 注入与词典。
 * @returns 配置表单；非 page 视图返回空。
 */
export function InfraConfigForm(props: InfraConfigFormProps): ReactNode {
  const { t, view } = props;
  const state = props.useInfraConfig((snapshot) => snapshot);
  const actions = props;
  const [health, setHealth] = useState<HealthState>({
    running: false,
    invalid: false,
    dash: undefined,
  });

  /** 对当前草稿的面板地址做一次可达性探测，超时取草稿里的探测超时。 */
  const testConnection = (): void => {
    const dashUrl = normalizeHttpUrl(state.dashUrl.text);
    const timeout = Number(state.probeTimeoutMs.text);
    if (dashUrl === undefined || !Number.isFinite(timeout) || timeout < 1) {
      setHealth({ running: false, invalid: true, dash: undefined });
      return;
    }
    setHealth({ running: true, invalid: false, dash: undefined });
    const attempt = async (): Promise<void> => {
      const dash = await probeHealth(dashUrl, timeout);
      setHealth({ running: false, invalid: false, dash });
    };
    attempt().catch(() => {
      setHealth({ running: false, invalid: false, dash: { ok: false, ms: 0 } });
    });
  };

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
        id="infra-config-dash-url"
        label={t("config.dashUrl")}
        hint={t("config.dashUrlHint")}
        invalidLabel={t("config.invalidUrl")}
        {...shared}
        {...state.dashUrl}
        onEdit={(text) => {
          actions.edit("dashUrl", text);
        }}
        onReset={() => {
          actions.resetField("dashUrl");
        }}
      />
      <SettingsValueField
        id="infra-config-token-env-var"
        label={t("config.tokenEnvVar")}
        hint={t("config.tokenEnvVarHint")}
        invalidLabel={t("config.invalidUrl")}
        {...shared}
        {...state.tokenEnvVar}
        onEdit={(text) => {
          actions.edit("tokenEnvVar", text);
        }}
        onReset={() => {
          actions.resetField("tokenEnvVar");
        }}
      />
      <SettingsValueField
        id="infra-config-python-command"
        label={t("config.pythonCommand")}
        hint={t("config.pythonCommandHint")}
        invalidLabel={t("config.invalidUrl")}
        {...shared}
        {...state.pythonCommand}
        onEdit={(text) => {
          actions.edit("pythonCommand", text);
        }}
        onReset={() => {
          actions.resetField("pythonCommand");
        }}
      />
      <SettingsValueField
        id="infra-config-mcp-module-dir"
        label={t("config.mcpModuleDir")}
        hint={t("config.mcpModuleDirHint")}
        invalidLabel={t("config.invalidUrl")}
        {...shared}
        {...state.mcpModuleDir}
        onEdit={(text) => {
          actions.edit("mcpModuleDir", text);
        }}
        onReset={() => {
          actions.resetField("mcpModuleDir");
        }}
      />
      <SettingsValueField
        id="infra-config-panel-load-timeout"
        label={t("config.panelLoadTimeout")}
        hint={t("config.panelLoadTimeoutHint")}
        invalidLabel={t("config.invalidNumber")}
        {...shared}
        {...state.panelLoadTimeoutMs}
        onEdit={(text) => {
          actions.edit("panelLoadTimeoutMs", text);
        }}
        onReset={() => {
          actions.resetField("panelLoadTimeoutMs");
        }}
      />
      <SettingsValueField
        id="infra-config-probe-timeout"
        label={t("config.probeTimeout")}
        hint={t("config.probeTimeoutHint")}
        invalidLabel={t("config.invalidNumber")}
        {...shared}
        {...state.probeTimeoutMs}
        onEdit={(text) => {
          actions.edit("probeTimeoutMs", text);
        }}
        onReset={() => {
          actions.resetField("probeTimeoutMs");
        }}
      />
      <SettingsValueField
        id="infra-config-tool-call-timeout"
        label={t("config.toolCallTimeout")}
        hint={t("config.toolCallTimeoutHint")}
        invalidLabel={t("config.invalidNumber")}
        {...shared}
        {...state.toolCallTimeoutMs}
        onEdit={(text) => {
          actions.edit("toolCallTimeoutMs", text);
        }}
        onReset={() => {
          actions.resetField("toolCallTimeoutMs");
        }}
      />
      <div className="infra-field">
        <div className="infra-toggle-row">
          <span>{t("config.mcpEnabled")}</span>
          <Switch
            checked={state.mcpEnabled.text === "true"}
            disabled={disabled}
            label={t("config.mcpEnabled")}
            onChange={(checked) => {
              actions.edit("mcpEnabled", checked ? "true" : "false");
            }}
          />
        </div>
        <p className="infra-hint">{t("config.mcpEnabledHint")}</p>
      </div>
      <div className="infra-field">
        <div className="infra-toggle-row">
          <span className="infra-toggle-label">
            {t("config.testConnection")}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={health.running}
            onClick={() => {
              testConnection();
            }}
          >
            {health.running ? t("config.testing") : t("config.testConnection")}
          </Button>
        </div>
        <div className="infra-health" role="status">
          {health.invalid ? (
            <div className="infra-health-row infra-health-fail">
              <StateDot state="warning" />
              <span>{t("config.healthInvalid")}</span>
            </div>
          ) : health.running ? (
            <div className="infra-health-row">
              <StateDot state="ongoing" />
              <span>{t("config.testing")}</span>
            </div>
          ) : (
            healthRow(t("config.healthDashLabel"), health.dash, t)
          )}
        </div>
      </div>
    </SettingsForm>
  );
}
