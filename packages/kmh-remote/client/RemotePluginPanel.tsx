// Remote 插件详情：复用设置面板，通过本机查询显示稳定分页和原始错误，切换保留草稿。
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  PageResultSchema,
  RECORDS_METHOD,
  recordFailure,
} from '../shared/access-records.ts';
import type {
  RecordPage,
  RecordFailure,
  RecordsCall,
} from '../shared/access-records.ts';

/** 查询当前 Home 的一页记录；旧请求取消或失效后保持当前界面状态。 */
export function RemotePluginPanel({
  settings,
  rpcCall,
  t,
}: {
  settings: ReactNode;
  rpcCall: RecordsCall;
  t: (key: string) => string;
}): ReactNode {
  const id = useId();
  const [tab, setTab] = useState<'settings' | 'records'>('settings');
  const [page, setPage] = useState<RecordPage | null>(null);
  const [error, setError] = useState<
    (RecordFailure & { saveError?: RecordFailure | null }) | null
  >(null);
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [position, setPosition] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const cursor = cursors[position];
  const nextCursor = page?.nextCursor;
  const saveError = error?.saveError ?? page?.saveError;
  useEffect(() => {
    if (tab !== 'records') return;
    const controller = new AbortController();
    const requestId = ++generation.current;
    setLoading(true);
    Promise.resolve()
      .then(() =>
        rpcCall(RECORDS_METHOD, cursor ? { cursor } : {}, controller.signal),
      )
      .then((raw) => {
        const result = PageResultSchema.parse(raw);
        if (controller.signal.aborted) return;
        if (result.ok) {
          setPage(result.value);
          setError(null);
        } else
          setError({
            code: result.error.code,
            desc: result.error.details.desc,
            saveError: result.error.details.saveError ?? null,
          });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(recordFailure(cause, 'REMOTE_RECORD_QUERY_FAILED', 'query'));
      })
      .finally(() => {
        if (!controller.signal.aborted && requestId === generation.current)
          setLoading(false);
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [tab, cursor, refresh, rpcCall]);
  const items = [
    {
      value: 'settings',
      label: t('recordsSettings'),
      id: `${id}-settings-tab`,
      panelId: `${id}-settings`,
    },
    {
      value: 'records',
      label: t('recordsTab'),
      id: `${id}-records-tab`,
      panelId: `${id}-records`,
    },
  ] satisfies [
    { value: 'settings'; label: string; id: string; panelId: string },
    { value: 'records'; label: string; id: string; panelId: string },
  ];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minWidth: 0,
        fontSize: 13,
        color: 'var(--dsw-alias-label-primary)',
      }}
    >
      <SegmentedTabs
        items={items}
        value={tab}
        onChange={setTab}
        label={t('recordsTab')}
      />
      <div
        id={`${id}-settings`}
        role="tabpanel"
        aria-labelledby={`${id}-settings-tab`}
        hidden={tab !== 'settings'}
      >
        {settings}
      </div>
      <div
        id={`${id}-records`}
        role="tabpanel"
        aria-labelledby={`${id}-records-tab`}
        hidden={tab !== 'records'}
      >
        {page && (
          <p>
            {page.homeLabel} · {t('recordsStart')}
          </p>
        )}
        {error && (
          <div
            role="alert"
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {t('recordsLoadFailed')} · {error.code}: {error.desc}
            {page && <p>{t('recordsOld')}</p>}
          </div>
        )}
        {saveError && (
          <div
            role="alert"
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {t('recordsSaveFailed')} · {saveError.code}: {saveError.desc}
            {page?.recovered && !error?.saveError && (
              <p>{t('recordsRecovered')}</p>
            )}
          </div>
        )}
        {loading && (
          <div
            role="status"
            aria-label={t('recordsLoading')}
            style={{
              minHeight: 32,
              background: 'var(--dsw-alias-fill-tertiary)',
              borderRadius: 6,
            }}
          />
        )}
        <div
          data-access-records-list
          style={{
            maxHeight: 420,
            overflowY: 'auto',
            overflowWrap: 'anywhere',
          }}
          aria-busy={loading}
        >
          {page?.records.length === 0 && !error && <p>{t('recordsEmpty')}</p>}
          {page?.records.map((record) => (
            <article
              key={record.sequence}
              style={{
                padding: '12px 4px',
                borderBottom: '1px solid var(--dsw-alias-border-l2)',
              }}
            >
              <div>
                {record.occurredAt
                  .replace('T', ' ')
                  .replace(/([+-]\d\d:\d\d)$/, ' $1')}{' '}
                · {record.timeZone}
              </div>
              <div>
                {record.peerAddress ?? t('recordsUnknownSource')}
                {record.sourceNote && ` · ${record.sourceNote}`}
              </div>
              {record.claimedAddresses.map((claim) => (
                <div key={claim.address}>
                  {claim.address} · {t('recordsUnverified')}
                </div>
              ))}
              <div>
                {t('recordsEvent')} ·{' '}
                {t(
                  record.entryKind === 'public'
                    ? 'recordsPublic'
                    : 'recordsLan',
                )}{' '}
                ·{' '}
                {t(
                  record.outcome === 'success'
                    ? 'recordsSuccess'
                    : 'recordsFailure',
                )}
              </div>
              {record.outcome === 'failure' && (
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  {record.error.code}: <span>{record.error.desc}</span>
                </div>
              )}
            </article>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, paddingTop: 12 }}>
          <Button
            disabled={loading || position === 0}
            onClick={() => setPosition((value) => value - 1)}
          >
            {t('recordsPrevious')}
          </Button>
          <Button
            disabled={loading || !page?.nextCursor}
            onClick={
              nextCursor
                ? () => {
                    setCursors((values) => [
                      ...values.slice(0, position + 1),
                      nextCursor,
                    ]);
                    setPosition((value) => value + 1);
                  }
                : undefined
            }
          >
            {t('recordsNext')}
          </Button>
          <Button
            disabled={loading}
            onClick={() => {
              setCursors([undefined]);
              setPosition(0);
              setRefresh((value) => value + 1);
            }}
          >
            {t('recordsRefresh')}
          </Button>
        </div>
      </div>
    </div>
  );
}
