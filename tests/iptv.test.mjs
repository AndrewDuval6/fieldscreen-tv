import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { filterChannels, currentProgram, nextProgram, reconcilePlayers } from '../scripts/iptv-core.mjs';
const require = createRequire(import.meta.url);
const { parseM3U, rewriteManifest, webURL, startLocalServer } = require('../desktop/iptv.cjs');
const { parseGuide, xmltvTime } = require('../desktop/guide.cjs');
const { createVault } = require('../desktop/vault.cjs');

test('M3U handles quoted commas, EPG IDs, relative links, duplicates, and unsafe entries', () => {
  const result = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-id="sports.1" group-title="Sports, US",Chiefs vs. Bills\n../live/game.m3u8\n#EXTINF:-1,duplicate\n../live/game.m3u8\n#EXTINF:-1,bad\nfile:///private\n#EXTINF:-1,Another\nhttps://tv.example/2.m3u8', 'https://tv.example/list/guide.m3u');
  assert.equal(result.length, 2); assert.equal(result[0].name, 'Chiefs vs. Bills'); assert.equal(result[0].group, 'Sports, US'); assert.equal(result[0].epgId, 'sports.1'); assert.equal(result[0].url, 'https://tv.example/live/game.m3u8');
  assert.throws(() => parseM3U('<html>Login failed</html>'));
  assert.throws(() => parseM3U('#EXTM3U\n#EXT-X-TARGETDURATION:6\nsegment.ts'));
  assert.throws(() => webURL('javascript:alert(1)'));
});

test('HLS proxy rewrites variants, encryption keys, init segments, and media tracks', () => {
  const urls = [];
  const output = rewriteManifest('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="../key?k=secret"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nsegment.ts?sig=private\n', 'https://provider.example/live/master.m3u8', u => { urls.push(u); return '/private/' + urls.length; });
  assert.equal(urls[0], 'https://provider.example/live/audio/index.m3u8'); assert.equal(urls[1], 'https://provider.example/key?k=secret');
  assert.match(output, /URI="\/private\/3"/); assert.match(output, /\/private\/4/); assert.doesNotMatch(output, /secret|provider|sig=/);
  assert.throws(() => rewriteManifest('#EXTM3U\nfile:///private', 'https://example.com/', x => x));
});

test('XMLTV joins channel IDs and parses timezones, entities, CDATA, now/next', async () => {
  const now = Date.UTC(2026, 8, 9, 20, 0);
  assert.equal(xmltvTime('20260909160000 -0400'), now);
  assert.equal(xmltvTime('20260910013000 +0530'), now);
  const xml = '<?xml version="1.0"?><tv><programme channel="s1" start="20260909153000 -0400" stop="20260909183000 -0400"><title>Chiefs &amp; Bills</title><desc><![CDATA[NFL live coverage]]></desc><category>Sports</category></programme><programme channel="s1" start="20260909183000 -0400" stop="20260909200000 -0400"><title>Postgame</title></programme><programme channel="other" start="20260909150000 -0400" stop="20260909180000 -0400"><title>Other</title></programme></tv>';
  const guide = await parseGuide(Readable.from([Buffer.from(xml)]), new Set(['s1']), now);
  assert.equal(guide.size, 1); assert.equal(guide.get('s1').length, 2);
  const channel = { id: 'one', name: 'Sports channel', group: 'USA', programs: guide.get('s1') };
  assert.equal(currentProgram(channel, now).title, 'Chiefs & Bills'); assert.equal(nextProgram(channel, now).title, 'Postgame');
  assert.equal(filterChannels([channel], { query: 'bills', filter: 'football', now }).length, 1);
  assert.equal(filterChannels([channel], { query: 'soccer', now }).length, 0);
  assert.equal(filterChannels([channel], { filter: 'now', now: now + 86400000 }).length, 0);
  await assert.rejects(parseGuide(Readable.from(['<!DOCTYPE tv [<!ENTITY x SYSTEM "file:///etc/passwd">]><tv/>']), new Set()));
});

test('Players survive promotion and audio/layout redraws; hidden and disconnected feeds stop', () => {
  const channels = [0, 1, 2, 3].map(id => ({ id })); let created = 0; const stopped = [];
  const create = channel => ({ channel, identity: ++created }); const destroy = player => stopped.push(player.identity);
  const desired = ids => ids.map((id, slot) => ({ slot, channel: channels[id] }));
  let players = reconcilePlayers([], desired([0, 1, 2, 3]), create, destroy);
  const first = players[0], second = players[1];
  players = reconcilePlayers(players, desired([1, 0, 2, 3]), create, destroy);
  assert.equal(players[0], second); assert.equal(players[1], first); assert.equal(created, 4);
  players = reconcilePlayers(players, desired([1, 0]), create, destroy);
  assert.deepEqual(stopped, [3, 4]);
  players = reconcilePlayers(players, [], create, destroy); assert.equal(players.length, 0); assert.equal(stopped.length, 4);
  players = reconcilePlayers([], desired([0, 0]), create, destroy); assert.notEqual(players[0], players[1]);
});

test('Provider secrets persist only with an OS keyring; disconnect deletes the saved file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fieldscreen-vault-'));
  const file = path.join(dir, 'provider.enc');
  try {
    const safe = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text', encryptString: text => Buffer.from('encrypted:' + Buffer.from(text).toString('base64')), decryptString: buf => Buffer.from(buf.toString().slice(10), 'base64').toString() };
    const vault = createVault(file, safe, 'linux'); assert.equal(vault.available(), false); await assert.rejects(vault.save({ password: 'test-password' }));
    safe.getSelectedStorageBackend = () => 'kwallet6';
    await vault.save({ password: 'test-password' }); assert.doesNotMatch((await readFile(file)).toString(), /test-password/); assert.equal((await vault.load()).password, 'test-password');
    await vault.remove(); assert.equal(await vault.exists(), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Local IPTV service connects both provider types, proxies private HLS bytes, enforces access and disconnect', async () => {
  const seen = [];
  const fixture = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture'); seen.push(url);
    if (url.pathname === '/player_api.php') {
      if (url.searchParams.get('password') !== 'private test') { res.writeHead(403); return res.end(); }
      res.setHeader('Content-Type', 'application/json');
      const action = url.searchParams.get('action');
      return res.end(JSON.stringify(action === 'get_live_categories' ? [{ category_id: 1, category_name: 'NFL' }] : action === 'get_live_streams' ? [{ stream_id: 42, name: 'Test sports', category_id: 1, epg_channel_id: 'sports.1' }] : { user_info: { auth: 1, status: 'Active', max_connections: '4', allowed_output_formats: ['m3u8'] } }));
    }
    if (url.pathname === '/playlist') { res.setHeader('Content-Type', 'text/plain'); return res.end('#EXTM3U x-tvg-url="/xmltv.php"\n#EXTINF:-1 tvg-id="sports.1" group-title="NFL",Sports fixture\n/live/master.m3u8'); }
    if (url.pathname === '/xmltv.php') { res.setHeader('Content-Type', 'application/xml'); return res.end('<tv/>'); }
    if (url.pathname.endsWith('.m3u8')) { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="/init.mp4"\n#EXTINF:6,\n/segment.ts?token=secret\n#EXT-X-ENDLIST'); }
    if (url.pathname === '/segment.ts' || url.pathname === '/init.mp4') {
      res.setHeader('Content-Type', 'video/mp2t');
      if (req.headers.range) { res.writeHead(206, { 'Content-Range': 'bytes 0-1/4' }); return res.end(Buffer.from([0x47, 0])); }
      return res.end(Buffer.from([0x47, 0, 0x13, 0x7f]));
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const upstream = 'http://127.0.0.1:' + fixture.address().port;
  const service = await startLocalServer({ directory: path.resolve('public/preview') });
  const origin = new URL(service.url).origin, endpoint = origin + '/preview/iptv/';
  const call = (route, data, headers = {}) => fetch(endpoint + route, { method: data ? 'POST' : 'GET', headers: { 'X-FieldScreen': '1', 'Content-Type': 'application/json', ...headers }, body: data ? JSON.stringify(data) : undefined });
  try {
    assert.equal((await fetch(endpoint + 'status')).status, 403);
    assert.equal((await call('status', null, { Origin: 'https://attacker.example' })).status, 403);
    let response = await call('connect', { type: 'xtream', url: upstream, username: 'viewer', password: 'private test' });
    assert.equal(response.status, 200); let data = await response.json(); assert.equal(data.channels.length, 1); assert.equal(data.maxConnections, 4); assert.doesNotMatch(JSON.stringify(data), /private test|viewer|player_api/);
    let stream = origin + data.channels[0].stream;
    const manifest = await (await fetch(stream)).text(); assert.doesNotMatch(manifest, /secret|private|viewer/);
    const segment = manifest.split('\n').find(line => line.startsWith('/preview/iptv/stream/'));
    const bytes = new Uint8Array(await (await fetch(origin + segment)).arrayBuffer()); assert.deepEqual([...bytes], [0x47, 0, 0x13, 0x7f]);
    assert.equal((await fetch(origin + segment, { headers: { Range: 'bytes=0-1' } })).status, 206);
    assert.equal((await fetch(origin + segment, { headers: { Range: 'bytes=0-1,3-4' } })).status, 416);
    response = await call('connect', { type: 'xtream', url: upstream, username: 'viewer', password: 'wrong' }); assert.equal(response.status, 400);
    assert.equal((await fetch(stream)).status, 200, 'a failed replacement must retain the current connection');
    response = await call('connect', { type: 'm3u', url: upstream + '/playlist' }); data = await response.json(); assert.equal(data.channels[0].name, 'Sports fixture'); assert.equal(data.hasGuide, true);
    assert.equal((await fetch(stream)).status, 404, 'new provider invalidates old stream capabilities');
    await call('guide', {}); assert(seen.some(url => url.pathname === '/xmltv.php'));
    stream = origin + data.channels[0].stream;
    await call('disconnect', {}); assert.equal((await fetch(stream)).status, 404); assert.equal((await (await call('status')).json()).connected, false);
  } finally { service.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
});
