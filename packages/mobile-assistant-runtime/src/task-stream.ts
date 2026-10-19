/** 沿用 DSH 公共累积器，为移动观察者保留当前生成前缀。 */
import type { AssistantStreamFrame } from "@deepseek-ai/dsh-agent";
import { AssistantStreamAccumulator } from "@deepseek-ai/dsh-llm";
import { NativeBaselineSchema, type NativeBaseline } from "./protocol.js";

export class TaskAssistantStream {
  private revision = 0;
  private active:
    | {
        attemptId: string;
        startedAfterSeq: number;
        turn: number;
        step: number;
        nextIndex: number;
        stream: AssistantStreamAccumulator;
      }
    | undefined;
  /** 输入公开原生帧与持久位置；密集次序中断时丢弃可恢复前缀，后续完整事件仍可接管。 */
  accept(frame: AssistantStreamFrame, cursor: number): void {
    if (frame.type === "start" && frame.revision === 1) {
      this.revision = 0;
      this.active = undefined;
    }
    if (frame.revision !== this.revision + 1) {
      this.revision = frame.revision;
      this.active = undefined;
      return;
    }
    this.revision = frame.revision;
    if (frame.type === "start")
      this.active = {
        attemptId: frame.attemptId,
        startedAfterSeq: cursor,
        turn: frame.turn,
        step: frame.step,
        nextIndex: 0,
        stream: new AssistantStreamAccumulator(),
      };
    else if (frame.type === "chunk") {
      if (
        this.active?.attemptId !== frame.attemptId ||
        this.active.nextIndex !== frame.index
      ) {
        this.active = undefined;
        return;
      }
      this.active.stream.push({ time: frame.time, chunk: frame.chunk });
      this.active.nextIndex++;
    } else this.active = undefined;
  }
  /** 输出不可变的当前原生基线；wire 校验保留原生附加资料。 */
  snapshot(): NativeBaseline {
    return NativeBaselineSchema.parse({
      revision: this.revision,
      ...(this.active === undefined
        ? {}
        : {
            activeAttempt: {
              ...this.active,
              stream: this.active.stream.snapshot(),
            },
          }),
    });
  }
}
