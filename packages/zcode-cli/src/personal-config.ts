/** Prepare a plugin-owned CLI personal overlay while preserving the source file. */
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";

const rule = z
  .object({
    providerId: z.string(),
    config: z
      .object({ api: z.record(z.string(), z.unknown()).optional() })
      .passthrough(),
  })
  .passthrough();
const modelRule = z
  .object({
    providerId: z.string(),
    modelId: z.string(),
    config: z
      .object({
        optionSpecs: z
          .object({
            maxOutputTokens: z
              .object({ max: z.number().optional() })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const personal = z
  .object({
    schemaVersion: z.literal(1),
    config: z
      .object({
        providerConfigRules: z
          .object({ providerRules: z.array(rule) })
          .passthrough(),
        modelConfigRules: z
          .object({
            providerModelRules: z.array(modelRule),
            manualProviderModelRules: z.array(z.unknown()),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Apply the model endpoint and output-token ceiling through the official personal configuration channel.
 * @param config - Validated plugin settings; an explicit source file must exist.
 * @returns Plugin-owned file path passed to the CLI.
 */
export async function preparePersonalConfig(config: Config): Promise<string> {
  let base: z.infer<typeof personal> = {
    schemaVersion: 1,
    config: {
      providerConfigRules: { providerRules: [] },
      modelConfigRules: {
        providerModelRules: [],
        manualProviderModelRules: [],
      },
    },
  };
  const source =
    config.personalConfigFile || join(config.dataDir, "personal-provider.json");
  try {
    base = personal.parse(JSON.parse(await readFile(source, "utf8")));
  } catch (error) {
    if (
      config.personalConfigFile ||
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    )
      throw new Error("ZCODE_PERSONAL_CONFIG_INVALID");
  }
  const rules = base.config.providerConfigRules.providerRules;
  const current = rules.find((entry) => entry.providerId === config.providerId);
  const overlay = {
    ...current,
    providerId: config.providerId,
    config: {
      ...current?.config,
      api: {
        ...current?.config.api,
        type: "openai-chat-completions",
        baseUrl: config.apiBaseUrl,
      },
    },
  };
  base.config.providerConfigRules.providerRules = [
    ...rules.filter((entry) => entry.providerId !== config.providerId),
    overlay,
  ];
  // CLI 0.16.9 将 maxOutputTokens 视为必填并按合并后规格校验上限；内置 GLM-5.3-Flash
  // 规格上限 128000，低于会话默认输出上限，须在个人配置中同步抬高才能放行默认请求。
  const modelRules = base.config.modelConfigRules.providerModelRules;
  const currentModel = modelRules.find(
    (entry) =>
      entry.providerId === config.providerId &&
      entry.modelId === config.nativeModel,
  );
  const modelOverlay = {
    ...currentModel,
    providerId: config.providerId,
    modelId: config.nativeModel,
    config: {
      ...currentModel?.config,
      optionSpecs: {
        ...currentModel?.config?.optionSpecs,
        maxOutputTokens: {
          ...currentModel?.config?.optionSpecs?.maxOutputTokens,
          max: config.defaultMaxTokens,
        },
      },
    },
  };
  base.config.modelConfigRules.providerModelRules = [
    ...modelRules.filter(
      (entry) =>
        !(
          entry.providerId === config.providerId &&
          entry.modelId === config.nativeModel
        ),
    ),
    modelOverlay,
  ];
  const file = join(config.dataDir, "kmh-model-provider.json");
  const temporary = join(config.dataDir, `.model-provider-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(base), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return file;
}
