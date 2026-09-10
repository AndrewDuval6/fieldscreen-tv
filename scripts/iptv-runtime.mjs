import { currentProgram, nextProgram, channelResults, reconcilePlayers, redZoneChannels } from './iptv-core.mjs';

const root = document.getElementById('fieldscreen-concept'), api = root.fieldscreenConcept;
const q = selector => root.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let connection = { channels: [] }, target = 0, mode = 'xtream', view = 'setup', filter = 'all', page = 0, players = [], previousFocus = null, guideBusy = false, matchedGame = null, channelsBusy = false, connectionRevision = 0, guideRevision = 0;
let libraryMode = 'games';
let guideRequest = null, watchRevision = 0;
const time = date => new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const when = date => new Date(date).toLocaleDateString([], { weekday: 'short' }) + ' ' + time(date);
const channelFor = slot => connection.channels.find(channel => 'iptv:' + channel.id === api.state.slots[slot]);
async function request(route, data) {
  const response = await fetch('./iptv/' + route, { method: data === undefined ? 'GET' : 'POST', headers: { 'X-FieldScreen': '1', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), cache: 'no-store', credentials: 'omit' });
  let result;
  try { result = await response.json(); } catch { throw new Error('The local IPTV service is unavailable. Relaunch FieldScreen TV.'); }
  if (!response.ok) throw new Error(result.error || 'The provider connection failed.');
  return result;
}

const openButton = document.createElement('button'); openButton.className = 'ez-button fs-iptv-button'; openButton.textContent = 'Connect IPTV';
q('.ez-top').append(openButton);
const modal = document.createElement('section'); modal.id = 'fs-iptv-modal'; modal.className = 'fs-iptv-modal'; modal.hidden = true; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'fs-iptv-title');
modal.innerHTML = `<div class="fs-iptv-panel"><header class="fs-iptv-heading"><div><span class="fs-eyebrow">FIELDSCREEN / YOUR COVERAGE</span><h2 id="fs-iptv-title">Connect your provider</h2></div><button class="ez-button" id="fs-iptv-close">Close · B</button></header>
<div id="fs-provider-view"><div class="fs-provider-intro"><img src="./fieldscreen-mark.png" alt=""><div><h3>Your channels. Your watch wall.</h3><p>Add a provider to watch games and browse its TV guide.</p></div></div>
<div class="fs-provider-tabs"><button class="ez-button on" data-provider-type="xtream" aria-pressed="true">Xtream login</button><button class="ez-button" data-provider-type="m3u" aria-pressed="false">M3U playlist</button><button class="ez-button" id="fs-resume" hidden>Use saved provider</button></div>
<form id="fs-provider-form" autocomplete="off"><div class="fs-form-grid">
<label class="fs-wide"><strong id="fs-provider-url-label">Provider address</strong><input id="fs-provider-url" type="password" placeholder="https://your-provider.example:8080" autocomplete="off" required></label>
<label data-xtream>Username<input id="fs-provider-user" autocomplete="off" spellcheck="false"></label><label data-xtream>Password<input id="fs-provider-password" type="password" autocomplete="new-password"></label>
<label class="fs-wide">EPG / TV guide link <span>Optional · paste your provider’s XMLTV link to find games automatically</span><input id="fs-guide-url" type="password" placeholder="Paste your EPG / XMLTV link" autocomplete="off"></label>
<label data-m3u hidden class="fs-wide">Or choose a playlist file<input id="fs-provider-file" type="file" accept=".m3u,.m3u8,text/plain,audio/x-mpegurl"></label></div>
<label class="fs-remember"><input id="fs-remember" type="checkbox" disabled aria-describedby="fs-storage-note">Remember this provider on this device</label><div class="fs-storage-check"><p id="fs-storage-note" class="fs-muted" role="status">Checking secure storage on this device…</p><button class="ez-button" type="button" id="fs-storage-recheck">Check again</button></div><div class="fs-form-actions"><button class="ez-button ez-primary" type="submit" id="fs-connect">Connect provider</button><button class="ez-button" type="button" id="fs-demo">Try sample video</button><button class="ez-button" type="button" id="fs-back-library" hidden>Back to channels</button></div></form></div>
<div id="fs-library-view" hidden><div class="fs-library-meta"><div class="fs-provider-status"><span id="fs-provider-label"></span><small id="fs-channels-updated"></small></div><div class="fs-library-actions"><button class="ez-button" id="fs-channels-refresh">Refresh channels</button><button class="ez-button" id="fs-guide-refresh">Refresh guide</button><button class="ez-button" id="fs-provider-edit">Provider settings</button><button class="ez-button" id="fs-disconnect">Disconnect & forget</button></div></div><input id="fs-refresh-file" type="file" accept=".m3u,.m3u8,text/plain,audio/x-mpegurl" aria-label="Updated M3U playlist" hidden>
<div class="fs-storage-check"><span id="fs-saved-state" class="fs-muted" role="status"></span><button class="ez-button" id="fs-remember-connected">Remember provider</button></div>
<div class="fs-targets" aria-label="Choose a destination screen">${[0,1,2,3].map(i => `<button class="fs-target" data-iptv-target="${i}" aria-pressed="${i === 0}"><small>SCREEN 0${i + 1}</small><strong id="fs-target-${i}">Choose a channel</strong></button>`).join('')}</div>
<div class="fs-library-tabs"><button class="ez-button" data-library-mode="games">Your games</button><button class="ez-button" data-library-mode="channels">All channels</button><span id="fs-guide-health" role="status"></span></div>
<div id="fs-auto-games" class="fs-auto-games"></div>
<div id="fs-channel-browser">
<div id="fs-guide-match" class="fs-guide-match" hidden><div><strong id="fs-guide-match-title"></strong><span>Suggested listings from team names and kickoff time. Check the guide before watching.</span></div><button class="ez-button" id="fs-guide-show-all">Browse all channels</button></div>
<div class="fs-library-search"><input type="search" id="fs-channel-search" placeholder="Search teams, games, channels…" aria-label="Search teams, games, channels"><select id="fs-channel-group" aria-label="Channel group"><option value="">All groups</option></select></div>
<div class="fs-library-filters">${[['all','All channels'],['football','Football'],['redzone','RedZone'],['now','On now']].map(([id,label]) => `<button class="ez-button ${id === 'all' ? 'on' : ''}" data-channel-filter="${id}" aria-pressed="${id === 'all'}">${label}</button>`).join('')}<span id="fs-channel-count"></span></div>
<div id="fs-channel-list" class="fs-channel-list" aria-label="Available channels"></div></div><div class="fs-library-footer"><span id="fs-guide-note">Listings come from your provider’s guide. NFL scores come from ESPN.</span><button class="ez-button" id="fs-channels-prev">Previous</button><button class="ez-button" id="fs-channels-next">Next</button><button class="ez-button ez-primary" id="fs-watch-wall">Watch wall</button></div>
<details id="fs-guide-repair"><summary>Update TV guide</summary><form id="fs-guide-form"><label>Paste TV guide link<input type="password" id="fs-repair-url" required placeholder="Your provider’s EPG / XMLTV link" autocomplete="off"></label><button class="ez-button" id="fs-save-guide">Load guide</button></form><small>XMLTV and compressed XML.gz links work here. Your channels stay connected.</small></details></div>
<div class="fs-provider-message" id="fs-provider-message" role="status" aria-live="polite" hidden></div></div>`;
root.append(modal);
const tuning = document.createElement('section'); tuning.className = 'fs-auto-tune'; tuning.hidden = true;
tuning.innerHTML = '<div role="status"><img src="./fieldscreen-mark.png" alt=""><strong>Opening your game</strong><span>Finding the best available stream…</span><button class="ez-button">Cancel · B</button></div>';
root.append(tuning);
tuning.querySelector('button').addEventListener('click', () => { watchRevision++; tuning.hidden = true; });
document.addEventListener('keydown', event => { if (!tuning.hidden && event.key === 'Escape') { watchRevision++; tuning.hidden = true; event.stopImmediatePropagation(); } }, true);
const videoLayer = document.createElement('div'); videoLayer.className = 'fs-video-layer'; root.append(videoLayer);
function message(text, error = false, loading = false) {
  const el = q('#fs-provider-message'); el.hidden = !text; el.classList.toggle('fs-error', error); el.classList.toggle('fs-loading', loading); el.textContent = text;
}
function setView(next) { view = next; q('#fs-provider-view').hidden = next !== 'setup'; q('#fs-library-view').hidden = next !== 'library'; q('#fs-iptv-title').textContent = next === 'setup' ? 'Connect your provider' : 'Find your game'; }
function open(slot = 0, query = '', game = null) {
  watchRevision++;
  matchedGame = game; q('#fs-channel-search').value = query; q('#fs-channel-group').value = ''; filter = 'all'; page = 0;
  libraryMode = game || query ? 'channels' : 'games';
  previousFocus = document.activeElement; target = Math.max(0, Math.min(3, slot));
  q('#ez-enter').click(); modal.hidden = false; q('.ez-shell').inert = true; q('.ez-top').inert = true;
  setView(connection.connected ? 'library' : 'setup'); message('');
  if (view === 'library') { q('#fs-channel-search').value = query; filter = 'all'; page = 0; renderLibrary(); }
  (view === 'library' ? q(`[data-iptv-target="${target}"]`) : q('#fs-provider-url')).focus();
}
function close() { modal.hidden = true; q('.ez-shell').inert = false; q('.ez-top').inert = false; if (previousFocus?.isConnected) previousFocus.focus(); else openButton.focus(); }
openButton.addEventListener('click', () => open()); q('#fs-iptv-close').addEventListener('click', close);
modal.addEventListener('click', event => { if (event.target === modal) close(); });
modal.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.stopPropagation(); close(); }
  if (event.key === 'Tab') {
    const controls = [...modal.querySelectorAll('button,input,select,summary')].filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
function type(next) {
  mode = next; q('#fs-provider-form').reset();
  modal.querySelectorAll('[data-provider-type]').forEach(b => { b.classList.toggle('on', b.dataset.providerType === next); b.setAttribute('aria-pressed', b.dataset.providerType === next); });
  modal.querySelectorAll('[data-xtream]').forEach(el => { el.hidden = next !== 'xtream'; });
  modal.querySelectorAll('[data-m3u]').forEach(el => { el.hidden = next !== 'm3u'; });
  q('#fs-provider-url-label').textContent = next === 'm3u' ? 'M3U playlist link' : 'Provider address';
  q('#fs-provider-url').placeholder = next === 'xtream' ? 'https://your-provider.example:8080' : 'Paste your private M3U playlist URL';
  q('#fs-provider-url').required = true; q('#fs-provider-user').required = next === 'xtream'; q('#fs-provider-password').required = next === 'xtream';
}
modal.querySelectorAll('[data-provider-type]').forEach(b => b.addEventListener('click', () => type(b.dataset.providerType)));
q('#fs-provider-file').addEventListener('change', () => { q('#fs-provider-url').required = !q('#fs-provider-file').files.length; });
function updateConnection(value) {
  connectionRevision++;
  const selectedGroup = q('#fs-channel-group').value;
  connection = value; openButton.textContent = value.connected ? 'TV guide · IPTV' : 'Connect IPTV';
  q('#fs-resume').hidden = !value.saved; q('#fs-back-library').hidden = !value.connected;
  renderStorage();
  const groups = [...new Set(value.channels.map(c => c.group))].sort();
  q('#fs-channel-group').innerHTML = '<option value="">All groups</option>' + groups.map(g => `<option>${escape(g)}</option>`).join('');
  if (groups.includes(selectedGroup)) q('#fs-channel-group').value = selectedGroup;
  q('#fs-channels-refresh').disabled = channelsBusy || !value.connected || value.demo;
  api.state.slots = api.state.slots.map((slot, i) => typeof slot === 'string' && slot.startsWith('iptv:') && !channelFor(i) ? 'dashboard' : slot);
  api.render(); sync();
}
function renderStorage() {
  q('#fs-remember').disabled = !connection.canRemember;
  if (!connection.canRemember) q('#fs-remember').checked = false;
  const warning = connection.storage?.savedUnreadable ? ' Your saved provider could not be unlocked. Check again after unlocking your keyring, or enter your provider again.' : '';
  q('#fs-storage-note').textContent = (connection.storage?.message || (connection.canRemember ? 'Secure storage available on this device.' : 'Session only. Install the desktop app to save a provider securely.')) + warning;
  q('#fs-storage-recheck').hidden = connection.storage?.state === 'unsupported';
  q('#fs-saved-state').textContent = connection.saved ? 'Saved on this device · reconnects when the app opens' : 'Session only · provider is not saved';
  q('#fs-remember-connected').hidden = !connection.connected || connection.demo || connection.saved;
  q('#fs-remember-connected').textContent = connection.canRemember ? 'Remember provider' : 'Check storage';
}
q('#fs-storage-recheck').addEventListener('click', async () => {
  const button = q('#fs-storage-recheck'); button.disabled = true;
  q('#fs-storage-note').textContent = 'Testing encrypted saving and reading on this device…';
  try { Object.assign(connection, await request('check-storage', {})); renderStorage(); q('#fs-resume').hidden = !connection.saved; }
  catch (error) { q('#fs-storage-note').textContent = error.message; }
  finally { button.disabled = false; }
});
q('#fs-remember-connected').addEventListener('click', async () => {
  if (!connection.canRemember) { setView('setup'); q('#fs-storage-recheck').focus(); return; }
  const button = q('#fs-remember-connected'); button.disabled = true;
  try { Object.assign(connection, await request('remember', {})); renderStorage(); message(connection.storageNote); }
  catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
});
async function connect(config, route = 'connect') {
  q('#fs-connect').disabled = true; q('#fs-demo').disabled = true; q('#fs-resume').disabled = true;
  message('Connecting your provider and loading channels…', false, true);
  try {
    updateConnection(await request(route, config)); q('#fs-provider-form').reset();
    setView('library'); libraryMode = 'games'; filter = 'all'; page = 0; renderLibrary(); message(connection.storageNote || '');
    close(); q('#ez-enter').click(); q('[data-tv-view="gameday"]').click();
    void refreshGuide();
  } catch (error) { message(error.message, true); }
  finally { q('#fs-connect').disabled = false; q('#fs-demo').disabled = false; q('#fs-resume').disabled = false; }
}
q('#fs-provider-form').addEventListener('submit', async event => {
  event.preventDefault();
  const config = { type: mode, url: q('#fs-provider-url').value.trim(), username: q('#fs-provider-user').value, password: q('#fs-provider-password').value, guideUrl: q('#fs-guide-url').value.trim(), remember: q('#fs-remember').checked };
  const file = q('#fs-provider-file').files[0];
  if (mode === 'm3u' && file) { if (file.size > 12 * 1024 * 1024) { message('Choose a playlist smaller than 12 MB.', true); return; } config.playlist = await file.text(); }
  await connect(config);
});
q('#fs-demo').addEventListener('click', () => connect({ type: 'demo' }));
q('#fs-resume').addEventListener('click', () => connect({}, 'resume'));
q('#fs-provider-edit').addEventListener('click', () => { message(''); setView('setup'); q('#fs-provider-url').focus(); });
q('#fs-back-library').addEventListener('click', () => { message(''); setView('library'); renderLibrary(); });
q('#fs-disconnect').addEventListener('click', async () => {
  connectionRevision++;
  try { updateConnection(await request('disconnect', {})); setView('setup'); message('Disconnected. Saved provider details removed.'); }
  catch (error) { message(error.message, true); }
});
async function refreshChannels(playlist) {
  if (!connection.connected || channelsBusy) return;
  const revision = connectionRevision;
  channelsBusy = true;
  const button = q('#fs-channels-refresh'); button.disabled = true; button.textContent = 'Refreshing…'; button.setAttribute('aria-busy', 'true');
  message('Refreshing your channel lineup…', false, true);
  try {
    const updated = await request('refresh-channels', playlist === undefined ? {} : { playlist });
    if (revision !== connectionRevision) return;
    updateConnection(updated); renderLibrary();
    message(`Channels refreshed · ${connection.channels.length.toLocaleString()} available. ${updated.storageNote || ''}`.trim());
    void refreshGuide(true);
  } catch (error) { if (revision === connectionRevision) message(`Channels could not be refreshed. Your previous lineup is still available. ${error.message}`, true); }
  finally { channelsBusy = false; button.disabled = !connection.connected || connection.demo; button.textContent = 'Refresh channels'; button.removeAttribute('aria-busy'); }
}
q('#fs-channels-refresh').addEventListener('click', () => {
  if (connection.playlistFile) { message('Choose the updated M3U file from your provider.'); q('#fs-refresh-file').value = ''; q('#fs-refresh-file').click(); }
  else void refreshChannels();
});
q('#fs-refresh-file').addEventListener('change', async () => {
  const file = q('#fs-refresh-file').files[0], revision = connectionRevision;
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { message('Choose a playlist smaller than 12 MB.', true); return; }
  try { const playlist = await file.text(); if (revision === connectionRevision) await refreshChannels(playlist); }
  catch { if (revision === connectionRevision) message('The playlist file could not be read. Choose it again.', true); }
});
async function refreshGuide(force = false) {
  const revision = connectionRevision;
  if (!connection.connected) return;
  if (guideBusy && guideRevision === revision) return guideRequest?.catch(() => {});
  guideRevision = revision;
  guideBusy = true; q('#fs-guide-refresh').disabled = true;
  q('#fs-guide-note').textContent = connection.hasGuide ? 'Reading your provider’s TV guide…' : 'Channel names available · no TV guide supplied';
  const ids = connection.channels.map(c => c.id).join(',');
  try {
    guideRequest = request('guide', { force });
    const result = await guideRequest;
    if (revision !== connectionRevision || ids !== connection.channels.map(c => c.id).join(',')) return;
    Object.assign(connection, result);
    q('#fs-guide-note').textContent = result.guideNote || 'Provider listings · times shown locally · NFL scores from ESPN';
    if (view === 'library') renderLibrary(); api.render();
  } catch (error) { if (revision === connectionRevision) q('#fs-guide-note').textContent = error.message; }
  finally { if (guideRevision === revision) { guideBusy = false; q('#fs-guide-refresh').disabled = false; if (view === 'library') renderLibrary(); } }
}
q('#fs-guide-refresh').addEventListener('click', () => refreshGuide(true));
q('#fs-guide-form').addEventListener('submit', async event => {
  event.preventDefault(); if (guideBusy) return;
  const revision = connectionRevision;
  guideBusy = true; q('#fs-save-guide').disabled = true; q('#fs-guide-refresh').disabled = true;
  message('Downloading the TV guide and matching games across your lineup…', false, true);
  try {
    const result = await request('update-guide', { guideUrl: q('#fs-repair-url').value.trim() });
    if (revision !== connectionRevision) return;
    Object.assign(connection, result); q('#fs-repair-url').value = '';
    q('#fs-guide-note').textContent = result.guideNote; renderLibrary(); api.render();
    message(result.storageNote || result.guideNote, result.guideStatus === 'error');
    if (result.guideStatus === 'ready') q('#fs-guide-repair').open = false;
  } catch (error) { if (revision === connectionRevision) message(error.message, true); }
  finally { guideBusy = false; q('#fs-save-guide').disabled = false; q('#fs-guide-refresh').disabled = false; if (view === 'library') renderLibrary(); }
});
function coverage() { return root.fieldscreenNfl?.coverage(connection.channels) || []; }
function renderGames() {
  const games = coverage();
  const html = games.length ? games.map(({game, matches, ready}) => `<article class="fs-auto-game"><div><small>${game.live ? 'LIVE NOW' : escape(when(game.date))} · ${escape(game.network || 'NFL')}</small><strong>${escape(game.away.fullName)} <span>at</span> ${escape(game.home.fullName)}</strong><p>${ready ? 'Matchup confirmed in your TV guide' : matches.length ? `${matches.length} possible channel${matches.length === 1 ? '' : 's'} · ${escape(matches[0].confidence)}` : guideBusy ? 'Reading your guide…' : 'No matching coverage in the available guide'}</p></div><button class="ez-button ${ready ? 'ez-primary' : ''}" data-coverage-game="${escape(game.id)}">${ready ? 'Watch game ↗' : matches.length ? 'Check coverage' : 'Find coverage'}</button></article>`).join('') : '<div class="fs-no-channels"><strong>No upcoming NFL games loaded</strong><p>Games appear here as the schedule loads. Your channels remain available under All channels.</p></div>';
  if (q('#fs-auto-games').innerHTML !== html) q('#fs-auto-games').innerHTML = html;
}
function renderLibrary() {
  q('#fs-provider-label').textContent = `${connection.provider || ''} · ${connection.channels.length.toLocaleString()} channels${connection.maxConnections ? ` · ${connection.maxConnections} provider connections allowed` : ''}`;
  q('#fs-channels-updated').textContent = connection.channelsUpdated ? `Channels updated ${time(connection.channelsUpdated)}` : '';
  q('#fs-channels-updated').title = connection.channelsUpdated ? new Date(connection.channelsUpdated).toLocaleString() : '';
  q('#fs-guide-health').textContent = guideBusy ? 'Matching your guide…' : connection.guideStatus === 'ready' ? `${connection.guideChannels} channels with listings` : 'Guide needs attention';
  q('#fs-channel-search').placeholder = `Search all ${connection.channels.length.toLocaleString()} channels and guide listings…`;
  q('#fs-channel-search').setAttribute('aria-label', 'Search all channels and guide listings');
  q('#fs-auto-games').hidden = libraryMode !== 'games'; q('#fs-channel-browser').hidden = libraryMode !== 'channels';
  modal.querySelectorAll('[data-library-mode]').forEach(b => { b.classList.toggle('on', b.dataset.libraryMode === libraryMode); b.setAttribute('aria-pressed', String(b.dataset.libraryMode === libraryMode)); });
  if (libraryMode === 'games') renderGames();
  modal.querySelectorAll('[data-iptv-target]').forEach(b => { const i = Number(b.dataset.iptvTarget); b.setAttribute('aria-pressed', String(i === target)); q('#fs-target-' + i).textContent = channelFor(i)?.name || (api.state.slots[i] === 'dashboard' ? 'League dashboard' : 'Choose a channel'); });
  modal.querySelectorAll('[data-channel-filter]').forEach(b => { b.classList.toggle('on', b.dataset.channelFilter === filter); b.setAttribute('aria-pressed', String(b.dataset.channelFilter === filter)); });
  q('#fs-guide-match').hidden = !matchedGame;
  if (matchedGame) q('#fs-guide-match-title').textContent = `${matchedGame.away.fullName} at ${matchedGame.home.fullName} · ${when(matchedGame.date)}`;
  const candidates = matchedGame ? root.fieldscreenNfl.matchBroadcasts(matchedGame, connection.channels) : connection.channels;
  const result = channelResults(candidates, { query: q('#fs-channel-search').value, group: q('#fs-channel-group').value, filter }, page);
  page = result.page; const current = result.channels;
  q('#fs-channel-count').textContent = `${result.total.toLocaleString()} matches across the full lineup${result.pages > 1 ? ` · page ${page + 1} of ${result.pages}` : ''}`;
  const channelHTML = current.length ? current.map(channel => {
    const program = channel.matchedProgram || currentProgram(channel), next = nextProgram(channel), selected = channelFor(target)?.id === channel.id;
    return `<button class="fs-channel ${selected ? 'fs-selected' : ''}" data-iptv-channel="${channel.id}" aria-pressed="${selected}"><span class="fs-channel-symbol">${program ? (program.start <= Date.now() && program.end > Date.now() ? 'ON<br>NOW' : 'GUIDE') : 'TV'}</span><span class="fs-channel-copy"><strong>${escape(program?.title || channel.name)}</strong><span>${escape(program ? channel.name + ' · ' + time(program.start) + '–' + time(program.end) : channel.group)}</span>${channel.confidence ? `<small class="fs-match-confidence">${escape(channel.confidence)}</small>` : ''}${next ? `<small>Next · ${escape(when(next.start))} · ${escape(next.title)}</small>` : '<small>Choose to watch this channel</small>'}</span><span class="fs-channel-action">${selected ? 'Playing' : 'Watch'} ↗</span></button>`;
  }).join('') : '<div class="fs-no-channels"><strong>No matching channels</strong><p>No matching listing is available with these filters. Browse all channels or refresh your guide; upcoming games may be outside its 48-hour window.</p></div>';
  if (q('#fs-channel-list').innerHTML !== channelHTML) q('#fs-channel-list').innerHTML = channelHTML;
  q('#fs-channels-prev').disabled = page === 0; q('#fs-channels-next').disabled = page + 1 >= result.pages;
  q('#fs-channels-prev').hidden = q('#fs-channels-next').hidden = libraryMode === 'games' || result.pages === 1;
}
q('#fs-guide-show-all').addEventListener('click', () => { matchedGame = null; q('#fs-channel-search').value = ''; q('#fs-channel-group').value = ''; filter = 'all'; page = 0; renderLibrary(); });
function showWall() { q('[data-tv-view="watch"]').click(); sync(); }
function selectChannel(channel, watch = false) {
  api.state.slots[target] = 'iptv:' + channel.id; api.state.audio = target;
  if (target > 1 && ['single', 'split'].includes(api.state.layout)) api.state.layout = 'quad';
  if (target === 1 && api.state.layout === 'single') api.state.layout = 'split';
  showWall(); renderLibrary();
  if (watch) close();
  else { message(`Screen 0${target + 1}: ${channel.name}. Choose another screen, or open the watch wall.`); q(`[data-iptv-target="${Math.min(3, target + 1)}"]`).focus(); }
}
async function watchGame(game, slot = 0) {
  if (!connection.connected) { open(slot, '', game); return; }
  target = Math.max(0, Math.min(3, slot)); previousFocus = document.activeElement;
  if (!game.live) { open(slot, '', game); message('This game is not live yet. Its available coverage appears here.'); return; }
  const revision = ++watchRevision, providerRevision = connectionRevision;
  const matches = () => (root.fieldscreenNfl?.matchBroadcasts(game, connection.channels) || []).filter(c => c.matchScore === 100 && c.matchedProgram?.start <= Date.now() && c.matchedProgram?.end > Date.now());
  tuning.hidden = false;
  try {
    if (!matches().length) await refreshGuide();
    if (revision !== watchRevision || providerRevision !== connectionRevision) return;
    const candidates = matches(); let channel = candidates[0];
    if (candidates.length > 1) {
      try {
        const result = await request('choose-broadcast', { channelIds: candidates.map(c => c.id), playing: players.length });
        channel = candidates.find(c => c.id === result.channelId) || channel;
      } catch { /* Let normal playback try the strongest guide match. */ }
    }
    if (revision !== watchRevision || providerRevision !== connectionRevision) return;
    if (channel) { q('#ez-enter').click(); selectChannel(channel, true); }
    else { tuning.hidden = true; open(slot, '', game); message(connection.guideStatus === 'error' ? connection.guideNote : 'Your guide does not confirm a live channel for this matchup. The closest available listings are shown below.'); }
  } finally { if (revision === watchRevision) tuning.hidden = true; }
}
async function watchRedZone() {
  if (!connection.connected) { open(); return; }
  target = 0; previousFocus = document.activeElement;
  const revision = ++watchRevision, providerRevision = connectionRevision;
  tuning.hidden = false;
  try {
    let candidates = redZoneChannels(connection.channels);
    if (!candidates.length) { await refreshGuide(); candidates = redZoneChannels(connection.channels); }
    if (revision !== watchRevision || providerRevision !== connectionRevision) return;
    let channel = candidates[0];
    if (candidates.length > 1) {
      try {
        const result = await request('choose-broadcast', { channelIds: candidates.map(c => c.id), playing: players.length });
        channel = candidates.find(c => c.id === result.channelId) || channel;
      } catch { /* Normal playback can try the matching RedZone feed. */ }
    }
    if (revision !== watchRevision || providerRevision !== connectionRevision) return;
    if (channel) selectChannel(channel, true);
    else {
      tuning.hidden = true; open(0, 'RedZone'); filter = 'redzone'; q('#fs-channel-search').value = ''; renderLibrary();
      message('Your provider is not listing a RedZone channel or live RedZone programme right now. Try Refresh channels on game day.');
    }
  } finally { if (revision === watchRevision) tuning.hidden = true; }
}
q('#fs-watch-wall').addEventListener('click', () => { close(); showWall(); });
modal.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b) return;
  if (b.dataset.libraryMode) { libraryMode = b.dataset.libraryMode; matchedGame = null; renderLibrary(); }
  if (b.dataset.coverageGame) {
    const item = coverage().find(item => String(item.game.id) === b.dataset.coverageGame);
    if (item?.ready) selectChannel(item.ready, true);
    else if (item) { matchedGame = item.game; libraryMode = 'channels'; filter = 'all'; page = 0; q('#fs-channel-search').value = ''; q('#fs-channel-group').value = ''; renderLibrary(); }
  }
  if (b.dataset.iptvTarget !== undefined) { target = Number(b.dataset.iptvTarget); renderLibrary(); }
  if (b.dataset.channelFilter) { matchedGame = null; filter = b.dataset.channelFilter; page = 0; renderLibrary(); }
  if (b.dataset.iptvChannel) {
    const channel = connection.channels.find(c => c.id === b.dataset.iptvChannel); if (!channel) return;
    selectChannel(channel);
  }
});
q('#fs-channel-search').addEventListener('input', () => { matchedGame = null; filter = 'all'; q('#fs-channel-group').value = ''; page = 0; renderLibrary(); q('#fs-channel-list').scrollTop = 0; });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && connection.connected) {
    event.preventDefault(); event.stopImmediatePropagation(); if (modal.hidden) open();
    libraryMode = 'channels'; matchedGame = null; filter = 'all'; q('#fs-channel-group').value = ''; page = 0; renderLibrary(); q('#fs-channel-search').focus(); q('#fs-channel-search').select();
  }
}, true);
q('#fs-channel-group').addEventListener('change', () => { page = 0; renderLibrary(); });
q('#fs-channels-prev').addEventListener('click', () => { page--; renderLibrary(); q('#fs-channel-list').scrollTop = 0; });
q('#fs-channels-next').addEventListener('click', () => { page++; renderLibrary(); q('#fs-channel-list').scrollTop = 0; });

function createPlayer(channel) {
  const element = document.createElement('div'); element.className = 'fs-live-player';
  element.innerHTML = '<video playsinline></video><div class="fs-player-state"><img src="./fieldscreen-mark.png" alt=""><strong>CONNECTING</strong><div class="fs-player-meter"></div><span></span><button class="ez-button" hidden>Retry stream</button></div>';
  const video = element.querySelector('video'), layer = element.querySelector('.fs-player-state'), label = layer.querySelector('strong'), detail = layer.querySelector('span'), retry = layer.querySelector('button');
  video.muted = true; video.autoplay = true; video.preload = 'none'; video.setAttribute('aria-label', channel.name); videoLayer.append(element);
  const player = { element, video, channel, hls: null, ts: null, disposed: false, slot: -1 };
  let recovery = 0, loadingTimeout, playbackFormat = channel.format;
  function state(title, text = '', canRetry = false) { layer.hidden = false; label.textContent = title; detail.textContent = text; retry.hidden = !canRetry; layer.classList.toggle('fs-player-failed', canRetry); }
  function play() { video.play().catch(() => { if (!player.disposed) { state('PRESS PLAY', 'Select to start this channel.', true); retry.textContent = 'Play channel'; } }); }
  function failure() { clearTimeout(loadingTimeout); state('STREAM UNAVAILABLE', 'Check the channel, supported video format, or your provider’s connection limit.', true); retry.textContent = 'Retry stream'; }
  function start() {
    recovery = 0; player.hls?.destroy(); player.hls = null; player.ts?.destroy(); player.ts = null; video.pause(); video.removeAttribute('src'); video.load();
    state('CONNECTING', channel.name); clearTimeout(loadingTimeout); loadingTimeout = setTimeout(failure, 30000);
    if (['mpegts','auto'].includes(playbackFormat) && globalThis.mpegts?.getFeatureList().mseLivePlayback) {
      mpegts.LoggingControl.enableAll = false;
      const ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: channel.stream }, { enableWorker: true, autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 30, autoCleanupMinBackwardDuration: 10 }); player.ts = ts;
      ts.on(mpegts.Events.ERROR, () => { if (!player.disposed) { ts.destroy(); player.ts = null; if (playbackFormat === 'auto') { playbackFormat = 'hls'; start(); } else failure(); } });
      ts.attachMediaElement(video); ts.load(); play();
    } else if (channel.format === 'file' || (!globalThis.Hls?.isSupported() && video.canPlayType('application/vnd.apple.mpegurl'))) { video.src = channel.stream; play(); }
    else if (globalThis.Hls?.isSupported()) {
      const hls = new Hls({ maxBufferLength: 15, maxMaxBufferLength: 30, backBufferLength: 10, startLevel: -1, capLevelToPlayerSize: true, lowLatencyMode: false, enableWorker: true }); player.hls = hls;
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(channel.stream));
      hls.on(Hls.Events.MANIFEST_PARSED, play);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || player.disposed) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovery++ < 1) hls.recoverMediaError();
        else { hls.destroy(); player.hls = null; failure(); }
      });
      hls.attachMedia(video);
    } else failure();
  }
  video.addEventListener('playing', () => { clearTimeout(loadingTimeout); layer.hidden = true; });
  video.addEventListener('waiting', () => { state('BUFFERING', channel.name); clearTimeout(loadingTimeout); loadingTimeout = setTimeout(failure, 30000); });
  video.addEventListener('error', () => { if (!player.hls && !player.ts && !player.disposed) failure(); });
  video.addEventListener('ended', () => { state('BROADCAST ENDED', 'Replay or choose another channel.', true); });
  retry.addEventListener('click', () => { if (retry.textContent === 'Play channel') play(); else start(); });
  player.destroy = () => { player.disposed = true; clearTimeout(loadingTimeout); player.hls?.destroy(); player.ts?.destroy(); video.pause(); video.removeAttribute('src'); video.load(); element.remove(); };
  start(); return player;
}
function place() {
  const box = root.getBoundingClientRect();
  players.forEach(player => {
    const mount = q(`.fs-stream-mount[data-stream-slot="${player.slot}"]`), rect = mount?.getBoundingClientRect();
    player.element.hidden = !rect?.width || root.classList.contains('ez-director');
    if (rect?.width) Object.assign(player.element.style, { left: rect.left - box.left + 'px', top: rect.top - box.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
  });
}
function sync() {
  const count = api.state.layout === 'single' ? 1 : api.state.layout === 'split' ? 2 : 4;
  const desired = api.state.view === 'watch' && !root.classList.contains('ez-director') ? Array.from({ length: count }, (_, slot) => ({ slot, channel: channelFor(slot) })).filter(item => item.channel) : [];
  players = reconcilePlayers(players, desired, createPlayer, player => player.destroy());
  if (players.length && !players.some(p => p.slot === api.state.audio)) api.state.audio = players[0].slot;
  players.forEach(player => { player.video.muted = player.slot !== api.state.audio; });
  root.querySelectorAll('[data-audio]').forEach(b => { const active = Number(b.dataset.audio) === api.state.audio; b.setAttribute('aria-pressed', String(active)); b.closest('.ez-feed')?.classList.toggle('has-audio', active); if (b.closest('.fs-iptv-feed')) b.textContent = active ? 'AUDIO FOCUS' : 'SELECT AUDIO'; });
  const note = q('.ez-watch-note p');
  if (note) note.textContent = players.length ? `${players.length} channel${players.length > 1 ? 's' : ''} playing · one audio focus. ${connection.maxConnections ? `Your provider allows ${connection.maxConnections} simultaneous connections.` : 'Each playing pane uses one provider connection.'} ${root.fieldscreenNfl?.statusText() || 'Connecting NFL data…'}` : 'Choose Channels on any pane to watch your provider, or keep the NFL scoreboard alongside a game.';
  requestAnimationFrame(place);
}
root.fieldscreenIptv = {
  openGame: watchGame,
  connected: () => Boolean(connection.connected),
  open, close,
  sourceOptions(source) { const channel = connection.channels.find(c => 'iptv:' + c.id === source); return channel ? `<optgroup label="Your channel"><option value="iptv:${channel.id}" selected>${escape(channel.name)}</option></optgroup>` : ''; },
  feed(slot, header, audio) {
    const channel = channelFor(slot); if (!channel) return '';
    const program = currentProgram(channel);
    return `<article class="ez-feed fs-iptv-feed ${api.state.audio === slot ? 'has-audio' : ''}" data-slot="${slot}">${header}<div class="fs-stream-mount" data-stream-slot="${slot}"></div><div class="ez-feed-foot"><span title="${escape(program?.title || channel.name)}">${escape(program?.title || channel.name)}</span>${audio}</div></article>`;
  },
};
root.addEventListener('click', event => {
  if (event.target.closest('[data-quick-redzone]')) { event.preventDefault(); event.stopImmediatePropagation(); void watchRedZone(); return; }
  const button = event.target.closest('[data-channel]');
  if (button) { event.preventDefault(); event.stopImmediatePropagation(); open(Number(button.dataset.channel), button.dataset.channelSearch || ''); }
  const audio = event.target.closest('[data-audio]');
  if (audio) { event.preventDefault(); event.stopImmediatePropagation(); api.state.audio = Number(audio.dataset.audio); sync(); }
}, true);
new MutationObserver(sync).observe(q('#ez-body'), { childList: true });
new ResizeObserver(place).observe(root);
window.addEventListener('resize', place); window.addEventListener('beforeunload', () => players.forEach(p => p.destroy()));
window.addEventListener('focus', async () => {
  const revision = connectionRevision;
  try {
    const value = await request('status');
    if (revision !== connectionRevision || value.connected === connection.connected && value.channelsUpdated === connection.channelsUpdated) return;
    updateConnection(value);
    if (!modal.hidden) { setView(value.connected ? 'library' : 'setup'); if (value.connected) renderLibrary(); }
    if (value.connected) void refreshGuide();
  } catch { /* Retain the current screen if the local service is restarting. */ }
});
setInterval(() => { if (connection.connected && !modal.hidden && view === 'library' && !modal.contains(document.activeElement?.closest('input'))) renderLibrary(); }, 10000);
setInterval(() => { if (connection.connected) void refreshGuide(); }, 15 * 60000);
type('xtream');
request('status').then(async value => {
  updateConnection(value);
  if (value.connected) void refreshGuide();
  else if (value.saved) await connect({}, 'resume');
}).catch(() => { q('#fs-storage-note').textContent = 'Open the Linux app or run the local browser preview to connect IPTV.'; });
