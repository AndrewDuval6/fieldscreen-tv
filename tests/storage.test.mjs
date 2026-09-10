import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createVault, configurePasswordStore } = require('../desktop/vault.cjs');
const { startLocalServer } = require('../desktop/iptv.cjs');
const fakeStorage = () => ({
  isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'kwallet6',
  encryptString: value => Buffer.from(Buffer.from(value).toString('base64')),
  decryptString: value => Buffer.from(value.toString(), 'base64').toString(),
});

test('Linux storage selection supports standalone desktops and preserves KDE and explicit overrides', () => {
  for (const [platform, env, override, expected] of [
    ['linux', { XDG_CURRENT_DESKTOP: 'Hyprland' }, false, 'gnome-libsecret'],
    ['linux', { XDG_CURRENT_DESKTOP: 'KDE', KDE_SESSION_VERSION: '6' }, false, null],
    ['linux', { DESKTOP_SESSION: 'plasma' }, false, null],
    ['linux', { XDG_CURRENT_DESKTOP: 'Hyprland' }, true, null],
    ['darwin', {}, false, null],
  ]) {
    let selected = null;
    configurePasswordStore({ hasSwitch: () => override, appendSwitch: (name, value) => { assert.equal(name, 'password-store'); selected = value; } }, platform, env, () => '');
    assert.equal(selected, expected);
  }
  let selected;
  configurePasswordStore({ hasSwitch: () => false, appendSwitch: (_, value) => { selected = value; } }, 'linux', { XDG_CURRENT_DESKTOP: 'gamescope' }, () => 'org.kde.kwalletd6 - - - (activatable)');
  assert.equal(selected, 'kwallet6');
});

test('Every vault verifies encryption and disk roundtrip, retries locked storage, and detects unwritable storage', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fieldscreen-storage-'));
  try {
    const safe = fakeStorage(), vault = createVault(path.join(dir, 'provider.enc'), safe, 'linux');
    safe.getSelectedStorageBackend = () => 'basic_text';
    assert.equal((await vault.verify()).state, 'unavailable');
    safe.getSelectedStorageBackend = () => 'gnome_libsecret';
    assert.equal((await vault.verify(true)).state, 'ready');
    assert.deepEqual(await readdir(dir), [], 'storage probe must be removed');
    safe.decryptString = () => { throw new Error('locked'); };
    assert.equal((await vault.verify(true)).state, 'unavailable');
    const blocked = path.join(dir, 'not-a-directory'); await writeFile(blocked, 'fixture');
    assert.equal((await createVault(path.join(blocked, 'provider.enc'), fakeStorage(), 'linux').verify()).state, 'unwritable');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Remember an existing connection, reopen the encrypted provider with its guide, and forget it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fieldscreen-remember-')), file = path.join(dir, 'provider.enc');
  const makeService = () => startLocalServer({ vault: createVault(file, fakeStorage(), 'linux') });
  let service = await makeService();
  const request = async (route, data) => {
    const response = await fetch(new URL('iptv/' + route, service.url), { method: data === undefined ? 'GET' : 'POST', headers: { 'X-FieldScreen': '1', 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    assert.equal(response.status, 200); return response.json();
  };
  const config = { type: 'm3u', playlist: '#EXTM3U\n#EXTINF:-1,Fixture channel\nhttps://stream.example/private-token.m3u8', guideUrl: 'https://guide.example/private-token' };
  try {
    assert.equal((await request('check-storage', {})).canRemember, true);
    const initial = await request('connect', config); assert.equal(initial.saved, false);
    const saved = await request('remember', {}); assert.equal(saved.saved, true);
    assert.equal(saved.channels[0].stream, initial.channels[0].stream, 'saving must not restart playback');
    assert.doesNotMatch(JSON.stringify(saved), /private-token|guide\.example/);
    assert.doesNotMatch((await readFile(file)).toString(), /private-token/);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    service.close(); service = await makeService();
    assert.equal((await request('status')).saved, true);
    assert.equal((await request('resume', {})).hasGuide, true);
    const loaded = await createVault(file, fakeStorage(), 'linux').load();
    assert.equal(loaded.guideUrl, config.guideUrl); assert.equal(loaded.playlist, config.playlist);
    await request('disconnect', {}); assert.equal((await request('status')).saved, false);
    await writeFile(file, 'unreadable');
    const damaged = await request('status'); assert.equal(damaged.saved, false); assert.equal(damaged.storage.savedUnreadable, true);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});
