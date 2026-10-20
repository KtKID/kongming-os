// 本地 frp 地址与访问设置的持久化、校验和数据隔离。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as settings from '../lib/settings.mjs';
import {
  getAccessToken,
  setCustomPin,
  credentialKindForHost,
} from '../lib/index.js';
import { PublicUrlSchema } from '../client/api.js';

test('frp 公网地址校验、标准化和持久化，局域网与密码设置各自保存', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'kmh-remote-settings-'));
  const prior = process.env.DSH_HOME;
  t.after(async () => {
    if (prior === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prior;
    await rm(home, { recursive: true, force: true });
  });
  process.env.DSH_HOME = home;
  assert.equal(settings.publicUrl(), '');
  assert.equal(
    settings.setPublicUrl('remote.example.com'),
    'https://remote.example.com/',
  );
  assert.equal(settings.publicUrl(), 'https://remote.example.com/');
  assert.throws(() => settings.setPublicUrl('file:///etc/passwd'));
  assert.throws(() =>
    settings.setPublicUrl('https://user:secret@remote.example.com'),
  );
  assert.equal(
    PublicUrlSchema.safeParse('https://remote.example.com/').success,
    true,
  );
  assert.equal(settings.lanEnabled(), true);
  settings.setLanEnabled(false);
  settings.setLanAuthEnabled(false);
  settings.setMobileRightbarEnabled(false);
  settings.setLanIpOverride('192.168.1.9');
  settings.setProxyPort(60001);
  assert.equal(settings.lanEnabled(), false);
  assert.equal(settings.lanAuthEnabled(), false);
  assert.equal(settings.mobileRightbarEnabled(), false);
  assert.equal(settings.lanIpOverride(), '192.168.1.9');
  assert.equal(settings.proxyPort(), 60001);
  assert.throws(() => settings.setLanIpOverride('999.1.1.1'));
  assert.equal(
    JSON.parse(await readFile(settings.settingsPath(), 'utf8')).publicUrl,
    'https://remote.example.com/',
  );
  const pin = getAccessToken();
  assert.match(pin, /^\d{8}$/);
  assert.equal(getAccessToken(), pin);
  assert.equal(credentialKindForHost('remote.example.com'), 'persistent');
  setCustomPin('public', 'Abc12345678');
  assert.equal(getAccessToken(), 'Abc12345678');
  assert.throws(() => setCustomPin('public', '123'));
  settings.resetSettings();
  assert.equal(settings.publicUrl(), '');
  assert.equal(settings.lanEnabled(), true);
});
