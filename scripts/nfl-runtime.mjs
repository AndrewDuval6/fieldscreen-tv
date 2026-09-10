import { gamePriority, fieldPosition, matchBroadcasts, gameCoverage, liveBroadcast } from './nfl-core.mjs';

const root = document.getElementById('fieldscreen-concept'), api = root.fieldscreenConcept;
const q = selector => root.querySelector(selector), esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dash = value => value === null || value === undefined || value === '' ? '—' : value;
const localTime = date => new Date(date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const val = (stats, name) => stats?.find(s => s.name === name)?.display || '—';
const btn = (label, attributes = '') => `<button class="ez-button" ${attributes}>${label}</button>`;
const record = game => game.complete ? '' : btn('● Record game', `data-record-game="nfl:${game.id}"`);
const state = { board: null, teams: [], standings: null, detail: null, teamStats: null, advanced: null, selected: null, auto: true, panel: 'gameday', fieldPage: 0, season: null, week: null, type: '2', conference: 'AFC', team: 'JAX', statsSeason: null, detailTab: 'plays', statsCategory: 'passing', loading: true, error: '', detailError: '', teamError: '', advancedError: '', standingsError: '' };
let boardRequest = 0, boardPending = null, standingsRequest = 0, detailBusy = null, statsBusy = null, detailRequest = 0, statsRequest = 0;
const current = () => state.board?.games.find(g => g.id === state.selected) || state.board?.games[0];
async function request(route) {
  const response = await fetch('./nfl/' + route, { headers: { 'X-FieldScreen': '1' }, cache: 'no-store', credentials: 'omit' });
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'NFL data is unavailable.'); return data;
}
function fresh(meta) { return meta ? `${meta.source} · ${meta.stale ? 'CACHED · ' : ''}Updated ${new Date(meta.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : 'Connecting to ESPN…'; }
function allTeams() {
  const teams = new Map(state.teams.map(t => [t.abbr, t]));
  state.board?.games.forEach(g => { teams.set(g.away.abbr, g.away); teams.set(g.home.abbr, g.home); });
  return [...teams.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}
function bindTeams() { allTeams().forEach(t => { api.teams[t.abbr] = { ...t, name: esc(t.name), city: esc(t.city), record: esc(t.record || ''), metrics: [] }; }); }
function pitch(game, key) {
  if (!game || !api.teams[game.home.abbr]) return '';
  const position = fieldPosition(game);
  return api.pitch({ home: game.home.abbr, position: position ?? 50, clock: position === null ? 'FINAL' : game.clock, down: esc(game.down || game.status.toUpperCase()), yard: esc(game.possessionText || game.venue) }, key).replace('Sample: ', '').replace('home field.', 'home field. Possession shown left to right.');
}
function gameLabel(game) { return game.live ? (game.redZone ? 'RED ZONE' : 'IN PROGRESS') : game.complete ? 'FINAL' : game.status.toUpperCase(); }
function scoreboard(game, cls = 'fs-nfl-matchup') {
  return `<div class="${cls}"><div style="--club:${game.away.color}"><b>${esc(game.away.abbr)}</b><span>${esc(game.away.name)}</span></div><strong>${esc(dash(game.away.score))}<i>:</i>${esc(dash(game.home.score))}</strong><div style="--club:${game.home.color}"><b>${esc(game.home.abbr)}</b><span>${esc(game.home.name)}</span></div></div>`;
}
function empty(text, loading = false) { return `<div class="fs-nfl-empty ${loading ? 'fs-nfl-loading' : ''}"><img src="./fieldscreen-mark.png" alt=""><strong>${loading ? 'CONNECTING THE LEAGUE' : 'NFL DATA'}</strong><p>${esc(text)}</p>${loading ? '<div class="fs-player-meter"></div>' : btn('Retry', 'data-nfl-refresh')}</div>`; }
function preserveRender(callback) {
  const active = document.activeElement, identity = active?.id ? '#' + CSS.escape(active.id) : active?.dataset.nflGame ? `[data-nfl-game="${active.dataset.nflGame}"]` : null;
  const scroller = q('.fs-nfl-scroll'), scroll = scroller?.scrollTop || 0;
  callback();
  if (identity && !active.isConnected && q('#fs-iptv-modal')?.hidden) q(identity)?.focus({ preventScroll: true });
  if (q('.fs-nfl-scroll')) q('.fs-nfl-scroll').scrollTop = scroll;
}
function header() {
  q('.ez-brand-sub').textContent='SPORTS CONTROL ROOM'; q('.ez-dir-name>b').textContent='SUNDAY DIRECTOR'; q('#ez-dir-fields').setAttribute('aria-label','All game field positions');
  root.classList.add('fs-nfl-connected', 'ez-tv'); api.state.tv = true;
  const panel = state.panel === 'game' ? 'gameday' : state.panel;
  root.querySelectorAll('[data-tv-view],[data-nfl-view]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.tvView || b.dataset.nflView) === panel)));
  q('#fs-nfl-source').textContent = state.board ? `${state.board.season.year || ''} / ${state.board.meta.stale ? 'CACHED' : 'NFL DATA'}` : 'CONNECTING NFL';
  q('#ez-output-state').textContent = fresh(state.board?.meta); q('#ez-status').textContent = state.error || state.board?.meta.warning || 'ESPN DATA · YOUR TV GUIDE · YOUR CHANNELS';
  q('#ez-status').classList.toggle('fs-data-warning', Boolean(state.error || state.board?.meta.stale));
  q('#ez-title').textContent = 'NFL / ' + state.panel.toUpperCase(); q('#ez-view-label').textContent = fresh(state.board?.meta);
  q('.ez-heading-controls').hidden = true;
}
function director() {
  const surface = q('#ez-director-surface'), game = current();
  surface.hidden = !game; root.classList.toggle('ez-director', Boolean(game));
  if (!game) { q('#ez-body').innerHTML = empty(state.error || (state.loading ? 'Loading scores, schedules, and all 32 teams.' : 'No games are listed for this week.'), state.loading); return; }
  q('#ez-body').innerHTML = '';
  surface.setAttribute('aria-label', 'NFL game day director');
  q('#ez-dir-mode').textContent = state.auto ? 'AUTO FOCUS' : 'PINNED BY YOU';
  q('#ez-dir-auto').textContent = state.auto ? 'Auto focus on' : 'Resume auto focus'; q('#ez-dir-auto').setAttribute('aria-pressed', String(state.auto));
  q('#ez-dir-play').innerHTML = '<span>Refresh scores</span>';
  q('#ez-dir-matchup').innerHTML = scoreboard(game, 'fs-nfl-matchup');
  q('#ez-dir-channel').textContent = `${game.away.abbr} @ ${game.home.abbr} · ${game.network || game.venue}`;
  q('.ez-dir-bug').textContent = state.board.meta.stale ? 'CACHED' : 'ESPN'; q('#ez-dir-kind').textContent = gameLabel(game);
  q('#ez-dir-clock').textContent = game.state === 'pre' ? localTime(game.date) : game.detail;
  q('#ez-dir-pitch').innerHTML = pitch(game, 'nfl-main');
  q('#ez-dir-down').textContent = game.down || (game.state === 'pre' ? 'KICKOFF ' + new Date(game.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : game.status);
  q('#ez-dir-yard').textContent = game.possessionText ? `${game.possession === game.home.id ? game.home.abbr : game.away.abbr} BALL · ${game.possessionText}` : game.venue;
  q('#ez-dir-event-label').textContent = game.live ? 'LATEST REPORTED PLAY' : game.complete ? 'FINAL RESULT' : 'COMING UP';
  q('#ez-dir-event-text').textContent = game.lastPlay || (game.state === 'pre' ? `${game.away.fullName} at ${game.home.fullName}. ${game.network || 'Broadcast to be announced'}.` : game.detail);
  q('#ez-dir-pin').setAttribute('aria-pressed', String(!state.auto)); q('#ez-dir-pin span').textContent = state.auto ? 'Pin game' : 'Unpin';
  q('#ez-dir-count').textContent = state.board.games.length + ' GAMES';
  const ranked = [...state.board.games].sort((a, b) => gamePriority(b) - gamePriority(a));
  q('#ez-dir-queue').innerHTML = ranked.filter(g => g.id !== game.id).slice(0, 3).map(g => `<button class="ez-dir-cue" data-nfl-game="${g.id}"><span class="ez-dir-cue-kind">${esc(gameLabel(g))}</span><span class="ez-dir-cue-score"><span>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</span><strong>${esc(dash(g.away.score))}–${esc(dash(g.home.score))}</strong></span><span class="ez-dir-cue-clock">${esc(g.state === 'pre' ? localTime(g.date) : g.detail)}</span></button>`).join('');
  q('#ez-dir-reason-title').textContent = state.auto ? 'On the main screen' : 'You have control';
  q('#ez-dir-reason').textContent = state.auto ? game.live ? 'Live games take priority. Red-zone possessions and close fourth quarters move to the front.' : 'The next scheduled matchup. Live games take priority when coverage begins.' : 'This matchup stays selected while the rest of the league updates.';
  q('#ez-dir-moments').innerHTML = btn('Watch game ↗', `data-nfl-watch="${game.id}"`) + record(game) + btn('Game details', `data-nfl-detail="${game.id}"`) + btn('Full schedule', 'data-nfl-view="schedule"');
  q('#ez-dir-moments').setAttribute('aria-label', 'Selected game actions'); q('.ez-dir-timeline>span').textContent = 'GAME DAY';
  q('#ez-dir-step').innerHTML = `<span>WEEK ${state.board.week || '—'}</span>`;
  const pages = Math.max(1, Math.ceil(state.board.games.length / 6)); state.fieldPage %= pages;
  q('#ez-dir-step').innerHTML += `<button data-field-page="-1" aria-label="Previous field wall page">←</button> ${state.fieldPage + 1} / ${pages} <button data-field-page="1" aria-label="Next field wall page">→</button>`;
  q('#ez-dir-fields').innerHTML = state.board.games.slice(state.fieldPage * 6, state.fieldPage * 6 + 6).map(g => `<button class="ez-dir-mini" data-nfl-game="${g.id}" aria-pressed="${g.id === state.selected}"><div class="ez-dir-mini-head"><span>${esc(g.away.abbr)} · ${esc(g.home.abbr)}</span><b>${esc(dash(g.away.score))} : ${esc(dash(g.home.score))}</b></div><div class="ez-dir-mini-field">${pitch(g, 'nfl-' + g.id)}</div><div class="ez-dir-mini-foot"><span>${esc(g.state === 'pre' ? new Date(g.date).toLocaleDateString([], { weekday: 'short' }) + ' ' + new Date(g.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : g.detail)}</span><span>${g.redZone ? 'RED ZONE' : g.id === state.selected ? 'MAIN' : ''}</span></div></button>`).join('');
  q('#ez-dir-foot-state').textContent = fresh(state.board.meta) + ' · Refreshes every 30 seconds';
  q('#ez-dir-detail').textContent = 'Open selected game ↗';
}
function schedule() {
  const year = state.season || state.board?.season.year || new Date().getFullYear(), week = state.week || state.board?.week || 1;
  return `<div class="fs-nfl-controls"><h2>THE SCHEDULE</h2><label>Season <select id="fs-nfl-season">${Array.from({ length: 9 }, (_, i) => new Date().getFullYear() + 1 - i).map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label><label>Stage <select id="fs-nfl-type">${[['1','Preseason'],['2','Regular season'],['3','Postseason']].map(([v,l]) => `<option value="${v}" ${state.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>Week <select id="fs-nfl-week">${Array.from({ length: state.type === '2' ? 18 : 5 }, (_, i) => `<option ${i + 1 === week ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>${btn('Current week', 'data-nfl-current')}</div><div class="fs-nfl-scroll fs-schedule-grid">${state.loading ? empty('Loading this week…', true) : state.board?.games.length ? state.board.games.map(g => `<article class="fs-schedule-game"><div class="fs-game-kicker"><span>${esc(gameLabel(g))}</span><span>${esc(g.network)}</span></div>${scoreboard(g)}<p>${esc(g.state === 'pre' ? localTime(g.date) : g.detail)}</p><small>${esc(g.venue)}</small><div>${btn('Game details', `data-nfl-detail="${g.id}"`)}${btn('Watch game', `data-nfl-watch="${g.id}"`)}${record(g)}</div></article>`).join('') : empty(state.error || 'No games are listed for this week.')}</div>`;
}
function standings() {
  const table = state.standings;
  return `<div class="fs-nfl-controls"><h2>${table?.season || ''} STANDINGS</h2>${['AFC','NFC'].map(c => btn(c, `data-nfl-conference="${c}" aria-pressed="${c === state.conference}"`)).join('')}<span>${esc(state.standingsError || fresh(table?.meta))}</span></div><div class="fs-nfl-scroll fs-standings-grid">${table ? table.divisions.filter(d => d.name.startsWith(state.conference)).map(d => `<section class="fs-nfl-card"><h3>${esc(d.name)}</h3><table><thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>PF</th><th>PA</th><th>DIFF</th></tr></thead><tbody>${d.entries.map(e => `<tr><td><button data-nfl-team="${e.team.abbr}">${esc(e.team.fullName)}</button></td>${['wins','losses','ties','winPercent','pointsFor','pointsAgainst','pointDifferential'].map(k => `<td>${esc(val(e.stats, k))}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`).join('') : empty(state.standingsError || 'Loading all eight divisions…', !state.standingsError)}</div>`;
}
function detail() {
  const base = current(), details = state.detail?.game.id === state.selected ? state.detail : null, game = details?.game || base;
  if (!game) return empty(state.error || 'Choose a game from the schedule.');
  const ordered = [game.away, game.home].map(t => details?.stats.find(s => s.teamId === t.id)?.stats || []);
  const plays = state.detailTab === 'scoring' ? details?.scoring : details?.plays;
  return `<div class="fs-nfl-controls">${btn('← Game day', 'data-nfl-view="gameday"')}<h2>${esc(game.away.abbr)} @ ${esc(game.home.abbr)}</h2><span>${esc(details ? fresh(details.meta) : state.detailError || 'Loading game details…')}</span>${btn('Watch game ↗', `data-nfl-watch="${game.id}"`)}${record(game)}</div><div class="fs-nfl-scroll fs-detail-grid"><section class="fs-nfl-card fs-detail-feature"><div class="fs-game-kicker"><span>${esc(gameLabel(game))}</span><span>${esc(base?.network || game.network)}</span></div>${scoreboard(game)}<p>${esc(game.state === 'pre' ? localTime(game.date) : game.detail)}</p><div class="fs-detail-pitch">${pitch(game, 'nfl-detail')}</div><div class="fs-game-kicker"><b>${esc(game.down || game.status)}</b><span>${esc(game.possessionText || game.venue)}</span></div>${game.away.quarters.length ? `<table><thead><tr><th>Team</th>${game.away.quarters.map((_,i) => `<th>${i < 4 ? 'Q' + (i + 1) : 'OT'}</th>`).join('')}<th>Total</th></tr></thead><tbody>${[game.away,game.home].map(t => `<tr><td>${esc(t.abbr)}</td>${t.quarters.map(n => `<td>${esc(dash(n))}</td>`).join('')}<td>${esc(dash(t.score))}</td></tr>`).join('')}</tbody></table>` : ''}</section><section class="fs-nfl-card"><h3>GAME STATS</h3><table><thead><tr><th>Stat</th><th>${esc(game.away.abbr)}</th><th>${esc(game.home.abbr)}</th></tr></thead><tbody>${['totalYards','netPassingYards','rushingYards','firstDowns','thirdDownEff','turnovers','possessionTime','totalPenaltiesYards'].map(key => `<tr><td>${esc(ordered[0].find(s => s.name === key)?.label || ({ totalYards: 'Total yards', netPassingYards: 'Passing yards', rushingYards: 'Rushing yards', firstDowns: 'First downs', thirdDownEff: 'Third-down efficiency', turnovers: 'Turnovers', possessionTime: 'Possession', totalPenaltiesYards: 'Penalties' })[key])}</td><td>${esc(val(ordered[0], key))}</td><td>${esc(val(ordered[1], key))}</td></tr>`).join('')}</tbody></table><p class="fs-nfl-muted">${esc(state.detailError || (game.state === 'pre' ? 'Game statistics appear after play begins.' : details?.drive || 'Statistics as reported by ESPN.'))}</p></section><section class="fs-nfl-card fs-detail-plays"><div class="fs-nfl-controls"><h3>PLAY-BY-PLAY</h3>${btn('Latest', `data-detail-tab="plays" aria-pressed="${state.detailTab === 'plays'}"`)}${btn('Scoring', `data-detail-tab="scoring" aria-pressed="${state.detailTab === 'scoring'}"`)}</div>${plays?.length ? plays.map(p => `<div class="fs-real-play"><span>Q${p.period || '—'}<b>${esc(p.clock)}</b></span><p>${esc(p.text)}</p><strong>${p.scoring ? `${dash(p.awayScore)}–${dash(p.homeScore)}` : p.yards === null ? '' : `${p.yards > 0 ? '+' : ''}${p.yards} YD`}</strong></div>`).join('') : `<p class="fs-nfl-muted">${esc(state.detailError || (details ? 'No plays reported yet.' : 'Loading reported plays…'))}</p>`}</section><section class="fs-nfl-card"><h3>PLAYER LEADERS</h3>${details?.leaders.map(t => t.categories.filter(c => ['passing','rushing','receiving'].includes(c.name)).map(c => `<h4>${esc(t.teamId === game.away.id ? game.away.abbr : game.home.abbr)} / ${esc(c.name.toUpperCase())}</h4><table><thead><tr><th>Player</th>${c.labels.slice(0,4).map(l => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${c.players.slice(0,3).map(p => `<tr><td>${esc(p.name)}</td>${p.stats.slice(0,4).map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')).join('') || '<p class="fs-nfl-muted">Player statistics appear when reported.</p>'}</section></div>`;
}
function teams() {
  const teams = allTeams(), selected = teams.find(t => t.abbr === state.team), stats = state.teamStats;
  const category = stats?.categories.find(c => c.name === state.statsCategory) || stats?.categories[0];
  const advanced = state.advanced?.teams.find(t => t.team === state.team);
  const deeper = [['games','Games'],['passing_epa','Passing EPA'],['passing_cpoe','Passing CPOE'],['passing_air_yards','Air yards'],['passing_yards_after_catch','Yards after catch'],['rushing_epa','Rushing EPA'],['def_qb_hits','QB hits'],['def_sacks','Sacks'],['def_interceptions','Defensive interceptions'],['penalty_yards','Penalty yards']];
  return `<div class="fs-nfl-controls"><h2>TEAM LAB</h2><select id="fs-team-select" aria-label="Choose an NFL team">${teams.map(t => `<option value="${t.abbr}" ${state.team === t.abbr ? 'selected' : ''}>${esc(t.fullName)}</option>`).join('')}</select><label>Season <select id="fs-team-season">${Array.from({length:8},(_,i) => new Date().getFullYear()-i).map(y => `<option ${state.statsSeason === y ? 'selected' : ''}>${y}</option>`).join('')}</select></label></div><div class="fs-nfl-scroll fs-team-grid"><section class="fs-nfl-card"><div class="fs-team-identity" style="--club:${selected?.color || '#34674d'}"><span>${esc(selected?.abbr || '')}</span><div><h2>${esc(selected?.fullName || 'Choose a team')}</h2><p>${state.statsSeason || ''} SEASON STATISTICS</p></div></div><div class="fs-stats-tabs">${stats?.categories.map(c => btn(esc(c.label), `data-stats-category="${esc(c.name)}" aria-pressed="${c.name === category?.name}"`)).join('') || ''}</div>${category ? `<table><thead><tr><th>${esc(category.label)}</th><th>Total / value</th></tr></thead><tbody>${category.stats.map(s => `<tr><td>${esc(s.label)}</td><td>${esc(dash(s.display))}</td></tr>`).join('')}</tbody></table>` : `<p class="fs-nfl-muted">${esc(state.teamError || (stats ? 'No published statistics for this season. Select a previous season.' : 'Loading team statistics…'))}</p>`}<p class="fs-nfl-muted">${esc(fresh(stats?.meta))}</p></section><section class="fs-nfl-card"><h3>BEYOND THE BOX SCORE</h3><p class="fs-nfl-muted">${state.statsSeason || ''} regular season · nflverse</p>${advanced ? `<div class="fs-advanced-grid">${deeper.map(([key,label]) => `<div><span>${label}</span><strong>${advanced.stats[key] == null ? '—' : Number.isInteger(advanced.stats[key]) ? advanced.stats[key].toLocaleString() : advanced.stats[key].toFixed(2)}</strong></div>`).join('')}</div>` : `<p class="fs-nfl-muted">${esc(state.advancedError || 'Loading deeper team statistics…')}</p>`}<p class="fs-nfl-muted">EPA: expected points added. CPOE: completion percentage over expected. These are published after games and may include later corrections.</p><p class="fs-data-credit">Data: nflverse · github.com/nflverse/nflverse-data<br>CC BY 4.0 · creativecommons.org/licenses/by/4.0/<br>Selected and rounded for display.<br>${esc(state.advanced ? fresh(state.advanced.meta) : '')}</p></section></div>`;
}
function render() {
  // All NFL views keep the television shell, including the schedule and team lab.
  if (api.state.view === 'watch') { state.panel = 'watch'; header(); q('#ez-director-surface').hidden = true; root.classList.remove('ez-director'); return false; }
  if (state.panel === 'watch') state.panel = api.state.view === 'gameday' ? 'gameday' : api.state.view;
  preserveRender(() => {
    if (state.panel === 'gameday') director();
    else { q('#ez-director-surface').hidden = true; root.classList.remove('ez-director'); q('#ez-body').innerHTML = state.panel === 'schedule' ? schedule() : state.panel === 'standings' ? standings() : state.panel === 'teams' ? teams() : detail(); }
  });
  header(); return true;
}
function navigate(panel) { state.panel = panel; api.state.view = panel === 'game' ? 'gameday' : panel; api.render(); if (panel === 'standings') void loadStandings(); if (panel === 'teams') void loadTeam(); if (panel === 'game') void loadDetail(); }
async function loadStandings() {
  const generation = ++standingsRequest;
  try { const data = await request('standings' + (state.season ? '?season=' + state.season : '')); if (generation === standingsRequest) { state.standings = data; state.standingsError = ''; } }
  catch (e) { if (generation === standingsRequest) { state.standingsError = e.message; if (state.standings) state.standings.meta.stale = true; } }
  if (generation === standingsRequest && (state.panel === 'standings' || api.state.view === 'watch')) api.render();
}
async function loadDetail() {
  const id = state.selected; if (!id || detailBusy === id) return;
  const generation = ++detailRequest; detailBusy = id;
  try { const data = await request('game?id=' + id); if (generation === detailRequest && state.selected === id) { state.detail = data; state.detailError = ''; } }
  catch (e) { if (generation === detailRequest) { state.detailError = e.message; if (state.detail?.game.id === id) state.detail.meta.stale = true; } }
  finally { if (detailBusy === id) detailBusy = null; }
  if (state.panel === 'game') api.render();
}
async function loadTeam() {
  const selected = allTeams().find(t => t.abbr === state.team); if (!selected || !state.statsSeason) return;
  const key = selected.id + ':' + state.statsSeason; if (statsBusy === key) return;
  const generation = ++statsRequest; statsBusy = key; state.teamStats = null; state.teamError = ''; state.advanced = null; state.advancedError = '';
  if (state.panel === 'teams') api.render();
  await Promise.allSettled([
    request(`team?id=${selected.id}&season=${state.statsSeason}`).then(data => { if (generation === statsRequest) state.teamStats = data; }).catch(e => { if (generation === statsRequest) state.teamError = e.message; }),
    request('advanced?season=' + state.statsSeason).then(data => { if (generation === statsRequest) state.advanced = data; }).catch(e => { if (generation === statsRequest) state.advancedError = e.message; }),
  ]);
  if (statsBusy === key) statsBusy = null;
  if (state.panel === 'teams') api.render();
}
async function refresh() {
  const query = state.season ? `?season=${state.season}&week=${state.week || 1}&type=${state.type}` : '';
  if (boardPending === query) return;
  const generation = ++boardRequest; boardPending = query;
  try {
    const board = await request('scoreboard' + query); if (generation !== boardRequest) return;
    state.board = board; state.error = ''; bindTeams();
    if (!state.season) state.type = String(board.season.type);
    if ((state.auto && state.panel !== 'game') || !board.games.some(g => g.id === state.selected)) state.selected = [...board.games].sort((a,b) => gamePriority(b) - gamePriority(a))[0]?.id || null;
    if (!state.statsSeason) state.statsSeason = board.games.every(g => g.state === 'pre') ? (board.season.year || new Date().getFullYear()) - 1 : board.season.year;
    api.state.slots = api.state.slots.map(slot => typeof slot === 'number' ? board.games[slot] ? 'game:' + board.games[slot].id : 'dashboard' : String(slot).startsWith('game:') && !board.games.some(g => 'game:' + g.id === slot) ? 'dashboard' : slot);
  } catch (e) { if (generation === boardRequest) { state.error = e.message; if (state.board) state.board.meta.stale = true; } }
  finally { if (generation === boardRequest) { state.loading = false; boardPending = null; api.render(); if (state.panel === 'game') void loadDetail(); if (state.panel === 'teams' && !state.teamStats && !statsBusy) void loadTeam(); } }
}
root.fieldscreenNfl = {
  enabled: true, render, afterRender: header, matchBroadcasts, liveBroadcast,
  game: id => state.board?.games.find(g => g.id === id),
  activate() { state.panel = 'gameday'; api.state.view = 'gameday'; },
  coverage: channels => gameCoverage(state.board?.games || [], channels),
  sourceOptions(source, includeIptv = true) { return (includeIptv ? root.fieldscreenIptv?.sourceOptions(source) || '' : '') + `<optgroup label="NFL scorecards">${(state.board?.games || []).map(g => `<option value="game:${g.id}" ${source === 'game:' + g.id ? 'selected' : ''}>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</option>`).join('')}</optgroup><optgroup label="NFL data"><option value="nfl:dashboard" ${['dashboard','nfl:dashboard'].includes(source) ? 'selected' : ''}>League scoreboard</option><option value="nfl:standings" ${['standings','nfl:standings'].includes(source) ? 'selected' : ''}>Standings</option></optgroup>`; },
  feed(slot, headerHTML) {
    const source = api.state.slots[slot]; if (String(source).startsWith('iptv:')) return undefined;
    const game = state.board?.games.find(g => 'game:' + g.id === source);
    const body = game ? `<div class="fs-watch-scorecard">${scoreboard(game)}<span>${esc(game.state === 'pre' ? localTime(game.date) : game.detail)}</span><div>${pitch(game, 'watch-' + slot)}</div>${btn('Watch game ↗', `data-nfl-watch="${game.id}" data-watch-slot="${slot}"`)}</div>` : ['standings','nfl:standings'].includes(source) ? `<div class="fs-watch-data"><h3>NFL STANDINGS</h3>${state.standings?.divisions.map(d => `<p>${esc(d.name)}</p>${d.entries.map(e => `<div><span>${esc(e.team.abbr)}</span><b>${esc(val(e.stats,'wins'))}–${esc(val(e.stats,'losses'))}–${esc(val(e.stats,'ties'))}</b></div>`).join('')}`).join('') || '<p>Loading standings…</p>'}</div>` : `<div class="fs-watch-data"><h3>LEAGUE SCOREBOARD</h3>${state.board?.games.map(g => `<button ${g.live ? 'data-nfl-watch' : 'data-nfl-detail'}="${g.id}"><span>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}<small>${esc(g.state === 'pre' ? localTime(g.date) : g.detail)}</small></span><b>${esc(dash(g.away.score))} : ${esc(dash(g.home.score))}</b></button>`).join('') || '<p>Connecting to ESPN…</p>'}</div>`;
    return `<article class="ez-feed fs-nfl-feed" data-slot="${slot}">${headerHTML}${body}<div class="ez-feed-foot"><span>${esc(fresh(state.board?.meta))}</span><span>DATA PANE</span></div></article>`;
  },
  statusText: () => state.board ? fresh(state.board.meta) : 'Connecting to ESPN…',
};
api.deactivateDirector?.(); api.state.view = 'gameday';
q('.ez-tv-switch>span').id = 'fs-nfl-source';
q('.ez-tv-switch').insertBefore(Object.assign(document.createElement('span'), { className: 'fs-extra-tabs', innerHTML: [['schedule','Schedule'],['standings','Standings'],['teams','Teams']].map(([p,l]) => `<button data-nfl-view="${p}" aria-pressed="false">${l}</button>`).join('') }), q('.ez-tv-switch>span'));
root.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b) return;
  if (root.fieldscreenSports.active() !== 'nfl') {
    if (b.dataset.nflWatch) { const game = state.board?.games.find(g => g.id === b.dataset.nflWatch); if (game) root.fieldscreenIptv.openGame(game, Number(b.dataset.watchSlot || 0)); event.stopImmediatePropagation(); return; }
    if (b.dataset.nflDetail) root.fieldscreenSports.switchSport('nfl'); else return;
  }
  const panel = b.dataset.nflView || b.dataset.tvView || b.dataset.view || (b.dataset.cmd !== 'tv' ? b.dataset.cmd : null);
  if (panel || b.dataset.nflGame || b.dataset.nflDetail || b.dataset.nflWatch || b.dataset.nflTeam || b.dataset.nflConference || b.dataset.detailTab || b.dataset.statsCategory || b.dataset.fieldPage || b.hasAttribute('data-nfl-refresh') || b.hasAttribute('data-nfl-current') || ['ez-dir-auto','ez-dir-pin','ez-dir-play','ez-dir-detail'].includes(b.id)) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (b.dataset.cmd) q('#ez-close').click();
    if (panel) navigate(panel);
    else if (b.dataset.nflWatch) { const game = state.board?.games.find(g => g.id === b.dataset.nflWatch); if (game) root.fieldscreenIptv.openGame(game, Number(b.dataset.watchSlot || 0)); }
    else if (b.dataset.nflGame || b.dataset.nflDetail) {
      state.selected = b.dataset.nflGame || b.dataset.nflDetail; state.auto = false; state.detail = null; state.detailError = '';
      const game = state.board?.games.find(g => g.id === state.selected);
      if (b.dataset.nflGame && game?.live && root.fieldscreenIptv?.connected()) void root.fieldscreenIptv.openGame(game);
      else navigate(b.dataset.nflDetail ? 'game' : 'gameday');
    }
    else if (b.dataset.nflTeam) { state.team = b.dataset.nflTeam; navigate('teams'); }
    else if (b.dataset.nflConference) { state.conference = b.dataset.nflConference; api.render(); }
    else if (b.dataset.detailTab) { state.detailTab = b.dataset.detailTab; api.render(); }
    else if (b.dataset.statsCategory) { state.statsCategory = b.dataset.statsCategory; api.render(); }
    else if (b.dataset.fieldPage) { const pages = Math.max(1, Math.ceil((state.board?.games.length || 0) / 6)); state.fieldPage = (state.fieldPage + Number(b.dataset.fieldPage) + pages) % pages; api.render(); }
    else if (b.id === 'ez-dir-auto' || b.id === 'ez-dir-pin') { state.auto = !state.auto; if (state.auto && state.board) state.selected = [...state.board.games].sort((a,b) => gamePriority(b) - gamePriority(a))[0]?.id; api.render(); }
    else if (b.id === 'ez-dir-detail') navigate('game');
    else { if (b.hasAttribute('data-nfl-current')) { state.season = null; state.week = null; state.type = '2'; state.loading = true; state.board = null; api.render(); } void refresh(); if (state.panel === 'teams') void loadTeam(); if (state.panel === 'standings') void loadStandings(); }
  }
}, true);
root.addEventListener('change', event => {
  if (root.fieldscreenSports.active() !== 'nfl') return;
  const id = event.target.id;
  if (['fs-nfl-season','fs-nfl-week','fs-nfl-type'].includes(id)) { state.season = Number(q('#fs-nfl-season').value); state.week = Number(q('#fs-nfl-week').value); state.type = q('#fs-nfl-type').value; if (state.type !== '2' && state.week > 5) state.week = 1; state.loading = true; state.board = null; state.fieldPage = 0; api.render(); void refresh(); }
  if (id === 'fs-team-select' || id === 'fs-team-season') { state.team = q('#fs-team-select').value; state.statsSeason = Number(q('#fs-team-season').value); void loadTeam(); }
});
root.fieldscreenSports.register('nfl', root.fieldscreenNfl);
api.render();
request('teams').then(data => { state.teams = data.teams; bindTeams(); api.render(); if (state.panel === 'teams') void loadTeam(); }).catch(() => {});
void loadStandings(); void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
setInterval(() => { if (!document.hidden) void loadStandings(); }, 10 * 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
