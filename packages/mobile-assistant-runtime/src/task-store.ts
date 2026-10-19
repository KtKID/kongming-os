/** 保存任务到 KMH 会话/消息的薄索引；串行原子写入，只记录定位信息。 */
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { TaskBindingSchema, type TaskBinding } from "./protocol.js";

export interface TaskStore {
  get(contextId: string, taskId: string): Promise<TaskBinding | undefined>;
  put(binding: TaskBinding): Promise<void>;
  listSession?(sessionId: string): Promise<TaskBinding[]>;
}

/** 配置给出绝对根目录；损坏记录和写入失败明确抛出，后续读取等待本任务的写入收尾。 */
export function createTaskStore(root: string): TaskStore {
  if (!isAbsolute(root)) throw new Error("移动任务索引目录必须是绝对路径");
  const writes = new Map<string, Promise<void>>();
  const file = (contextId: string, taskId: string): string =>
    join(
      root,
      createHash("sha256")
        .update(JSON.stringify([contextId, taskId]))
        .digest("hex") + ".json",
    );
  const read = async (path: string): Promise<TaskBinding | undefined> => {
    try {
      return TaskBindingSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return undefined;
      throw error;
    }
  };
  return {
    listSession: async (sessionId) => {
      await Promise.all(writes.values());
      let names: string[];
      try {
        names = await readdir(root);
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return [];
        throw error;
      }
      const rows = await Promise.all(
        names
          .filter((name) => name.endsWith(".json"))
          .map((name) => read(join(root, name))),
      );
      return rows.filter(
        (row): row is TaskBinding =>
          row !== undefined && row.internalSessionId === sessionId,
      );
    },
    get: async (contextId, taskId) => {
      const path = file(contextId, taskId);
      await writes.get(path);
      const value = await read(path);
      if (
        value !== undefined &&
        (value.contextId !== contextId || value.taskId !== taskId)
      )
        throw new Error("任务索引归属不匹配");
      return value;
    },
    put: (input) => {
      const binding = TaskBindingSchema.parse(input);
      const path = file(binding.contextId, binding.taskId);
      const write = (writes.get(path) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          const previous = await read(path);
          if (
            previous !== undefined &&
            (previous.messageId !== binding.messageId ||
              previous.internalSessionId !== binding.internalSessionId)
          )
            throw new Error("同一任务标识已绑定其他消息");
          const next = TaskBindingSchema.parse({
            ...previous,
            ...binding,
            ...(binding.turn === undefined && previous?.turn !== undefined
              ? { turn: previous.turn }
              : {}),
            admission:
              previous?.admission === "accepted"
                ? "accepted"
                : binding.admission,
          });
          await mkdir(root, { recursive: true, mode: 0o700 });
          const temporary = join(root, `.${randomUUID()}.tmp`);
          try {
            await writeFile(temporary, JSON.stringify(next) + "\n", {
              flag: "wx",
              mode: 0o600,
            });
            await rename(temporary, path);
          } finally {
            await unlink(temporary).catch((error: unknown) => {
              if (!(
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
              ))
                throw error;
            });
          }
        });
      writes.set(path, write);
      write
        .finally(() => {
          if (writes.get(path) === write) writes.delete(path);
        })
        .catch(() => undefined);
      return write;
    },
  };
}
