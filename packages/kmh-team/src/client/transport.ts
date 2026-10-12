/** 浏览器请求与完整视图流，使用同源 DSH 鉴权通道。 */
import { ViewSchema, ErrorSchema, type TeamView } from "../protocol/index.ts";
/** @param action - 插件固定路由。 @param body - 可选 JSON 请求。 @param teamId - 可选团队地址。 @param signal - 调用者取消。 @returns 待业务 schema 校验的响应。 */
export async function request(
  action: string,
  body?: unknown,
  teamId?: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(
    `/api/kmh-team/${action}${teamId === undefined ? "" : `?teamId=${encodeURIComponent(teamId)}`}`,
    {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
      ...(signal === undefined ? {} : { signal }),
    },
  );
  const result: unknown = await response.json();
  if (!response.ok) throw Error(ErrorSchema.parse(result).message);
  return result;
}
/** @param id - 当前团队。 @param signal - 组件生命周期取消。 @param onView - 完整基线或后续完整视图。 */
export async function watch(
  id: string,
  signal: AbortSignal,
  onView: (view: TeamView) => void,
): Promise<void> {
  const response = await fetch(
    `/api/kmh-team/watch?teamId=${encodeURIComponent(id)}`,
    { signal },
  );
  if (!response.ok)
    throw Error(ErrorSchema.parse(await response.json()).message);
  if (response.body === null) throw Error("stream-unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let epoch: string | undefined;
  let revision = -1;
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        if (!signal.aborted) throw Error("stream-ended");
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const view = ViewSchema.parse(JSON.parse(line));
        if (epoch === undefined) {
          epoch = view.hostEpoch;
          revision = -1;
        }
        if (view.hostEpoch !== epoch) throw Error("host-epoch-changed");
        if (view.revision > revision && !signal.aborted) {
          revision = view.revision;
          onView(view);
        }
      }
    }
  } finally {
    await reader.cancel().catch((error: unknown) => {
      // 读取失败后仍释放 reader；原读取错误由上层显示。
      void error;
    });
    reader.releaseLock();
  }
}

export { BootstrapSchema, type Bootstrap } from "../protocol/index.ts";
