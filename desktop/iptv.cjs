const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { guideResponse } = require('./guide.cjs');
const { createNFL } = require('./nfl.cjs');
const { createMLB } = require('./mlb.cjs');
const { createMMA } = require('./mma.cjs');
const { chooseBroadcast } = require('./broadcast.cjs');
const { createRecorder } = require('./recorder.cjs');

const PREFIX = '/preview/iptv/';
const LIMIT = 12 * 1024 * 1024;
const MAX_CHANNELS = 50000;
const token = () => randomBytes(24).toString('hex');
const clean = (value, fallback = '') => String(value ?? fallback).replace(/[\u0000-\u001f]/g, '').slice(0, 200);
class PublicError extends Error {}

function webURL(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw new PublicError('Enter a complete http:// or https:// provider address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new PublicError('Only HTTP and HTTPS streams are supported.');
  if (url.href.length > 8192) throw new PublicError('The provider address is too long.');
  url.hash = '';
  return url;
}

function parseM3U(text, base) {
  if (!text.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) throw new PublicError('This is not an M3U channel playlist.');
  if (/#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE):/.test(text)) throw new PublicError('This is one HLS video. Import your provider’s channel playlist instead.');
  const channels = [], seen = new Set();
  let info = null, group = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/^#EXTINF:(?:[^,"']|"[^"]*"|'[^']*')*,(.*)$/);
      const attributes = Object.fromEntries([...line.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], m[2] ?? m[3]]));
      info = { name: clean(match?.[1] || attributes['tvg-name'], 'Channel'), group: clean(attributes['group-title'], 'Other'), epgId: clean(attributes['tvg-id']) };
      group = '';
    } else if (line.startsWith('#EXTGRP:')) group = clean(line.slice(8));
    else if (line && !line.startsWith('#')) {
      try {
        // VLC pipe/header syntax cannot be safely translated into browser playback.
        if (line.includes('|')) { info = null; continue; }
        const url = webURL(line, base).href;
        if (!seen.has(url)) {
          channels.push({ name: info?.name || `Channel ${channels.length + 1}`, group: group || info?.group || 'Other', epgId: info?.epgId || '', url });
          seen.add(url);
        }
      } catch { /* Skip non-web entries without disclosing the private URL. */ }
      info = null; group = '';
    }
    if (channels.length >= MAX_CHANNELS) break;
  }
  if (!channels.length) throw new PublicError('No supported HTTP channels were found in this playlist.');
  return channels;
}

function rewriteManifest(text, base, register) {
  if (/#EXT-X-DEFINE:/.test(text)) throw new PublicError('This provider uses HLS variables that are not supported yet.');
  const rewrite = value => register(webURL(value, base).href);
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (!line.startsWith('#')) return rewrite(line.trim());
    return line.replace(/\bURI="([^"]+)"/g, (_match, uri) => `URI="${rewrite(uri)}"`);
  }).join('\n');
}

async function limitedText(response, limit = LIMIT) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new PublicError('The provider response is too large.'); }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new PublicError('The provider response is too large.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(chunks).toString('utf8');
}

async function upstream(value, { signal, range, timeout = 25000 } = {}) {
  let url = webURL(value);
  const combined = timeout ? (signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)) : signal;
  for (let redirects = 0; redirects < 6; redirects++) {
    const headers = { 'User-Agent': 'FieldScreenTV/0.1', Accept: '*/*' };
    if (range) headers.Range = range;
    const target = new URL(url);
    if (target.username || target.password) {
      headers.Authorization = 'Basic ' + Buffer.from(`${decodeURIComponent(target.username)}:${decodeURIComponent(target.password)}`).toString('base64');
      target.username = ''; target.password = '';
    }
    const headerTimeout = new AbortController();
    const timer = setTimeout(() => headerTimeout.abort(), 25000); timer.unref();
    let response;
    try { response = await fetch(target, { headers, signal: combined ? AbortSignal.any([combined, headerTimeout.signal]) : headerTimeout.signal, redirect: 'manual' }); }
    finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new PublicError('The provider returned an incomplete redirect.');
      url = webURL(location, url); continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      const error = new PublicError(response.status === 429 ? 'Your provider is limiting guide requests. Please wait before refreshing again.' : [401, 403].includes(response.status) ? 'The provider refused access. Check your login and subscription.' : `The provider returned error ${response.status}. Try again shortly.`);
      error.status = response.status;
      const retry = response.headers.get('retry-after');
      error.retryAfter = Math.min(3600000, Math.max(60000, (Number(retry) * 1000) || (Date.parse(retry) - Date.now()) || 60000));
      throw error;
    }
    return { response, url: url.href };
  }
  throw new PublicError('The provider redirected too many times.');
}

function createIPTV({ vault, recordingCount = () => 0 } = {}) {
  const nfl = createNFL(), mlb = createMLB(), mma = createMMA();
  let channels = [], metadata = null, activeConfig = null, connecting = false, generation = 0, channelRevision = 0, guideURL = null, guideLoaded = 0, guideJob = null, guideController = null, guideState = {};
  const resources = new Map(), reverse = new Map(), pending = new Set();
  const broadcastCache = new Map(); let broadcastJob = false;
  function clear() {
    broadcastCache.clear();
    generation++;
    for (const controller of pending) controller.abort();
    pending.clear(); channels = []; metadata = null; activeConfig = null; resources.clear(); reverse.clear(); guideURL = null; guideLoaded = 0; guideJob = null; guideController = null; guideState = {};
  }
  function register(url, pinned = false) {
    let id = reverse.get(url);
    if (!id) { id = token(); reverse.set(url, id); resources.set(id, { url, pinned }); }
    if (pinned) resources.get(id).pinned = true;
    // HLS playlists rotate continuously: retain roots, bound the segment capability cache.
    if (resources.size > MAX_CHANNELS + 8000) {
      for (const [key, item] of resources) {
        if (!item.pinned) { resources.delete(key); reverse.delete(item.url); }
        if (resources.size <= MAX_CHANNELS + 4000) break;
      }
    }
    return PREFIX + 'stream/' + id;
  }
  async function status(forceStorage = false) {
    const storage = vault?.verify ? await vault.verify(forceStorage) : { state: vault?.available() ? 'ready' : 'unsupported', message: 'Provider saving is available in the installed desktop app. This browser session keeps your connection only until it closes.' };
    const saved = Boolean(await vault?.load());
    const savedUnreadable = !saved && Boolean(await vault?.hasFile?.());
    return { connected: Boolean(metadata), ...metadata, ...guideState, channels, canRemember: storage.state === 'ready', saved, storage: { ...storage, savedUnreadable } };
  }
  async function connect(config, refreshing = false) {
    if (connecting) throw new PublicError('A provider connection is already in progress.');
    connecting = true;
    const epoch = generation, controller = new AbortController(); pending.add(controller);
    const getText = async url => { const result = await upstream(url, { signal: controller.signal }); return { text: await limitedText(result.response), url: result.url }; };
    const getJSON = async url => { const { text } = await getText(url); try { return JSON.parse(text); } catch { throw new PublicError('The provider did not return a valid channel response.'); } };
    try {
      let entries, meta, guide = config.guideUrl ? webURL(config.guideUrl).href : null;
      if (config.type === 'xtream') {
        const base = webURL(config.url);
        base.search = ''; base.username = ''; base.password = '';
        base.pathname = base.pathname.replace(/\/(?:player_api|get)\.php\/?$/, '').replace(/\/$/, '') + '/';
        if (!config.username || !config.password) throw new PublicError('Enter your provider username and password.');
        const apiURL = action => {
          const u = new URL('player_api.php', base);
          u.searchParams.set('username', String(config.username)); u.searchParams.set('password', String(config.password));
          if (action) u.searchParams.set('action', action); return u.href;
        };
        const account = await getJSON(apiURL());
        if (Number(account?.user_info?.auth) !== 1 || (account.user_info.status && account.user_info.status !== 'Active')) throw new PublicError('The provider did not accept this account, or the subscription is inactive.');
        const formats = account.user_info.allowed_output_formats;
        const extension = Array.isArray(formats) && formats.length && !formats.includes('m3u8') && formats.includes('ts') ? 'ts' : 'm3u8';
        const categories = await getJSON(apiURL('get_live_categories'));
        const streams = await getJSON(apiURL('get_live_streams'));
        if (!Array.isArray(streams)) throw new PublicError('The provider did not return a channel list.');
        const groups = new Map((Array.isArray(categories) ? categories : []).map(c => [String(c.category_id), clean(c.category_name)]));
        entries = streams.filter(c => /^\d+$/.test(String(c.stream_id))).slice(0, MAX_CHANNELS).map(c => ({
          name: clean(c.name, 'Channel'), group: groups.get(String(c.category_id)) || 'Other', epgId: clean(c.epg_channel_id),
          url: new URL(`live/${encodeURIComponent(config.username)}/${encodeURIComponent(config.password)}/${c.stream_id}.${extension}`, base).href,
        }));
        if (!entries.length) throw new PublicError('This account has no live channels.');
        meta = { provider: base.hostname, type: 'xtream', maxConnections: Math.max(0, Number(account.user_info.max_connections) || 0), demo: false };
        const epg = new URL('xmltv.php', base); epg.searchParams.set('username', config.username); epg.searchParams.set('password', config.password); guide = guide || epg.href;
      } else if (config.type === 'm3u') {
        if (typeof config.playlist === 'string' && config.playlist.trim()) {
          if (Buffer.byteLength(config.playlist) > LIMIT) throw new PublicError('Choose a playlist smaller than 12 MB.');
          entries = parseM3U(config.playlist); meta = { provider: 'Imported playlist', type: 'm3u', demo: false };
          const link = config.playlist.split(/\r?\n/)[0].match(/(?:x-tvg-url|url-tvg|tvg-url)="([^"]+)"/i)?.[1];
          if (!guide && link) { try { guide = webURL(link).href; } catch {} }
        } else {
          const original = webURL(config.url); const result = await getText(original.href);
          entries = parseM3U(result.text, result.url); meta = { provider: original.hostname, type: 'm3u', demo: false };
          const link = result.text.split(/\r?\n/)[0].match(/(?:x-tvg-url|url-tvg|tvg-url)="([^"]+)"/i)?.[1];
          if (!guide && link) { try { guide = webURL(link, result.url).href; } catch {} }
        }
      } else if (config.type === 'demo') {
        entries = [{ name: 'Sample video · Big Buck Bunny', group: 'Playback test', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' }];
        meta = { provider: 'Mux public test stream', type: 'demo', demo: true };
      } else throw new PublicError('Choose Xtream login or an M3U playlist.');
      if (epoch !== generation) throw new PublicError('Connection cancelled.');
      // Fetch and validate before changing the lineup. Refresh retains capabilities
      // for unchanged URLs so active players and in-flight media requests survive.
      const previous = refreshing ? new Map(channels.map(channel => [resources.get(channel.stream.slice((PREFIX + 'stream/').length))?.url, channel])) : new Map();
      const sameGuide = guideURL === guide;
      pending.delete(controller);
      if (!refreshing) clear();
      else { guideController?.abort(); guideController = null; guideJob = null; guideLoaded = 0; }
      channelRevision++;
      const currentURLs = new Set(entries.map(entry => entry.url));
      for (const [id, resource] of resources) {
        if (resource.pinned && !currentURLs.has(resource.url)) { resources.delete(id); reverse.delete(resource.url); }
      }
      channels = entries.map(entry => {
        const old = previous.get(entry.url);
        return { id: old?.id || token(), name: entry.name, group: entry.group, epgId: entry.epgId || '', programs: sameGuide && old?.epgId === (entry.epgId || '') ? old.programs : [], stream: register(entry.url, true), format: /\.(mp4|webm)(?:\?|$)/i.test(entry.url) ? 'file' : /\.m3u8(?:\?|$)|[?&](?:output|format)=m3u8/i.test(entry.url) ? 'hls' : /\.ts(?:\?|$)/i.test(entry.url) ? 'mpegts' : 'auto' };
      });
      guideURL = guide; metadata = { ...meta, hasGuide: Boolean(guide), playlistFile: Boolean(config.playlist), channelsUpdated: Date.now() };
      activeConfig = { ...config };
      let storageNote = '';
      try {
        // A URL refresh leaves the user's storage choice untouched. A replacement
        // file updates the encrypted copy only when it was already remembered.
        if (!refreshing || config.playlist) {
          if (config.remember && vault?.available() && config.type !== 'demo') await vault.save(config);
          else if (!refreshing) { await vault?.remove(); if (config.remember) storageNote = 'Connected for this session. A system keyring is required to remember a provider.'; }
        }
      } catch { storageNote = 'Connected for this session, but the provider could not be saved.'; }
      return { ...await status(), storageNote };
    } finally { pending.delete(controller); connecting = false; }
  }
  async function refreshChannels(input) {
    if (!activeConfig || !metadata) throw new PublicError('Connect a provider before refreshing channels.');
    if (activeConfig.type === 'demo') throw new PublicError('Connect your provider to refresh its channels.');
    let config = activeConfig;
    if (activeConfig.playlist) {
      if (typeof input.playlist !== 'string' || !input.playlist.trim()) throw new PublicError('Choose an updated M3U file to refresh an imported playlist.');
      config = { ...activeConfig, playlist: input.playlist };
    }
    return connect(config, true);
  }
  async function loadGuide(force) {
    if (!guideURL || !metadata) return { channels, guideStatus: 'missing', guideNote: 'Add an XMLTV guide below to identify games automatically.' };
    if (guideState.guideRetryAt > Date.now()) return { channels, ...guideState };
    if (!force && guideLoaded > Date.now() - 15 * 60000) return { channels, ...guideState };
    if (guideJob) return guideJob;
    const epoch = generation, revision = channelRevision, controller = new AbortController(); pending.add(controller); guideController = controller;
    const job = (async () => {
      try {
        const { response, url } = await upstream(guideURL, { signal: controller.signal, timeout: 90000 });
        const guide = await guideResponse(response, url, new Set(channels.map(c => c.epgId).filter(Boolean)));
        if (epoch !== generation || revision !== channelRevision) throw new PublicError('The provider connection changed.');
        channels = channels.map(channel => ({ ...channel, programs: guide.get(channel.epgId) || [] })); guideLoaded = Date.now();
        const matched = channels.filter(c => c.programs.length).length;
        const note = matched ? `Guide ready · ${matched} of ${channels.length} channels have listings · games matched automatically` : !channels.some(c => c.epgId) ? 'The playlist has no TV guide IDs. Use a playlist with tvg-id values from your provider.' : !guide.stats.programmes ? 'The guide contains no programmes. Check that this is the provider’s XMLTV link.' : !guide.stats.matchingIds ? 'The guide loaded, but its channel IDs do not match this playlist. Use the XMLTV guide supplied with this M3U.' : guide.stats.latestEnd <= Date.now() ? 'The guide is out of date. Your provider needs to refresh its listings.' : 'The guide has no listings in the next 48 hours. Scheduled games will appear when your provider adds them.';
        guideState = { guideStatus: matched ? 'ready' : 'empty', guideUpdated: guideLoaded, guideChannels: matched, guideNote: note };
        return { channels, ...guideState };
      } catch (error) {
        if (epoch !== generation || revision !== channelRevision) return { channels, ...guideState };
        const reason = error instanceof PublicError ? error.message : error.code === 'limit' ? 'The XMLTV feed exceeds the import limit. Use your provider’s smaller sports or country-specific guide.' : ['TimeoutError', 'AbortError'].includes(error.name) ? 'The guide download timed out. Refresh it or use a smaller XMLTV feed.' : /Saxes|Error/.test(error.name) && /(?:line|column|XML|tag|text|character|gzip|header|compression|format)/i.test(error.message) ? 'The guide response is not readable XMLTV. Check that the link downloads XML or XML.gz, rather than a webpage.' : 'The guide could not be downloaded. Check the XMLTV link and your connection.';
        guideState = { ...guideState, guideStatus: 'error', guideRetryAt: Date.now() + (error.retryAfter || 60000), guideNote: reason + (channels.some(c => c.programs.length) ? ' Keeping the last available listings.' : '') };
        return { channels, ...guideState };
      }
      finally { controller.abort(); pending.delete(controller); if (guideJob === job) guideJob = null; if (guideController === controller) guideController = null; }
    })();
    guideJob = job; return job;
  }
  async function updateGuide(input) {
    if (!metadata || !activeConfig) throw new PublicError('Connect a provider first.');
    if (connecting) throw new PublicError('Wait for the channel refresh to finish before changing the guide.');
    const next = webURL(input.guideUrl).href;
    if (next === guideURL && guideState.guideRetryAt > Date.now()) return { channels, ...guideState, hasGuide: true };
    guideController?.abort(); guideController = null; guideJob = null; guideLoaded = 0; channelRevision++;
    guideURL = next; guideState = {}; activeConfig = { ...activeConfig, guideUrl: next }; metadata.hasGuide = true;
    let storageNote = '';
    if (activeConfig.remember && vault?.available()) {
      try { await vault.save(activeConfig); } catch { storageNote = 'The new guide is connected for this session, but could not be saved.'; }
    }
    return { ...await loadGuide(true), storageNote, hasGuide: true };
  }
  function json(res, code, value) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value));
  }
  async function handle(req, res, next = () => { res.writeHead(404); res.end(); }) {
    if (req.url?.startsWith('/preview/mma/')) return mma.handle(req, res, next);
    if (req.url?.startsWith('/preview/mlb/')) return mlb.handle(req, res, next);
    if (req.url?.startsWith('/preview/nfl/')) return nfl.handle(req, res, next);
    const route = req.url?.split('?')[0];
    if (!route?.startsWith(PREFIX)) return next();
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    let host;
    try { host = new URL('http://' + req.headers.host); } catch { return json(res, 403, { error: 'Local access only.' }); }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || (req.headers.origin && req.headers.origin !== host.origin) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Local access only.' });
    try {
      if (route.startsWith(PREFIX + 'stream/')) {
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
        const resource = resources.get(route.slice((PREFIX + 'stream/').length));
        if (!resource) return json(res, 404, { error: 'This stream session has ended.' });
        if (req.headers.range && !/^bytes=\d*-\d*$/.test(req.headers.range)) return json(res, 416, { error: 'Unsupported byte range.' });
        const controller = new AbortController(); pending.add(controller);
        const abort = () => controller.abort(); res.on('close', abort);
        try {
          const { response, url } = await upstream(resource.url, { signal: controller.signal, range: req.headers.range, timeout: resource.pinned && !/\.m3u8(?:\?|$)/i.test(resource.url) ? 0 : 120000 });
          const contentType = response.headers.get('content-type') || 'application/octet-stream';
          if (resource.hls || /mpegurl/i.test(contentType) || /\.m3u8(?:\?|$)/i.test(url) || /\.m3u8(?:\?|$)/i.test(resource.url)) {
            const manifest = await limitedText(response);
            if (!manifest.trimStart().startsWith('#EXTM3U')) throw new PublicError('This channel did not return a playable HLS stream.');
            const body = rewriteManifest(manifest, url, register);
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end(req.method === 'HEAD' ? undefined : body);
          } else {
            // Serve only media bytes. Never execute HTML or scripts returned by a provider.
            const safeType = /^(video\/|audio\/|application\/(?:octet-stream|mp4))/.test(contentType) ? contentType : 'application/octet-stream';
            const headers = { 'Content-Type': safeType, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
            for (const name of ['content-length', 'content-range', 'accept-ranges']) if (response.headers.has(name)) headers[name] = response.headers.get(name);
            res.writeHead(response.status, headers);
            if (req.method === 'HEAD') { await response.body?.cancel(); res.end(); }
            else if (response.body) await pipeline(Readable.fromWeb(response.body), res);
            else res.end();
          }
        } finally { pending.delete(controller); res.off('close', abort); }
        return;
      }
      if (req.headers['x-fieldscreen'] !== '1') return json(res, 403, { error: 'Open IPTV from FieldScreen TV.' });
      if (req.method === 'GET' && route === PREFIX + 'status') return json(res, 200, await status());
      if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > LIMIT + 1024) return json(res, 413, { error: 'Choose a playlist smaller than 12 MB.' });
        chunks.push(chunk);
      }
      let config;
      try { config = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return json(res, 400, { error: 'Invalid request.' }); }
      if (!config || typeof config !== 'object' || Array.isArray(config)) return json(res, 400, { error: 'Invalid request.' });
      if (route === PREFIX + 'connect') return json(res, 200, await connect(config));
      if (route === PREFIX + 'choose-broadcast') {
        if (broadcastJob) throw new PublicError('A game stream is already being checked.');
        const ids = Array.isArray(config.channelIds) ? new Set(config.channelIds.slice(0, 8)) : new Set();
        const candidates = [...ids].map(id => channels.find(c => c.id === id)).filter(Boolean).map(c => ({ id: c.id, url: resources.get(c.stream.slice((PREFIX + 'stream/').length))?.url })).filter(c => c.url);
        if (!candidates.length) throw new PublicError('No matching channels are connected.');
        const controller = new AbortController(); pending.add(controller); broadcastJob = true;
        const abort = () => controller.abort(); res.on('close', abort);
        try {
          const canProbe = !metadata.maxConnections || metadata.maxConnections > Math.max(0, Number(config.playing) || 0) + recordingCount();
          return json(res, 200, await chooseBroadcast(candidates, { upstream, cache: broadcastCache, signal: controller.signal, canProbe }));
        } finally { controller.abort(); pending.delete(controller); broadcastJob = false; res.off('close', abort); }
      }
      if (route === PREFIX + 'check-storage') return json(res, 200, await status(true));
      if (route === PREFIX + 'remember') {
        if (!activeConfig || metadata?.demo) throw new PublicError('Connect your provider before saving it.');
        if (connecting) throw new PublicError('Wait for the channel refresh to finish, then try again.');
        if (!vault || (await status(true)).canRemember !== true) throw new PublicError('Secure storage is unavailable. Check storage in Provider settings, then try again.');
        try { await vault.save({ ...activeConfig, remember: true }); }
        catch { throw new PublicError('Your provider is connected, but could not be saved. Check storage in Provider settings, then try again.'); }
        activeConfig.remember = true;
        return json(res, 200, { ...await status(), storageNote: 'Provider saved securely on this device. It will reconnect when you open the app.' });
      }
      if (route === PREFIX + 'refresh-channels') return json(res, 200, await refreshChannels(config));
      if (route === PREFIX + 'guide') return json(res, 200, await loadGuide(Boolean(config.force)));
      if (route === PREFIX + 'update-guide') return json(res, 200, await updateGuide(config));
      if (route === PREFIX + 'resume') {
        const saved = await vault?.load();
        if (!saved) throw new PublicError('No saved provider is available. Enter your login again.');
        return json(res, 200, await connect({ ...saved, remember: true }));
      }
      if (route === PREFIX + 'disconnect') { clear(); await vault?.remove(); return json(res, 200, await status()); }
      return json(res, 404, { error: 'Unknown request.' });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error instanceof PublicError ? 400 : 502, { error: error instanceof PublicError ? error.message : 'Could not reach the provider. Check the address and connection, then try again.' });
      else res.destroy();
    }
  }
  return { handle, snapshot: status,
    async resolve(job, playing) {
      if (!metadata) {
        const saved = await vault?.load();
        if (!saved) throw new Error('provider unavailable');
        await connect(saved);
      }
      if (metadata.maxConnections && playing >= metadata.maxConnections) throw new Error('connections in use');
      let candidates;
      if (job.game) {
        await loadGuide(false);
        const { matchBroadcasts } = await import('../scripts/broadcast-core.mjs');
        candidates = matchBroadcasts({ ...job.game, live: true }, channels).filter(c => c.matchScore === 100 && c.matchedProgram.start <= Date.now() + 120000 && c.matchedProgram.end > Date.now());
      } else candidates = channels.filter(c => c.id === job.channel?.id || job.channel?.epgId && c.epgId === job.channel.epgId && c.name === job.channel.name);
      if (!candidates.length) return null;
      const picks = candidates.slice(0,3).map(c => ({ id: c.id, url: resources.get(c.stream.slice((PREFIX+'stream/').length))?.url })).filter(c => c.url);
      const selected = picks.length > 1 ? await chooseBroadcast(picks, { upstream, cache: broadcastCache, canProbe: !metadata.maxConnections || metadata.maxConnections > playing + 1 }) : null;
      const channel = candidates.find(c => c.id === selected?.channelId) || candidates[0];
      if (channel.format === 'auto') {
        const resource = resources.get(channel.stream.slice((PREFIX+'stream/').length));
        const { response } = await upstream(resource.url, {timeout:5000});
        const reader = response.body?.getReader();
        try {
          const first = await reader?.read();
          const head = Buffer.from(first?.value || []).toString('utf8',0,64).trimStart();
          if (/mpegurl/i.test(response.headers.get('content-type') || '') || head.startsWith('#EXTM3U')) { channel.format = 'hls'; resource.hls = true; }
          else if (first?.value?.[0] === 0x47) channel.format = 'mpegts';
        } finally { await reader?.cancel().catch(() => {}); }
      }
      return channel;
    },
    close() { clear(); nfl.close(); mlb.close(); mma.close(); } };
}

async function startLocalServer({ directory, vault, port = 0, recordings } = {}) {
  let recorder;
  const iptv = createIPTV({ vault, recordingCount: () => recorder?.count() || 0 });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
  const server = http.createServer((req, res) => {
    const route = () => iptv.handle(req, res, async () => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const relative = decodeURIComponent(url.pathname.replace(/^\/preview\//, ''));
        const file = path.resolve(directory, relative);
        if (!['GET', 'HEAD'].includes(req.method) || !url.pathname.startsWith('/preview/') || !file.startsWith(path.resolve(directory) + path.sep) || !types[path.extname(file)]) { res.writeHead(404); return res.end(); }
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch { res.writeHead(404); res.end(); }
    });
    if (recorder) void recorder.handle(req, res, route).catch(() => res.destroy()); else void route();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { if (recordings) recorder = await createRecorder({ ...recordings, provider: iptv, origin: () => origin }); }
  catch {
    // A damaged DVR catalog must not stop the dashboard or live television.
    // Keep the original catalog and all video files untouched for recovery.
    const message = 'Recording storage could not be opened. Your video files have been left in place. Check access to the app recordings catalog before trying again.';
    const status = async () => ({supported:false,folder:'',storage:{ready:false,free:0,note:message},jobs:[],error:message,active:0,scheduled:0,engineReady:false});
    recorder = {status,hasWork:()=>false,count:()=>0,close(){},async shutdown(){},async setFolder(){throw new Error(message);},
      async handle(req,res,next){
        if (!req.url?.startsWith('/preview/recordings/')) return next();
        const safe = req.headers.host === new URL(origin).host && (!req.headers.origin || req.headers.origin === origin) && req.headers['sec-fetch-site'] !== 'cross-site' && req.headers['x-fieldscreen'] === '1';
        const read = safe && req.method === 'GET' && req.url === '/preview/recordings/status';
        res.writeHead(safe ? read ? 200 : 503 : 403, {'Content-Type':'application/json','Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin'});
        res.end(JSON.stringify(read ? await status() : {error:message}));
      }};
  }
  return { url: origin + '/preview/index.html', server, recorder, close() { recorder?.close(); iptv.close(); server.closeAllConnections(); server.close(); } };
}

module.exports = { createIPTV, startLocalServer, parseM3U, rewriteManifest, webURL };
