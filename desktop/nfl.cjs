const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
const PREFIX = '/preview/nfl/';
const text = (value, max = 240) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const identifier = value => /^\d{1,12}$/.test(String(value)) ? String(value) : '';
const list = value => Array.isArray(value) ? value : [];
const abbreviation = value => ({ LA: 'LAR', WSH: 'WAS', JAC: 'JAX' })[value] || value;
function team(raw = {}) {
  return { id: identifier(raw.id), abbr: abbreviation(text(raw.abbreviation, 5).toUpperCase().replace(/[^A-Z0-9]/g, '')), name: text(raw.name, 50), city: text(raw.location, 50), fullName: text(raw.displayName, 100), color: /^[a-f0-9]{6}$/i.test(raw.color) ? '#' + raw.color : '#82bdae' };
}
function statistics(values) {
  return list(values).map(stat => ({ name: text(stat.name, 80), label: text(stat.label || stat.displayName || stat.name, 100), value: number(stat.value), display: text(stat.displayValue ?? stat.value, 40) }));
}
function competition(raw, fallback = {}) {
  const sides = list(raw.competitors), away = sides.find(c => c.homeAway === 'away'), home = sides.find(c => c.homeAway === 'home');
  if (!away?.team || !home?.team || !identifier(raw.id || fallback.id)) return null;
  const status = raw.status || fallback.status || {}, state = status.type?.state;
  const situation = raw.situation || {};
  const live = state === 'in' && !/DELAY|SUSPEND|POSTPON|CANCEL/i.test(status.type?.name || '');
  const record = side => text(side.records?.find(r => r.type === 'total')?.summary || side.record?.find?.(r => r.type === 'total')?.displayValue || '');
  return {
    league: 'nfl', id: identifier(raw.id || fallback.id), name: text(fallback.name || `${away.team.displayName} at ${home.team.displayName}`), date: text(raw.date || fallback.date),
    away: { ...team(away.team), score: state === 'pre' ? null : number(away.score?.value ?? away.score), record: record(away), quarters: list(away.linescores).map(s => number(s.value)), statistics: statistics(away.statistics) },
    home: { ...team(home.team), score: state === 'pre' ? null : number(home.score?.value ?? home.score), record: record(home), quarters: list(home.linescores).map(s => number(s.value)), statistics: statistics(home.statistics) },
    state: ['pre', 'in', 'post'].includes(state) ? state : 'unknown', live, complete: Boolean(status.type?.completed), status: text(status.type?.description || 'Status unavailable'), statusName: text(status.type?.name), detail: text(status.type?.shortDetail || status.type?.detail), period: number(status.period), clock: text(status.displayClock),
    venue: text(raw.venue?.fullName), network: text(list(raw.broadcasts).flatMap(b => b.names || [b.media?.shortName]).filter(Boolean).join(' / ') || raw.broadcast),
    possession: live ? text(situation.possession, 12) : '', down: live ? text(situation.shortDownDistanceText || situation.downDistanceText) : '', possessionText: live ? text(situation.possessionText) : '', yardLine: live ? number(situation.yardLine) : null, distance: live ? number(situation.distance) : null, redZone: live && situation.isRedZone === true,
    lastPlay: text(situation.lastPlay?.text, 1500), timeoutAway: number(situation.awayTimeouts), timeoutHome: number(situation.homeTimeouts),
  };
}
function normalizeScoreboard(raw) {
  if (!Array.isArray(raw.events)) throw Error('Unrecognized scoreboard response');
  const season = raw.season || raw.leagues?.[0]?.season || {};
  return { season: { year: number(season.year), type: number(season.type?.type ?? season.type) || 2 }, week: number(raw.week?.number), games: raw.events.map(event => competition(event.competitions?.[0] || {}, event)).filter(Boolean) };
}
function normalizeStandings(raw) {
  const divisions = [];
  for (const conference of list(raw.children)) {
    for (const division of (conference.children || [conference])) {
      divisions.push({ name: text(division.name), conference: text(conference.abbreviation || conference.name), entries: list(division.standings?.entries).map(entry => ({ team: team(entry.team), stats: statistics(entry.stats) })) });
    }
  }
  if (!divisions.length) throw Error('Standings unavailable');
  return { season: number(raw.season?.year), divisions };
}
function normalizeGame(raw) {
  const game = competition(raw.header?.competitions?.[0] || {}, raw.header || {});
  if (!game) throw Error('Game details unavailable');
  const drives = [...list(raw.drives?.previous), ...(raw.drives?.current ? [raw.drives.current] : [])];
  const allPlays = [...new Map(drives.flatMap(d => list(d.plays)).map(p => [String(p.id), p])).values()].sort((a, b) => (number(a.sequenceNumber) || 0) - (number(b.sequenceNumber) || 0));
  const latest = allPlays.at(-1), end = latest?.end;
  if (game.live && end?.team?.id && number(end.yardsToEndzone) !== null && number(end.down) > 0) {
    game.possession = String(end.team.id); game.position = 100 - Number(end.yardsToEndzone); game.distance = number(end.distance);
    game.down = text(end.shortDownDistanceText || end.downDistanceText); game.possessionText = text(end.possessionText); game.redZone = Number(end.yardsToEndzone) <= 20; game.positionSource = 'Latest reported play';
  }
  const play = p => ({ id: text(p.id), text: text(p.text, 1500), clock: text(p.clock?.displayValue), period: number(p.period?.number), yards: number(p.statYardage), scoring: Boolean(p.scoringPlay), awayScore: number(p.awayScore), homeScore: number(p.homeScore) });
  return { game, stats: list(raw.boxscore?.teams).map(t => ({ teamId: text(t.team?.id, 12), stats: statistics(t.statistics) })), plays: allPlays.slice(-40).reverse().map(play), scoring: list(raw.scoringPlays).slice(-20).reverse().map(play), leaders: list(raw.boxscore?.players).map(t => ({ teamId: text(t.team?.id, 12), categories: list(t.statistics).map(c => ({ name: text(c.name), labels: list(c.labels).map(x => text(x, 30)), players: list(c.athletes).slice(0, 8).map(p => ({ name: text(p.athlete?.displayName), stats: list(p.stats).map(x => text(x, 40)) })) })) })), drive: text(raw.drives?.current?.description || ''), venue: text(raw.gameInfo?.venue?.fullName || game.venue) };
}
function parseCSV(input) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) { row.push(field.replace(/\r$/, '')); field = ''; if (c === '\n') { rows.push(row); row = []; } }
    else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (quoted) throw Error('Invalid CSV');
  const headers = rows.shift();
  if (!headers?.includes('team') || !headers.includes('season')) throw Error('Unrecognized nflverse data');
  return rows.filter(r => r.length === headers.length).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}
function advancedStats(csv) {
  const fields = ['games', 'completions', 'attempts', 'passing_yards', 'passing_tds', 'passing_interceptions', 'passing_epa', 'passing_cpoe', 'passing_air_yards', 'passing_yards_after_catch', 'carries', 'rushing_yards', 'rushing_tds', 'rushing_epa', 'def_sacks', 'def_qb_hits', 'def_interceptions', 'def_pass_defended', 'penalties', 'penalty_yards', 'fg_made', 'fg_att'];
  return { teams: parseCSV(csv).map(row => ({ team: abbreviation(row.team), season: number(row.season), stats: Object.fromEntries(fields.map(key => [key, number(row[key])])) })) };
}

function createNFL({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map(), requests = new Set();
  // Expire live data before the 30-second UI poll to allow for request latency.
  async function load(key, url, normalize, ttl, source = 'ESPN') {
    let entry = cache.get(key);
    const response = () => ({ ...entry.data, meta: { source, updatedAt: entry.updatedAt, stale: Boolean(entry.error), warning: entry.error || '' } });
    if (entry && entry.next > now()) { if (entry.data) return response(); throw Error(entry.error); }
    if (entry?.job) return entry.job;
    if (!entry) { entry = {}; cache.set(key, entry); }
    if (cache.size > 150) for (const [id, item] of cache) { if (id !== key && !item.job) { cache.delete(id); break; } }
    entry.job = (async () => {
      const controller = new AbortController(); requests.add(controller);
      try {
        const res = await fetcher(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]), headers: { Accept: source === 'nflverse' ? 'text/csv' : 'application/json', 'User-Agent': 'FieldScreenTV/0.1' } });
        if (!res.ok) throw Error(res.status === 404 ? `${source} has not published this season’s data yet.` : `${source} is unavailable. Please try again shortly.`);
        const reader = res.body.getReader(), chunks = []; let size = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 12 * 1024 * 1024) { await reader.cancel(); throw Error('The data response is too large.'); } chunks.push(value); }
        const raw = Buffer.concat(chunks).toString(); entry.data = normalize(source === 'nflverse' ? raw : JSON.parse(raw)); entry.updatedAt = now(); entry.next = now() + ttl; entry.error = '';
        return response();
      } catch (error) {
        entry.error = error.message?.startsWith(source) ? error.message : `${source} could not be reached. Showing the last successful update when available.`; entry.next = now() + 60000;
        if (entry.data) return response(); throw Error(entry.error);
      } finally { requests.delete(controller); entry.job = null; }
    })();
    return entry.job;
  }
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' }); res.end(JSON.stringify(data)); };
  async function handle(req, res, next) {
    if (!req.url?.startsWith(PREFIX)) return next();
    try {
      const origin = new URL('http://' + req.headers.host);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || req.headers['x-fieldscreen'] !== '1' || (req.headers.origin && req.headers.origin !== origin.origin) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Open NFL data from FieldScreen TV.' });
      if (req.method !== 'GET') return json(res, 405, { error: 'Read-only data endpoint.' });
      const url = new URL(req.url, origin), route = url.pathname.slice(PREFIX.length), params = url.searchParams;
      const season = params.get('season'), week = params.get('week'), type = params.get('type') || '2', id = params.get('id');
      if ((season && (!/^\d{4}$/.test(season) || +season < 2000 || +season > new Date(now()).getFullYear() + 1)) || (week && (!/^\d{1,2}$/.test(week) || +week < 1 || +week > 23)) || !['1', '2', '3'].includes(type) || (id && !/^\d{1,12}$/.test(id))) return json(res, 400, { error: 'Choose a valid NFL season, week, or team.' });
      let result;
      if (route === 'scoreboard') {
        const query = new URLSearchParams({ limit: '1000' });
        if (season) query.set('dates', season);
        if (week) { if (!season) return json(res, 400, { error: 'Select a season with the week.' }); query.set('week', week); query.set('seasontype', type); }
        result = await load(`scoreboard:${query}`, BASE + 'scoreboard?' + query, normalizeScoreboard, 25000);
      } else if (route === 'teams') {
        result = await load('teams', BASE + 'teams?limit=100', raw => { const teams = list(raw.sports?.[0]?.leagues?.[0]?.teams).map(t => team(t.team)); if (!teams.length) throw Error('Missing teams'); return { teams }; }, 86400000);
      } else if (route === 'standings') {
        result = await load('standings:' + (season || 'current'), 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3' + (season ? '&season=' + season : ''), normalizeStandings, 10 * 60000);
      } else if (route === 'game' && id) result = await load('game:' + id, BASE + 'summary?event=' + id, normalizeGame, 25000);
      else if (route === 'team' && id && season) {
        result = await load(`team:${id}:${season}`, BASE + `teams/${id}/statistics?season=${season}`, raw => ({ team: team(raw.team), season: number(raw.requestedSeason?.year ?? raw.season?.year) || +season, categories: list(raw.results?.stats?.categories).map(c => ({ name: text(c.name), label: text(c.displayName || c.name), stats: statistics(c.stats) })) }), 30 * 60000);
      } else if (route === 'advanced' && season) {
        result = await load('advanced:' + season, `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_reg_${season}.csv`, advancedStats, 6 * 3600000, 'nflverse');
      } else return json(res, 404, { error: 'Unknown NFL data request.' });
      json(res, 200, result);
    } catch (error) { json(res, 502, { error: error.message || 'NFL data is unavailable.' }); }
  }
  return { handle, close() { requests.forEach(c => c.abort()); cache.clear(); } };
}
module.exports = { createNFL, normalizeScoreboard, normalizeStandings, normalizeGame, advancedStats, parseCSV, abbreviation };
