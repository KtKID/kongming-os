/**
 * 将 web-app 注入的 app:web-surface 系统提示词段落替换为中文文案。
 *
 * 上游 @deepseek-ai/dsh-web-app 以英文注册该段落（webSurfacePrompt）；本插件监听
 * system-prompt/assemble 瀑布，在组装完成后按段落名替换文本，地址从原文案提取后
 * 经 {url} 占位符回填。不修改 DSH 源码，也不影响 DSH_WEB_URL 环境变量与
 * harness-source 段落。replaceWebSurface 为纯函数，测试直接覆盖。
 */
import type { Context } from "@deepseek-ai/cordis";
import schema from "@deepseek-ai/schemastery";
import type {
  AssembledSection,
  PromptAssembly,
} from "@deepseek-ai/dsh-system-prompt";

/** Cordis 插件名（诊断用）；profile 中的 name 是模块说明符 @kmh/web-surface-zh。 */
export const name = "kmh-web-surface-zh";

/** 待 systemPrompt 服务就绪后再激活。 */
export const inject = ["systemPrompt"];

/** web-app 注册的 web-surface 段落名。 */
const WEB_SURFACE_SECTION = "app:web-surface";

/** 内置中文文案；{url} 在替换时填入从原文案提取的 GUI 地址。 */
const DEFAULT_TEXT = [
  "你正在通过 {url} 的 Kongming Web 图形界面与用户交互。当用户提到“这个页面”、“这个界面”或“这个应用”而没有指名其他目标时，说的就是这个界面。",
  "浏览器不会隐式提供任何 DOM、路由或截图上下文。客户端插件的改动只有在同一份检出里同时运行着对应的开发监听进程来重建插件 bundle 时，才能免刷新热重载；在向用户承诺“改动会自动生效”之前，先核实那个监听进程确实在跑。其余所有改动——Web 前端外壳与普通 packages——都需要重新构建受影响的 Web 产物，然后在刷新页面后于这个既有地址上验证。",
  "另起一个服务器并不会更新这个界面。Web 前端的构建产物只是外壳，不是独立应用，因为只有 dsh web 启动的服务才会注入 window.__DSH_BOOT__。除非用户要求，不要自行启动替代服务器；如果确实需要，使用受管理的后台任务来跑，并核对其确切的地址。",
].join("\n\n");

/** 校验后的插件配置。 */
export const Config = schema.object({
  /** 自定义文案模板；留空使用内置文案；{url} 为地址占位符。 */
  text: schema.string().default(""),
});

export type Config = ReturnType<typeof Config>;

/** 单次替换的诊断与结果。 */
export interface WebSurfaceReplacement {
  /** 替换后的完整段落列表；未替换时为原列表的浅拷贝。 */
  sections: AssembledSection[];
  /** 从原文案提取的 GUI 地址；仅在替换成功时存在。 */
  url?: string;
  /** 是否完成了替换。 */
  replaced: boolean;
}

/**
 * 从 web-surface 原文案提取第一个 http(s) 地址并剥去尾随标点。
 * @param text - web-app 生成的英文段落文本。
 * @returns GUI 地址；找不到时返回 undefined。
 */
function extractWebUrl(text: string): string | undefined {
  const match = /https?:\/\/\S+/.exec(text)?.[0];
  if (match === undefined) return undefined;
  return match.replace(/[.,;:!?)\]}'"]+$/u, "");
}

/**
 * 在组装结果中定位 app:web-surface 并替换为中文文案。
 * @param sections - 瀑布上游产出的段落列表。
 * @param template - 中文文案模板，{url} 占位符填入原文案地址。
 * @returns 新段落列表与替换诊断；未命中目标段或地址缺失时原样返回。
 */
export function replaceWebSurface(
  sections: readonly AssembledSection[],
  template: string,
): WebSurfaceReplacement {
  const index = sections.findIndex(
    (section) => section.name === WEB_SURFACE_SECTION,
  );
  const original = index >= 0 ? sections[index] : undefined;
  if (original === undefined)
    return { sections: [...sections], replaced: false };
  const url = extractWebUrl(original.text);
  if (url === undefined) return { sections: [...sections], replaced: false };
  const next = [...sections];
  next[index] = { ...original, text: template.replaceAll("{url}", url) };
  return { sections: next, url, replaced: true };
}

/**
 * 注册组装瀑布监听：next() 拿到上游组装结果后按段落名替换 web-surface 文本。
 * 首次替换与首次未命中各记一条日志，避免每轮组装刷屏。
 * @param ctx - 插件 Cordis 上下文。
 * @param config - 插件配置；text 留空使用内置中文文案。
 */
export function apply(ctx: Context, config: Config): void {
  const template = config.text.length > 0 ? config.text : DEFAULT_TEXT;
  const logger = ctx.logger("web-surface-zh");
  let announced = false;
  let warnedMissing = false;
  ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
    const resolved = await next();
    const result = replaceWebSurface(resolved.sections, template);
    if (!result.replaced) {
      if (!warnedMissing) {
        warnedMissing = true;
        logger.warn(
          "未找到 app:web-surface 段落或其中不含地址，保留上游原文（检查 surfaceContext 与上游段落名）",
        );
      }
      return resolved;
    }
    if (!announced) {
      announced = true;
      logger.info(`app:web-surface 已替换为中文文案（${result.url}）`);
    }
    return { ...resolved, sections: result.sections } satisfies PromptAssembly;
  });
}
