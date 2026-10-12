/** 建群模型选择只接受当前目录中的提供方与模型组合。 */
import { z } from "zod";
import type { Bootstrap } from "../protocol/index.ts";

type Catalog = Bootstrap["catalog"];

function hasModel(catalog: Catalog, provider: string, model: string): boolean {
  return catalog.groups.some(
    (group) =>
      group.id === provider && group.models.some((item) => item.id === model),
  );
}

/** @param catalog - 当前模型目录。 @returns 可用默认模型的选项值；缺失时为空，等待用户选择。 */
export function initialModelSelection(catalog: Catalog): string {
  const { provider, model } = catalog.default;
  return hasModel(catalog, provider, model)
    ? JSON.stringify([provider, model])
    : "";
}

/** @param catalog - 当前模型目录及部署默认值。 @param value - 下拉框的实际选项值。 @returns 建群请求使用的模型选择；失效选项抛出 model-unavailable。 */
export function selectedTeamModel(
  catalog: Catalog,
  value: string,
): Catalog["default"] {
  if (value === "") throw Error("model-unavailable");
  const [provider, model] = z
    .tuple([z.string().min(1), z.string().min(1)])
    .parse(JSON.parse(value));
  if (!hasModel(catalog, provider, model)) throw Error("model-unavailable");
  return {
    provider,
    model,
    ...(catalog.default.provider === provider &&
    catalog.default.model === model &&
    catalog.default.reasoningEffort !== undefined
      ? { reasoningEffort: catalog.default.reasoningEffort }
      : {}),
  };
}
