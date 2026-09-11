import { FAVORITES_KEY, teamKey, normalizeFavorites, favoriteGames, createFavoriteStore } from './favorites-core.mjs';

const root = document.getElementById('fieldscreen-concept'), api = root.fieldscreenConcept;
const q = selector => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button = (label, attrs = '') => `<button class="ez-button" ${attrs}>${label}</button>`;
const data = new Map(), catalogs = new Map(), errors = new Map(), pending = new Set();
let favorites = [], ready = false, saving = false, storageError = '', editing = false, filter = 'all', search = '', refreshed = 0;
const active = () => api.state.view === 'favorites';
const leagues = () => root.fieldscreenSports.teamLeagues();
const allGames = () => [...data.values()].flatMap(board => board.games || []);
const allTeams = () => [...catalogs].flatMap(([league, teams]) => teams.filter(t => t.id && !t.placeholder).map(t => ({ ...t, league }))).sort((a,b) => a.fullName.localeCompare(b.fullName));
const picked = (league, team) => favorites.includes(teamKey(league, team));
const store = window.fieldscreenDesktop ? {
  read: () => window.fieldscreenDesktop.favoriteTeams(),
  write: keys => window.fieldscreenDesktop.saveFavoriteTeams(keys),
} : createFavoriteStore({getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value)});

function teamButton(league, team, compact = false) {
  if (!team?.id || team.placeholder) return '';
  const selected = picked(league, team), name = team.fullName || team.name || team.abbr;
  return button(`<span aria-hidden="true">${selected ? '★' : '☆'}</span> ${compact ? selected ? 'Following' : 'Follow team' : esc(name)}`, `data-favorite-team="${esc(teamKey(league, team))}" aria-pressed="${selected}" aria-label="${selected ? 'Unfollow' : 'Follow'} ${esc(name)} (${esc(league.toUpperCase())})" ${!ready || saving ? 'disabled' : ''}`);
}
async function loadSaved() {
  ready = false;
  try { favorites = normalizeFavorites(await store.read()); storageError = ''; ready = true; }
  catch { storageError = 'Saved teams could not be read. Check device storage and try again.'; }
  api.render();
}
async function toggle(key) {
  if (!ready || saving) return;
  // The first selection stays in the picker so several teams can be followed.
  if (active() && !favorites.length) editing = true;
  saving = true;
  try {
    const next = favorites.includes(key) ? favorites.filter(k => k !== key) : [...favorites, key];
    favorites = normalizeFavorites(await store.write(next)); storageError = '';
  } catch { storageError = 'Your change was not saved. Check free space and app storage, then try again.'; }
  finally { saving = false; api.render(); if (storageError) { q('#ez-status').textContent = storageError; q('#ez-status').classList.add('fs-data-warning'); } }
}
async function load(league, kind) {
  const key = `${league}:${kind}`;
  if (pending.has(key)) return;
  pending.add(key);
  try {
    const response = await fetch(`./${league}/${kind}`, { headers: {'X-FieldScreen':'1'}, credentials:'omit', cache:'no-store' });
    const result = await response.json();
    if (!response.ok || !Array.isArray(kind === 'teams' ? result.teams : result.games)) throw Error();
    if (kind === 'teams') catalogs.set(league, result.teams);
    else data.set(league, result);
    errors.delete(key);
  } catch {
    errors.set(key, `${league.toUpperCase()} ${kind === 'teams' ? 'teams' : 'games'} could not be updated.`);
    if (kind !== 'teams' && data.has(league)) data.get(league).meta = { ...data.get(league).meta, stale: true };
  } finally { pending.delete(key); if (active()) api.render(); }
}
async function refresh(force = false) {
  if (!force && Date.now() - refreshed < 25000) return;
  refreshed = Date.now();
  const requests = leagues().flatMap(league => [load(league, 'favorites'), ...(!catalogs.has(league) ? [load(league, 'teams')] : [])]);
  if (active()) api.render();
  await Promise.allSettled(requests);
}
function open() {
  root.fieldscreenPanes?.exit(); api.state.view = 'favorites'; editing = !favorites.length;
  api.render(); void refresh();
  q('#fs-favorites-manage')?.focus();
}
function header() {
  root.classList.add('fs-favorites-active', 'fs-nfl-connected', 'ez-tv'); root.classList.remove('ez-director');
  q('#ez-director-surface').hidden = true; q('.ez-heading-controls').hidden = true;
  q('#ez-title').textContent = 'YOUR TEAMS / ALL SPORTS';
  q('#ez-view-label').textContent = `${favorites.length} FOLLOWING · LIVE + NEXT 7 DAYS`;
  q('#ez-output-state').textContent = 'FAVORITES · ALL LEAGUES';
  q('#ez-status').textContent = storageError || (ready ? 'FAVORITE TEAMS SAVED ON THIS DEVICE' : 'READING YOUR SAVED TEAMS…');
  q('#ez-status').classList.toggle('fs-data-warning', Boolean(storageError));
  root.querySelectorAll('[data-tv-view],[data-nfl-view],[data-mlb-view],[data-favorites-view]').forEach(b => b.setAttribute('aria-pressed', String(b.hasAttribute('data-favorites-view'))));
  q('#fs-sport-select').value = 'favorites';
}
function chooseTeams() {
  const catalog = allTeams().filter(t => (filter === 'all' || t.league === filter) && `${t.fullName} ${t.abbr} ${t.league}`.toLowerCase().includes(search.trim().toLowerCase()));
  return `<div class="fs-favorite-tools"><input id="fs-favorite-search" type="search" placeholder="Search every team…" aria-label="Search favorite teams" value="${esc(search)}"><div>${[['all','All leagues'],...leagues().map(l => [l,l.toUpperCase()])].map(([key,label]) => button(label,`data-favorite-filter="${key}" aria-pressed="${key === filter}"`)).join('')}</div><span>${favorites.length} following</span></div><div class="fs-nfl-scroll fs-favorite-picker">${catalog.map(t => `<div class="fs-favorite-team"><span class="fs-favorite-badge">${esc(t.league.toUpperCase())} · ${esc(t.abbr)}</span>${teamButton(t.league, t)}</div>`).join('') || `<div class="fs-favorite-empty"><strong>${pending.size ? 'Loading teams…' : 'No matching teams'}</strong><p>${pending.size ? 'Getting the latest team lists.' : 'Try another name or league.'}</p></div>`}</div>`;
}
function gameCard(game) {
  const league = game.league, cached = data.get(league)?.meta?.stale;
  const label = game.live ? game.detail || game.status : game.complete ? game.status || 'Final' : game.state === 'pre' ? game.timeTBD ? 'Time TBD' : new Date(game.date).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : game.status;
  const canRecord = !game.complete && !game.timeTBD && !game.home.placeholder && !game.away.placeholder;
  return `<article class="fs-favorite-game ${game.live ? 'is-live' : ''}"><div class="fs-favorite-game-top"><span>${esc(league.toUpperCase())}${game.doubleHeader ? ` · GAME ${esc(game.gameNumber)}` : ''}</span><b>${cached ? 'CACHED · ' : ''}${game.live ? '● LIVE' : game.complete ? 'FINAL' : 'UPCOMING'}</b></div><div class="fs-favorite-matchup">${[game.away, game.home].map(t => `<div><span class="fs-favorite-abbr">${esc(t.abbr)}</span><span class="fs-favorite-name">${esc(t.fullName)}${picked(league,t) ? '<i aria-label="Favorite team">★</i>' : ''}</span><strong>${game.state === 'pre' ? '—' : esc(t.score ?? '—')}</strong></div>`).join('')}</div><p>${esc(label || 'Status unavailable')}</p><small>${esc(game.network || game.venue || '')}</small><div class="fs-favorite-actions">${game.live ? button('▶ Watch live',`data-favorite-watch="${esc(league + ':' + game.id)}"`) : ''}${canRecord ? button('● Record game',`data-record-game="${esc(league + ':' + game.id)}"`) : ''}</div></article>`;
}
function gamesView() {
  const games = favoriteGames(allGames(), favorites);
  const selected = allTeams().filter(t => picked(t.league,t));
  const strip = `<div class="fs-favorite-following">${selected.map(t => `<span>${esc(t.league.toUpperCase())} <b>${esc(t.abbr)}</b> ★</span>`).join('')}</div>`;
  if (!games.length) return strip + `<div class="fs-nfl-scroll fs-favorite-empty"><span aria-hidden="true">☆</span><h3>${pending.size ? 'Finding your teams’ games…' : errors.size ? 'Your games are unavailable' : 'Your teams are off the clock'}</h3><p>${pending.size ? 'Checking live scores and upcoming schedules across leagues.' : errors.size ? 'Refresh to try the league feeds again.' : 'No games were listed for yesterday through the next seven days. Your teams stay saved here.'}</p>${button('Choose teams','data-favorite-edit')}${button('Refresh games','data-favorite-refresh')}</div>`;
  const sections = [['Live now', games.filter(g => g.live)], ['Coming up', games.filter(g => !g.live && !g.complete)], ['Recent results', games.filter(g => g.complete)]];
  return strip + `<div class="fs-nfl-scroll fs-favorite-games">${sections.filter(([,gs]) => gs.length).map(([title,gs]) => `<section><h3>${title}<span>${gs.length}</span></h3><div class="fs-favorite-grid">${gs.map(gameCard).join('')}</div></section>`).join('')}</div>`;
}
function render() {
  const focused = document.activeElement, inside = q('#ez-body').contains(focused);
  const identity = inside ? focused?.id ? '#' + CSS.escape(focused.id) : [...(focused?.attributes || [])].find(a => a.name.startsWith('data-favorite') || a.name === 'data-record-game') : null;
  const selector = typeof identity === 'string' ? identity : identity ? `[${identity.name}="${CSS.escape(identity.value)}"]` : null;
  const cursor = focused?.id === 'fs-favorite-search' ? focused.selectionStart : null, scroll = q('.fs-nfl-scroll')?.scrollTop || 0;
  const choosing = editing || !favorites.length;
  const notices = [...errors.values()];
  if ([...data.values()].some(board => board.meta?.stale) && !notices.length) notices.push('Showing cached scores. Live status may have changed.');
  q('#ez-body').innerHTML = `<div class="fs-nfl-controls fs-favorite-heading"><div><h2>${choosing ? 'Choose your teams' : 'Your favorites'}</h2><p>${choosing ? 'Follow teams from any league. Every game, one place.' : 'Live now, the next seven days, and recent results.'}</p></div>${button(choosing && favorites.length ? 'Done' : 'Manage teams', 'id="fs-favorites-manage" data-favorite-edit')}${button('Refresh','data-favorite-refresh')}</div>${storageError ? `<div class="fs-favorite-notice" role="status">${esc(storageError)} ${!ready ? button('Retry storage','data-favorite-storage') : ''}</div>` : ''}${notices.length ? `<div class="fs-favorite-notice" role="status">${esc(notices.join(' '))}</div>` : ''}${!ready ? '<div class="fs-favorite-empty"><p>' + (storageError ? 'Your saved choices have been kept unchanged.' : 'Reading your saved teams…') + '</p></div>' : choosing ? chooseTeams() : gamesView()}`;
  header();
  if (q('.fs-nfl-scroll')) q('.fs-nfl-scroll').scrollTop = scroll;
  if (selector && !focused.isConnected && q('#fs-iptv-modal').hidden && !root.fieldscreenRecordings?.isOpen()) {
    const target = q(selector); target?.focus({preventScroll:true});
    if (cursor != null) target?.setSelectionRange(cursor,cursor);
  }
  return true;
}
const tab = document.createElement('button'); tab.dataset.favoritesView = ''; tab.textContent = '★ Favorites'; tab.setAttribute('aria-pressed','false');
q('.ez-tv-switch').insertBefore(tab, q('[data-tv-view="watch"]'));
const option = document.createElement('option'); option.value = 'favorites'; option.textContent = 'All'; option.disabled = true; option.hidden = true; q('#fs-sport-select').append(option);
root.fieldscreenFavorites = { open, render, teamButton, game: (league,id) => data.get(league)?.games.find(g => g.id === id), back() { if (active() && editing) { editing = false; api.render(); return true; } return false; } };
root.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b) return;
  if (![...b.attributes].some(a => a.name.startsWith('data-favorite'))) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (b.hasAttribute('data-favorites-view')) open();
  else if (b.dataset.favoriteTeam) void toggle(b.dataset.favoriteTeam);
  else if (b.hasAttribute('data-favorite-edit')) { editing = !editing; search = ''; api.render(); if (editing || !favorites.length) q('#fs-favorite-search')?.focus(); }
  else if (b.dataset.favoriteFilter) { filter = b.dataset.favoriteFilter; api.render(); }
  else if (b.hasAttribute('data-favorite-refresh')) void refresh(true);
  else if (b.hasAttribute('data-favorite-storage')) void loadSaved();
  else if (b.dataset.favoriteWatch) { const [league,id] = b.dataset.favoriteWatch.split(':'), game = root.fieldscreenFavorites.game(league,id); if (game) void root.fieldscreenIptv.openGame(game); }
}, true);
root.addEventListener('input', event => { if (event.target.id === 'fs-favorite-search') { search = event.target.value; render(); } });
window.addEventListener('storage', event => { if (!window.fieldscreenDesktop && event.key === FAVORITES_KEY) void loadSaved(); });
setInterval(() => { if (active() && !document.hidden) void refresh(); }, 30000);
document.addEventListener('visibilitychange', () => { if (active() && !document.hidden) void refresh(); });
void loadSaved();
