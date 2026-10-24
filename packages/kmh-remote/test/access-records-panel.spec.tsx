// @vitest-environment jsdom
// VIEW-01—04：真实 React 组件、异步查询和分页状态；文件与权限链路由后端用例执行。
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccessRecords } from '../host/access-records.ts';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { RemotePluginPanel } from '../client/RemotePluginPanel.tsx';
import { apply as applyClient } from '../client/index.jsx';
vi.mock('../client/mobile/mobile-apply.tsx', () => ({ mobileApply: () => {} }));
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props) => <button {...props} />,
  SegmentedTabs: ({ items, value, onChange }) => (
    <div role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));
const disposals: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  cleanup();
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});
async function fileFixture(options = {}) {
  const home = await fs.mkdtemp(join(tmpdir(), 'kmh-records-view-'));
  disposals.push(() => fs.rm(home, { recursive: true, force: true }));
  const store = createAccessRecords({ home, ...options });
  disposals.push(() => store.close());
  return { store, home, directory: join(home, 'logs/.kmh-remote') };
}
const labels = {
  recordsSettings: '访问设置',
  recordsTab: '访问记录',
  recordsEmpty: '暂无访问记录',
  recordsPrevious: '上一页',
  recordsNext: '下一页',
  recordsRefresh: '刷新',
  recordsOld: '此前结果',
  recordsLoadFailed: '读取失败',
  recordsStart: '正式记录起点',
  recordsSuccess: '成功',
  recordsFailure: '失败',
  recordsPublic: '公网',
  recordsLan: '局域网',
  recordsEvent: '密码登录',
};
const t = (key: string) => labels[key] ?? key;
const row = (n: number) => ({
  version: 1,
  sequence: String(n),
  occurredAt: '2026-10-22T23:08:09.007+08:00',
  timeZone: 'Asia/Shanghai',
  event: 'password-attempt',
  peerAddress: `192.0.2.${n}`,
  claimedAddresses: [],
  entryKind: 'public',
  outcome: n % 2 ? 'success' : 'failure',
  ...(n % 2 ? {} : { error: { code: 'WRONG', desc: '原始错误\n细节' } }),
});
const page = (records, nextCursor = null) => ({
  ok: true,
  value: {
    records,
    nextCursor,
    homeLabel: 'fixture-home',
    saveError: null,
    recovered: false,
  },
});
async function open(
  rpcCall,
  settings = <input aria-label="设置草稿" defaultValue="原值" />,
) {
  render(<RemotePluginPanel rpcCall={rpcCall} t={t} settings={settings} />);
  fireEvent.click(screen.getByRole('tab', { name: '访问记录' }));
}
test('VIEW-01 详情字段、顺序和设置草稿保留', async () => {
  const slots = new Map();
  applyClient({
    effect: (fn) => fn(),
    locale: { register: () => () => {}, bind: () => t },
    connection: { rpc: { call: async () => page([]) } },
    slots: {
      inject: (_name, fn) => fn(),
      register: (meta, component) => {
        slots.set(meta.name, { meta, component });
        return () => {};
      },
    },
  });
  for (const name of ['plugins.bundle.config', 'plugins.row.config']) {
    const { component } = slots.get(name);
    expect(
      component({ view: 'page', rpcCall: async () => page([]), t }).type,
    ).toBe(RemotePluginPanel);
    expect(component({ view: 'inline', t })).toBeNull();
  }
  const value = page([
    {
      ...row(2),
      entryKind: 'lan',
      peerAddress: null,
      sourceNote: '未知来源',
      claimedAddresses: [{ address: '203.0.113.1', trust: 'unverified' }],
    },
    row(1),
  ]);
  value.value.saveError = { code: 'EIO', desc: '此前保存失败' };
  value.value.recovered = true;
  const rpc = vi.fn(async () => value);
  render(
    <RemotePluginPanel
      rpcCall={rpc}
      t={t}
      settings={<input aria-label="设置草稿" />}
    />,
  );
  fireEvent.change(screen.getByLabelText('设置草稿'), {
    target: { value: '保留草稿' },
  });
  fireEvent.click(screen.getByRole('tab', { name: '访问记录' }));
  await screen.findByText('203.0.113.1 · recordsUnverified');
  expect(
    screen.getByText('原始错误\n细节', { collapseWhitespace: false }),
  ).toBeTruthy();
  expect(screen.getAllByText(/23:08:09.007/)).toHaveLength(2);
  fireEvent.click(screen.getByRole('tab', { name: '访问设置' }));
  expect(screen.getByLabelText('设置草稿').value).toBe('保留草稿');
});
test('VIEW-02 空页说明及翻页边界', async () => {
  const f = await fileFixture();
  await fs.mkdir(f.directory, { recursive: true });
  await fs.writeFile(join(f.directory, '2020-01-01.log'), '');
  await fs.writeFile(join(f.directory, '2020-01-02.log'), '');
  await open((_endpoint, payload, signal) => f.store.list(payload, signal));
  await screen.findByText('暂无访问记录');
  expect(screen.getByText(new RegExp(f.home))).toBeTruthy();
  expect(screen.getByRole('button', { name: '上一页' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: '下一页' }).disabled).toBe(true);
});
test('VIEW-03 每页十条、旧集合分页与刷新', async () => {
  for (const count of [1, 10, 11, 20, 21]) {
    const { store } = await fileFixture();
    for (let i = 1; i <= count; i++)
      await store.save({
        peerAddress: `192.0.2.${i}`,
        claimedAddresses: [],
        entryKind: 'public',
        outcome: 'success',
      });
    await open((_endpoint, payload, signal) => store.list(payload, signal));
    await screen.findByText(`192.0.2.${count}`);
    await store.save({
      peerAddress: '192.0.2.99',
      claimedAddresses: [],
      entryKind: 'public',
      outcome: 'success',
    });
    let viewed = Math.min(10, count);
    while (!screen.getByRole('button', { name: '下一页' }).disabled) {
      fireEvent.click(screen.getByRole('button', { name: '下一页' }));
      await screen.findByText(`192.0.2.${count - viewed}`);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '刷新' }).disabled).toBe(
          false,
        ),
      );
      viewed += Math.min(10, count - viewed);
    }
    expect(viewed).toBe(count);
    expect(screen.queryByText('192.0.2.99')).toBeNull();
    if (count > 10) {
      fireEvent.click(screen.getByRole('button', { name: '上一页' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '下一页' }).disabled).toBe(
          false,
        ),
      );
    }
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await screen.findByText('192.0.2.99');
    expect(screen.getByRole('button', { name: '上一页' }).disabled).toBe(true);
    cleanup();
    const first = await store.list();
    if (first.ok && first.value.nextCursor) {
      const cursor = JSON.parse(
        Buffer.from(first.value.nextCursor, 'base64url').toString('utf8'),
      );
      for (const change of [
        { instance: 'wrong' },
        { file: '../../outside.log' },
        { cutoff: '999999' },
        { offset: 999999999 },
      ]) {
        const result = await store.list({
          cursor: Buffer.from(
            JSON.stringify({ ...cursor, ...change }),
          ).toString('base64url'),
        });
        expect(result.ok).toBe(false);
      }
      const controller = new AbortController();
      controller.abort();
      expect((await store.list({}, controller.signal)).ok).toBe(false);
      const oldCursor = { ...cursor, cutoff: '0' };
      expect(
        (
          await store.list({
            cursor: Buffer.from(JSON.stringify(oldCursor)).toString(
              'base64url',
            ),
          })
        ).ok,
      ).toBe(true);
    }
  }
  const history = await fileFixture();
  await fs.mkdir(history.directory, { recursive: true });
  for (let i = 1; i <= 21; i++)
    await fs.writeFile(
      join(history.directory, `2026-09-${String(i).padStart(2, '0')}.log`),
      JSON.stringify({
        ...row(i),
        occurredAt: `2026-10-${i < 11 ? '23' : '22'}T23:08:09.007+08:00`,
      }) + '\n',
    );
  await open((_endpoint, payload, signal) =>
    history.store.list(payload, signal),
  );
  await screen.findByText('192.0.2.21');
  for (const last of [11, 1]) {
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText(`192.0.2.${last}`);
  }
  expect(screen.getByRole('button', { name: '下一页' }).disabled).toBe(true);
  cleanup();
  for (const rejected of [false, true]) {
    let settle;
    let calls = 0;
    const rpc = () =>
      ++calls === 1
        ? new Promise((resolve, reject) => {
            settle = rejected ? reject : resolve;
          })
        : Promise.resolve(page([row(1)]));
    await open(rpc);
    await waitFor(() => expect(calls).toBe(1));
    fireEvent.click(screen.getByRole('tab', { name: '访问设置' }));
    fireEvent.click(screen.getByRole('tab', { name: '访问记录' }));
    await screen.findByText('192.0.2.1');
    await act(async () => {
      settle(rejected ? new Error('过期请求失败') : page([row(99)]));
    });
    expect(screen.queryByText('192.0.2.99')).toBeNull();
    cleanup();
  }
});
test('VIEW-04 读取错误保留旧页和原文，恢复后刷新', async () => {
  let failing = false;
  const rpc = vi.fn(async () =>
    failing
      ? {
          ok: false,
          error: {
            code: 'EACCES',
            message: '原始读取错误\n细节',
            details: { desc: '原始读取错误\n细节' },
          },
        }
      : page([row(1)]),
  );
  await open(rpc);
  await screen.findByText('192.0.2.1');
  failing = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await screen.findByText(/EACCES/);
  expect(screen.getByText('192.0.2.1')).toBeTruthy();
  expect(screen.getByText(/此前结果/)).toBeTruthy();
  failing = false;
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(screen.queryByText(/EACCES/)).toBeNull());

  cleanup();
  for (const cause of [new Error('原始传输错误'), '原始非 Error 错误', null]) {
    await open(async () => {
      if (cause !== null) throw cause;
      return null;
    });
    await screen.findByText(/REMOTE_RECORD_QUERY_FAILED/);
    expect(screen.queryByText('暂无访问记录')).toBeNull();
    cleanup();
  }
  for (const initial of [true, false])
    for (const operation of ['open', 'read', 'json', 'schema']) {
      let failing = false;
      const injected = {
        ...fs,
        open: async (...args) => {
          if (failing && operation === 'open')
            throw Object.assign(new Error('打开原文\n细节'), {
              code: 'EACCES',
            });
          const handle = await fs.open(...args);
          const read = handle.read.bind(handle);
          handle.read = async (...values) => {
            if (failing && operation === 'read')
              throw Object.assign(new Error('读取原文\n细节'), { code: 'EIO' });
            return read(...values);
          };
          return handle;
        },
      };
      const f = await fileFixture({ fs: injected });
      await f.store.save({
        peerAddress: '192.0.2.1',
        claimedAddresses: [],
        entryKind: 'public',
        outcome: 'success',
      });
      const file = join(f.directory, (await fs.readdir(f.directory))[0]);
      const original = await fs.readFile(file);
      if (!initial) {
        await open((_endpoint, payload, signal) =>
          f.store.list(payload, signal),
        );
        await screen.findByText('192.0.2.1');
      }
      failing = true;
      if (operation === 'json')
        await fs.writeFile(
          file,
          Buffer.concat([Buffer.from('!'), original.subarray(1)]),
        );
      if (operation === 'schema')
        await fs.writeFile(
          file,
          Buffer.from(
            original.toString().replace('"version":1', '"version":9'),
          ),
        );
      const expected = await f.store.list();
      expect(expected.ok).toBe(false);
      const unchanged = await fs.readFile(file);
      if (initial)
        await open((_endpoint, payload, signal) =>
          f.store.list(payload, signal),
        );
      else fireEvent.click(screen.getByRole('button', { name: '刷新' }));
      await screen.findByText((text) => text.includes(expected.error.code));
      expect(
        screen.getByText(expected.error.details.desc, {
          exact: false,
          collapseWhitespace: false,
        }),
      ).toBeTruthy();
      expect(screen.queryByText('暂无访问记录')).toBeNull();
      if (!initial) {
        expect(screen.getByText('192.0.2.1')).toBeTruthy();
        expect(screen.getByText(/此前结果/)).toBeTruthy();
      }
      expect(await fs.readFile(file)).toEqual(unchanged);
      failing = false;
      await fs.writeFile(file, original);
      fireEvent.click(screen.getByRole('button', { name: '刷新' }));
      await waitFor(() =>
        expect(
          screen.queryByText((text) => text.includes(expected.error.code)),
        ).toBeNull(),
      );
      cleanup();
    }
  const blocked = await fileFixture({
    fs: {
      ...fs,
      lstat: async () => {
        throw Object.assign(new Error('原始保存与查询故障'), {
          code: 'EACCES',
        });
      },
    },
  });
  expect(
    (
      await blocked.store.save({
        peerAddress: null,
        claimedAddresses: [],
        entryKind: 'lan',
        outcome: 'success',
      })
    ).ok,
  ).toBe(false);
  await open((_endpoint, payload, signal) =>
    blocked.store.list(payload, signal),
  );
  await screen.findByText(/recordsSaveFailed.*EACCES/);
  expect(screen.getAllByText(/原始保存与查询故障/)).toHaveLength(2);
  cleanup();
});
