/** Dynamic model catalog from the official builtin template and the account model endpoint. */
import { readFile } from "node:fs/promises";
import { z } from "zod";

/** One usable model: KMH-layer lowercase id plus the official native identifier. */
export interface ModelEntry {
  /** KMH-layer model id matching the account endpoint spelling (lowercase). */
  id: string;
  /** Identifier injected into the CLI and used for model selection. */
  nativeId: string;
  /** Display name, preferring the official template spelling. */
  name: string;
}

const accountModels = z.object({
  data: z.array(z.object({ id: z.string().min(1) }).passthrough()),
});
const templateRule = z
  .object({
    config: z
      .object({
        access: z.object({ type: z.string() }).passthrough().optional(),
        api: z.object({ baseUrl: z.string() }).passthrough().optional(),
        builtinModelIds: z.array(z.string()).optional(),
      })
      .passthrough(),
  })
  .passthrough();
const builtinConfig = z
  .object({
    config: z
      .object({
        providerConfigRules: z
          .object({ templateRules: z.array(templateRule) })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Read the coding-plan template models that share the account endpoint host.
 * @param builtinPath - Official CLI zcode-builtin.json location.
 * @param apiBaseUrl - Account endpoint whose host selects the template.
 * @returns Template ids in official order, or an empty list when absent or unparsable.
 */
export async function builtinTemplateModels(
  builtinPath: string,
  apiBaseUrl: string,
): Promise<string[]> {
  let parsed: z.infer<typeof builtinConfig>;
  try {
    parsed = builtinConfig.parse(
      JSON.parse(await readFile(builtinPath, "utf8")),
    );
  } catch {
    return [];
  }
  const host = new URL(apiBaseUrl).host;
  for (const rule of parsed.config.providerConfigRules.templateRules) {
    if (rule.config.access?.type !== "zhipu-coding-plan-api-key") continue;
    try {
      if (new URL(rule.config.api?.baseUrl ?? "").host !== host) continue;
    } catch {
      continue;
    }
    return rule.config.builtinModelIds ?? [];
  }
  return [];
}

/**
 * List the models the logged-in account may call.
 * @param apiBaseUrl - Account endpoint base; `/models` is appended.
 * @param apiKey - Account credential sent as the bearer token.
 * @param signal - Cancellation for the bounded request.
 * @returns Endpoint ids in server order.
 */
export async function fetchAccountModels(
  apiBaseUrl: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<string[]> {
  const response = await fetch(`${apiBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) throw new Error("ZCODE_MODELS_ENDPOINT_FAILED");
  const body = accountModels.parse(await response.json());
  const ids = body.data.map((model) => model.id);
  if (ids.length === 0) throw new Error("ZCODE_MODELS_ENDPOINT_EMPTY");
  return ids;
}

/**
 * Intersect the official template order with the account's callable models.
 * @param builtin - Official template ids in official order.
 * @param account - Account endpoint ids in server order.
 * @param explicit - Configured fixed model; empty string follows the catalog head.
 * @returns Entries whose head is the default model.
 */
export function resolveCatalog(
  builtin: string[],
  account: string[],
  explicit: string,
): ModelEntry[] {
  const lowercase = new Map(
    account.map((id) => [id.toLowerCase(), id] as const),
  );
  const ordered: ModelEntry[] = [];
  for (const id of builtin) {
    const match = lowercase.get(id.toLowerCase());
    if (match !== undefined)
      ordered.push({ id: match, nativeId: id, name: id });
  }
  const entries: ModelEntry[] =
    ordered.length > 0
      ? ordered
      : [...account].reverse().map((id) => ({ id, nativeId: id, name: id }));
  const explicitEntry = explicit
    ? entries.find((entry) => entry.id === explicit.toLowerCase())
    : undefined;
  if (explicitEntry)
    return [
      explicitEntry,
      ...entries.filter((entry) => entry !== explicitEntry),
    ];
  if (explicit)
    return [{ id: explicit, nativeId: explicit, name: explicit }, ...entries];
  return entries;
}
