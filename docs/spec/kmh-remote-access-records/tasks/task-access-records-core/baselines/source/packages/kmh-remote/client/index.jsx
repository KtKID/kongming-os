// KMH Remote 设置与移动布局：本地鉴权代理连接现有 frp 公网入口。
import { createElement as h, useEffect, useState } from 'react';
import {
  Button,
  Input,
  Switch,
  Modal,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives';
import {
  POCKET_RPC_CHANNEL,
  POCKET_ENDPOINTS,
  MOBILE_RIGHTBAR_ATTRIBUTE,
  MOBILE_RIGHTBAR_EVENT,
  RemoteStatusSchema,
} from './api.js';
import { mobileApply } from './mobile/mobile-apply.tsx';
import { NS, zh, en } from './pocket-locales.js';

const name = '@kmh/remote';
const inject = ['slots', 'connection', 'layout', 'locale'];
const NOTICE_EVENT = 'kmh-remote:notice';
const style = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    maxWidth: 560,
    fontSize: 13,
    color: 'var(--dsw-alias-label-primary)',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingTop: 16,
    borderTop: '1px solid var(--dsw-alias-border-l2)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  hint: {
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: 12,
    lineHeight: 1.6,
  },
  error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 },
  code: { overflowWrap: 'anywhere', fontFamily: 'monospace' },
  qr: { width: 180, height: 180, alignSelf: 'center' },
};

/** 操作反馈交由长驻 shell overlay 承载。 */
function notify(text) {
  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: text }));
}

/** 挂在 shell 的反馈组件，设置页关闭后仍完成显示。 */
function RemoteNotice() {
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    const receive = (event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string')
        setNotice({ text: event.detail, key: Date.now() });
    };
    window.addEventListener(NOTICE_EVENT, receive);
    return () => window.removeEventListener(NOTICE_EVENT, receive);
  }, []);
  return notice
    ? h(Toast, {
        key: notice.key,
        text: notice.text,
        onDone: () => setNotice(null),
      })
    : null;
}

/** 手机访问设置；所有写入通过带宿主信任检查的 RPC 完成。 */
function RemoteSettings({ rpcCall, t }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [publicDraft, setPublicDraft] = useState('');
  const [lanDraft, setLanDraft] = useState('');
  const [pinEditor, setPinEditor] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);

  const request = async (endpoint, payload, signal) => {
    const response = await rpcCall(endpoint, payload, signal);
    if (!response?.ok)
      throw new Error(response?.error?.message ?? t('loadFailed'));
    // 写入响应包含各操作的结果；统一回读完整状态，供表单、密码与二维码共同刷新。
    if (endpoint !== POCKET_ENDPOINTS.status)
      return request(POCKET_ENDPOINTS.status, {}, signal);
    return RemoteStatusSchema.parse(response.value);
  };
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = () =>
      request(POCKET_ENDPOINTS.status, {}, controller.signal)
        .then((next) => {
          if (alive) {
            setStatus(next);
            setError('');
          }
        })
        .catch((reason) => {
          if (alive)
            setError(
              reason instanceof Error ? reason.message : t('loadFailed'),
            );
        });
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    setPublicDraft(status?.publicUrl ?? '');
  }, [status?.publicUrl]);
  useEffect(() => {
    setLanDraft(status?.lanIpOverride ?? '');
  }, [status?.lanIpOverride]);

  const save = async (endpoint, payload) => {
    setBusy(true);
    setError('');
    try {
      const next = await request(endpoint, payload);
      setStatus(next);
      notify(t('saved'));
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('saveFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const setRightbar = async (enabled) => {
    if (
      await save(POCKET_ENDPOINTS.mobileRightbarSetEnabled, { on: enabled })
    ) {
      document.body?.setAttribute(
        MOBILE_RIGHTBAR_ATTRIBUTE,
        enabled ? 'on' : 'off',
      );
      window.dispatchEvent(
        new CustomEvent(MOBILE_RIGHTBAR_EVENT, { detail: { enabled } }),
      );
    }
  };
  const row = (label, control) =>
    h('div', { style: style.row }, h('span', null, label), control);
  const pin = (kind, value) =>
    h(
      'div',
      { style: style.row },
      h('code', { style: style.code }, value ?? '—'),
      h(
        Button,
        {
          size: 'sm',
          onClick: () => setPinEditor({ kind, value: '' }),
          disabled: busy,
        },
        t('setPassword'),
      ),
    );
  const qr = (src, url) =>
    src
      ? h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('img', { src, alt: t('qr'), style: style.qr }),
          h('code', { style: style.code }, url),
        )
      : null;

  if (!status)
    return h(
      'div',
      { style: style.page, role: 'status' },
      error || t('loading'),
    );
  return h(
    'div',
    { style: style.page },
    h(
      'div',
      null,
      h('strong', { style: { fontWeight: 500 } }, t('title')),
      h('p', { style: style.hint }, t('subtitle')),
    ),
    h(
      'section',
      { style: style.section },
      row(t('localProxy'), h('code', null, status.proxyPort ?? '—')),
      h('div', { style: style.hint }, t('proxyHint')),
      row(
        t('lanAccess'),
        h(Switch, {
          label: t('lanAccess'),
          checked: status.lanEnabled,
          disabled: busy,
          onChange: (enabled) =>
            save(POCKET_ENDPOINTS.lanSetEnabled, { on: enabled }),
        }),
      ),
      status.lanEnabled ? qr(status.lanQr, status.lanUrl) : null,
      row(
        t('lanPassword'),
        h(Switch, {
          label: t('lanPassword'),
          checked: status.lanAuthEnabled,
          disabled: busy,
          onChange: (enabled) =>
            save(POCKET_ENDPOINTS.lanAuthSetEnabled, { on: enabled }),
        }),
      ),
      status.lanAuthEnabled ? pin('lan', status.lanToken) : null,
      h(
        'label',
        null,
        t('lanIp'),
        h(Input, {
          value: lanDraft,
          placeholder: t('autoIp'),
          onChange: (event) => setLanDraft(event.target.value),
          'aria-label': t('lanIp'),
        }),
      ),
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          disabled: busy,
          onClick: () =>
            save(POCKET_ENDPOINTS.lanSetOverride, { ip: lanDraft }),
        },
        t('saveIp'),
      ),
    ),
    h(
      'section',
      { style: style.section },
      h('strong', { style: { fontWeight: 500 } }, t('frpTitle')),
      h('div', { style: style.hint }, t('frpHint')),
      h(
        'label',
        null,
        t('publicUrl'),
        h(Input, {
          value: publicDraft,
          placeholder: 'https://remote.example.com/',
          onChange: (event) => setPublicDraft(event.target.value),
          'aria-label': t('publicUrl'),
        }),
      ),
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          disabled: busy,
          onClick: () =>
            save(POCKET_ENDPOINTS.publicSetUrl, { url: publicDraft }),
        },
        t('saveUrl'),
      ),
      qr(status.publicQr, status.publicUrl),
      h('span', null, t('publicPassword')),
      pin('public', status.accessToken),
    ),
    h(
      'section',
      { style: style.section },
      row(
        t('rightbar'),
        h(Switch, {
          label: t('rightbar'),
          checked: status.mobileRightbarEnabled,
          disabled: busy,
          onChange: setRightbar,
        }),
      ),
      h(
        Button,
        {
          variant: 'outline',
          size: 'sm',
          onClick: () => setResetOpen(true),
          disabled: busy,
        },
        t('reset'),
      ),
    ),
    error ? h('div', { role: 'alert', style: style.error }, error) : null,
    pinEditor
      ? h(
          Modal,
          {
            open: true,
            title: t('setPassword'),
            closeLabel: t('cancel'),
            onClose: () => setPinEditor(null),
          },
          h(
            'div',
            { style: style.page },
            h('div', { style: style.hint }, t('pinHint')),
            h(Input, {
              type: 'password',
              value: pinEditor.value,
              'aria-label': t('newPassword'),
              autoComplete: 'new-password',
              onChange: (event) =>
                setPinEditor({ ...pinEditor, value: event.target.value }),
            }),
            h(
              Button,
              {
                variant: 'primary',
                disabled: busy,
                onClick: async () => {
                  if (
                    await save(POCKET_ENDPOINTS.pinSetCustom, {
                      which: pinEditor.kind,
                      value: pinEditor.value,
                    })
                  )
                    setPinEditor(null);
                },
              },
              t('save'),
            ),
          ),
        )
      : null,
    resetOpen
      ? h(
          Modal,
          {
            open: true,
            title: t('reset'),
            closeLabel: t('cancel'),
            onClose: () => setResetOpen(false),
          },
          h(
            'div',
            { style: style.page },
            h('p', null, t('resetHint')),
            h(
              Button,
              {
                variant: 'primary',
                disabled: busy,
                onClick: async () => {
                  if (
                    await save(POCKET_ENDPOINTS.pocketReset, { confirm: true })
                  )
                    setResetOpen(false);
                },
              },
              t('confirm'),
            ),
          ),
        )
      : null,
  );
}

/** 注册设置页、插件详情与移动端布局，并让 Cordis 管理卸载。 */
export function apply(ctx) {
  mobileApply(ctx);
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'kmh-remote: dictionaries',
  );
  const t = ctx.locale.bind(NS);
  const rpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(POCKET_RPC_CHANNEL, endpoint, payload, signal);
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'kmh-remote',
        order: 1,
        label: () => t('section'),
        inject: () => ({ rpcCall, t }),
      },
      RemoteSettings,
    ),
  );
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'kmh-remote-notice', order: 20 },
      RemoteNotice,
    ),
  );
  const renderConfig = ({ view, rpcCall, t }) =>
    view === 'page' ? h(RemoteSettings, { rpcCall, t }) : null;
  for (const [slot, key] of [
    ['plugins.bundle.config', name],
    ['plugins.row.config', `${name}#kmh-remote`],
  ]) {
    ctx.slots.inject(slot, () =>
      ctx.slots.register(
        { name: slot, key, inject: () => ({ rpcCall, t }) },
        renderConfig,
      ),
    );
  }
}
export { name, inject };
