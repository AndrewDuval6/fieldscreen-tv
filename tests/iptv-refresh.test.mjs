import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { reconcilePlayers } from '../scripts/iptv-core.mjs';

const require = createRequire(import.meta.url);
const { startLocalServer } = require('../desktop/iptv.cjs');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const xmlTime = ms => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';

async function fixture() {
  const state = { channels: [41, 42], renamed: false, fail: false, gate: null, guideGate: null, guideTitle: 'Original game', media: [], saves: 0, removes: 0, saved: null, reads: 0 };
  const provider = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/playlist' || url.pathname === '/player_api.php') {
      state.reads++;
      if (state.gate) { const gate = state.gate; gate.started.resolve(); await gate.release.promise; }
      if (state.fail) { res.writeHead(503); return res.end(); }
      if (url.pathname === '/playlist') return res.end('#EXTM3U x-tvg-url="/guide.xml"\n' + state.channels.map(id => `#EXTINF:-1 tvg-id="sport.${id}" group-title="${state.renamed ? 'Live NFL' : 'Sports'}",${state.renamed ? 'Updated ' : ''}Channel ${id}\n/media/${id}.ts`).join('\n'));
      if (url.searchParams.get('password') !== 'private-test') { res.writeHead(403); return res.end(); }
      const action = url.searchParams.get('action');
      return res.end(JSON.stringify(action === 'get_live_categories' ? [{ category_id: 1, category_name: state.renamed ? 'Live NFL' : 'Sports' }] : action === 'get_live_streams' ? state.channels.map(id => ({ stream_id: id, name: `${state.renamed ? 'Updated ' : ''}Channel ${id}`, category_id: 1, epg_channel_id: `sport.${id}` })) : { user_info: { auth: 1, status: 'Active', max_connections: 4, allowed_output_formats: ['ts'] } }));
    }
    if (url.pathname === '/guide.xml' || url.pathname === '/xmltv.php') {
      const title = state.guideTitle;
      if (state.guideGate) { const gate = state.guideGate; gate.started.resolve(); await gate.release.promise; }
      res.setHeader('Content-Type', 'application/xml');
      return res.end(`<tv>${state.channels.map(id => `<programme channel="sport.${id}" start="${xmlTime(Date.now() - 60000)}" stop="${xmlTime(Date.now() + 3600000)}"><title>${title}</title></programme>`).join('')}</tv>`);
    }
    if (url.pathname.endsWith('.ts')) { res.setHeader('Content-Type', 'video/mp2t'); res.write(Buffer.from([0x47, 1])); state.media.push(res); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const upstream = `http://127.0.0.1:${provider.address().port}`;
  const vault = { available: () => true, exists: async () => Boolean(state.saved), save: async config => { state.saves++; state.saved = { ...config }; }, load: async () => state.saved, remove: async () => { state.removes++; state.saved = null; } };
  const service = await startLocalServer({ vault });
  const origin = new URL(service.url).origin;
  const call = (route, data) => fetch(`${origin}/preview/iptv/${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'X-FieldScreen': '1', 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { state, upstream, origin, call, async close() { state.gate?.release.resolve(); state.guideGate?.release.resolve(); service.close(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); } };
}

for (const type of ['m3u', 'xtream']) test(`${type} refresh updates the lineup, retains live streams and saved details, and keeps the last good lineup on failure`, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('refresh-channels', {})).status, 400);
    const config = type === 'm3u' ? { type, url: f.upstream + '/playlist?token=private-test' } : { type, url: f.upstream, username: 'viewer', password: 'private-test' };
    const connected = await (await f.call('connect', { ...config, remember: true })).json();
    const original = connected.channels[0], removed = connected.channels[1];
    const stream = await fetch(f.origin + original.stream), reader = stream.body.getReader();
    assert.deepEqual([...((await reader.read()).value)], [0x47, 1]);
    const guide = await (await f.call('guide', {})).json();
    assert.equal(guide.channels[0].programs[0].title, 'Original game');
    f.state.channels = [43, 41]; f.state.renamed = true;
    const response = await f.call('refresh-channels', { url: 'https://ignored.example', remember: false });
    assert.equal(response.status, 200);
    const refreshed = await response.json(), retained = refreshed.channels.find(c => c.id === original.id);
    assert.equal(retained.stream, original.stream);
    assert.equal(retained.name, 'Updated Channel 41'); assert.equal(retained.group, 'Live NFL');
    assert.equal(retained.programs[0].title, 'Original game');
    assert.equal(refreshed.channels.length, 2); assert(!refreshed.channels.some(c => c.id === removed.id));
    assert(refreshed.channelsUpdated >= connected.channelsUpdated);
    assert.doesNotMatch(JSON.stringify(refreshed), /private-test|viewer|playlist\?|ignored\.example/);
    assert.equal(f.state.saves, 1); assert.equal(f.state.removes, 0); assert.deepEqual(f.state.saved, { ...config, remember: true });
    f.state.media[0].write(Buffer.from([0x47, 2]));
    assert.deepEqual([...((await reader.read()).value)], [0x47, 2], 'refresh must not abort an in-flight live stream');
    await reader.cancel();
    assert.equal((await fetch(f.origin + removed.stream)).status, 404);
    const player = { channel: original, slot: 0 };
    assert.equal(reconcilePlayers([player], [{ channel: retained, slot: 0 }], () => assert.fail('unchanged stream restarted'), () => assert.fail('unchanged stream stopped'))[0], player);
    f.state.guideTitle = 'Refreshed game';
    const newGuide = await (await f.call('guide', {})).json();
    assert.equal(newGuide.channels[0].programs[0].title, 'Refreshed game', 'refresh invalidates the guide cache for the new lineup');
    f.state.fail = true;
    assert.equal((await f.call('refresh-channels', {})).status, 400);
    const unchanged = await (await f.call('status')).json();
    assert.equal(unchanged.channelsUpdated, refreshed.channelsUpdated);
    assert.deepEqual(unchanged.channels, newGuide.channels);
    assert.equal(f.state.saves, 1);
  } finally { await f.close(); }
});

test('Channel refresh works for session-only providers and imported files require a replacement file', async () => {
  const f = await fixture();
  try {
    await f.call('connect', { type: 'm3u', url: f.upstream + '/playlist', remember: false });
    assert.equal((await f.call('refresh-channels', {})).status, 200); assert.equal(f.state.saved, null); assert.equal(f.state.saves, 0);
    const playlist = name => `#EXTM3U\n#EXTINF:-1 tvg-id="sport.41",${name}\n${f.upstream}/media/41.ts`;
    const initial = await (await f.call('connect', { type: 'm3u', playlist: playlist('Original'), guideUrl: f.upstream + '/guide.xml', remember: true })).json();
    assert.equal(initial.playlistFile, true);
    assert.equal((await f.call('refresh-channels', {})).status, 400);
    assert.equal((await f.call('refresh-channels', { playlist: 'invalid' })).status, 400);
    assert.equal(f.state.saves, 1);
    const updated = await (await f.call('refresh-channels', { playlist: playlist('Replacement') })).json();
    assert.equal(updated.channels[0].id, initial.channels[0].id); assert.equal(updated.channels[0].name, 'Replacement');
    assert.equal(f.state.saves, 2); assert.equal(f.state.saved.playlist, playlist('Replacement'));
    assert.equal(f.state.saved.guideUrl, f.upstream + '/guide.xml');
    await f.call('disconnect', {});
    assert.equal((await f.call('refresh-channels', {})).status, 400); assert.equal(f.state.saved, null);
  } finally { await f.close(); }
});

test('Disconnect cancels a pending refresh and duplicate refresh requests cannot race', async () => {
  const f = await fixture();
  try {
    await f.call('connect', { type: 'm3u', url: f.upstream + '/playlist', remember: true });
    const gate = f.state.gate = { started: deferred(), release: deferred() };
    const request = f.call('refresh-channels', {}); await gate.started.promise;
    assert.equal((await f.call('refresh-channels', {})).status, 400);
    await f.call('disconnect', {}); gate.release.resolve();
    assert.notEqual((await request).status, 200);
    assert.equal((await (await f.call('status')).json()).connected, false); assert.equal(f.state.saved, null); assert.equal(f.state.saves, 1);
  } finally { await f.close(); }
});

test('A guide response from the old lineup cannot overwrite the refreshed guide', async () => {
  const f = await fixture();
  try {
    await f.call('connect', { type: 'm3u', url: f.upstream + '/playlist' });
    const gate = f.state.guideGate = { started: deferred(), release: deferred() };
    const oldGuide = f.call('guide', {}); await gate.started.promise;
    f.state.channels = [43, 41];
    assert.equal((await f.call('refresh-channels', {})).status, 200);
    f.state.guideGate = null; f.state.guideTitle = 'New lineup';
    const current = await (await f.call('guide', {})).json();
    assert.equal(current.channels[0].programs[0].title, 'New lineup');
    gate.release.resolve(); await oldGuide;
    assert.deepEqual((await (await f.call('status')).json()).channels, current.channels);
  } finally { await f.close(); }
});
