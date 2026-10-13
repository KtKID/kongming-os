/** 原生工具事实与准备失败从持久会话事件重放到对话。 */
import type {} from '@deepseek-ai/dsh-cli-tools/events';
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types';
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

type Observed = SessionEventMap['cli-tools/tool-observed'];
/** CLI 调用记录保留开始事实、受阻状态与最后结果。 */
export interface CliToolRecord extends Pick<Observed, 'target' | 'turn' | 'source' | 'name' | 'callId'> {
  readonly seq: number;
  readonly blocked: boolean;
  readonly input: Observed['data'];
  readonly result?: Observed['data'];
}
type Waiting = SessionEventMap['cli-tools/preparation-waiting'] & { readonly seq: number };
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Source-attributed CLI executor observation. */
    'cli-tool': CliToolRecord;
    /** Pending CLI preparation with its concrete failure reason. */
    'cli-preparation': Waiting;
  }
}

/** 同一 CLI、回合与调用身份关联其实际执行结果。 */
export const cliToolDefinition: ConversationNodeDefinition<CliToolRecord> = {
  kind: 'cli-tool', target: 'chat',
  match: event => event.type === 'cli-tools/tool-observed' ? { id: JSON.stringify([event.data.target, event.data.turn, event.data.callId]), role: event.data.kind === 'result' ? 'update' : 'start' } : null,
  start: (_context, match) => {
    if (match.event.type !== 'cli-tools/tool-observed') throw new Error('CLI_TOOL_RECORD_REQUIRES_OBSERVATION');
    const { target, turn, source, name, callId, kind, data } = match.event.data;
    return { target, turn, source, name, callId, seq: match.event.seq, blocked: kind === 'blocked', input: data };
  },
  update: (context, match) => match.event.type === 'cli-tools/tool-observed' && match.event.data.kind === 'result' ? { ...context.state, result: match.event.data.data } : context.state,
  buildViewNode: context => context.state === undefined ? null : {
    key: context.key, id: context.id, kind: 'cli-tool', target: 'chat', data: context.state,
    anchorSeq: context.state.seq, location: context.start?.location ?? { kind: 'unresolved' }, visibility: 'visible',
  },
};
/** 准备成功后收起对应的失败提示，历史事实继续保存在会话日志。 */
export const preparationDefinition: ConversationNodeDefinition<Waiting | undefined> = {
  kind: 'cli-preparation', target: 'chat',
  match: event => event.type === 'cli-tools/preparation-waiting' || event.type === 'cli-tools/turn-prepared' ? { id: JSON.stringify([event.data.target, event.data.turn, event.data.step]), role: event.type === 'cli-tools/preparation-waiting' ? 'start' : 'update' } : null,
  start: (_context, match) => match.event.type === 'cli-tools/preparation-waiting' ? { ...match.event.data, seq: match.event.seq } : undefined,
  update: (context, match) => match.event.type === 'cli-tools/turn-prepared' ? undefined : match.event.type === 'cli-tools/preparation-waiting' ? { ...match.event.data, seq: context.state?.seq ?? match.event.seq } : context.state,
  buildViewNode: context => context.state === undefined ? null : {
    key: context.key, id: context.id, kind: 'cli-preparation', target: 'chat', data: context.state,
    anchorSeq: context.state.seq, location: context.start?.location ?? { kind: 'unresolved' }, visibility: 'visible',
  },
};

/** 可折叠的实际 CLI 调用输入和输出。 */
export function ToolRecord({ node, t }: PropsRuntime<'conversation.chat.node', 'cli-tool'> & PropsLocale<'settings.codex-cli'>) {
  return <details style={{ color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' }}>
    <summary><code>{node.data.name}</code> · {node.data.source} · {t(node.data.blocked ? 'toolDisabled' : node.data.result === undefined ? 'toolRunning' : 'toolCompleted')}</summary>
    <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(node.data.input, null, 2)}</pre>
    {node.data.result !== undefined && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(node.data.result, null, 2)}</pre>}
  </details>;
}
/** 等待配置修正或重试的具体准备失败原因。 */
export function PreparationRecord({ node, t }: PropsRuntime<'conversation.chat.node', 'cli-preparation'> & PropsLocale<'settings.codex-cli'>) {
  return <p role="status" style={{ color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' }}>{t('preparationWaiting')} · {node.data.reason}</p>;
}
