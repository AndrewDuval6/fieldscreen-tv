import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { gamePriority, fieldPosition, matchBroadcasts } from '../scripts/nfl-core.mjs';
const require = createRequire(import.meta.url);
const { createNFL, normalizeScoreboard, normalizeStandings, normalizeGame, advancedStats, parseCSV } = require('../desktop/nfl.cjs');
const club = (id, abbreviation, name, displayName) => ({ id, abbreviation, name, displayName, color: '154734' });
const away = club('17', 'NE', 'Patriots', 'New England Patriots'), home = club('26', 'SEA', 'Seahawks', 'Seattle Seahawks');
const fixture = (status = 'pre') => ({ season: { year: 2026, type: 2 }, week: { number: 1 }, events: [{ id: '123', date: '2026-09-10T00:20Z', competitions: [{ id: '123', competitors: [{ homeAway: 'away', team: away, score: '0' }, { homeAway: 'home', team: home, score: { value: 7 } }], status: { period: 1, displayClock: '12:04', type: { state: status, description: status === 'pre' ? 'Scheduled' : 'In Progress', completed: status === 'post' } }, situation: { possession: '17', possessionText: 'SEA 7', distance: 7, shortDownDistanceText: '1st & Goal', isRedZone: true } }] }] });

test('Scheduled games have kickoff dates and no invented scores or possession; live zero scores survive', () => {
  const pre = normalizeScoreboard(fixture()).games[0];
  assert.equal(pre.away.score, null); assert.equal(pre.home.score, null); assert.equal(pre.possession, ''); assert.equal(fieldPosition(pre), null);
  assert.equal(new Date(pre.date).toISOString(), '2026-09-10T00:20:00.000Z');
  const live = normalizeScoreboard(fixture('in')).games[0];
  assert.equal(live.away.score, 0); assert.equal(live.home.score, 7); assert.equal(live.redZone, true); assert.equal(fieldPosition(live), 93);
  const raw = fixture('in'); raw.events[0].competitions[0].status.type.name = 'STATUS_SUSPENDED';
  assert.equal(normalizeScoreboard(raw).games[0].live, false);
  assert.throws(() => normalizeScoreboard({}));
});

test('Field positions require an identified possession and respect both halves and aliases', () => {
  const game = normalizeScoreboard(fixture('in')).games[0];
  assert.equal(fieldPosition({ ...game, possessionText: 'NE 7' }), 7);
  assert.equal(fieldPosition({ ...game, possessionText: '50' }), null);
  assert.equal(fieldPosition({ ...game, possession: 'unknown', position: 80 }), null);
  assert.equal(fieldPosition({ ...game, possessionText: 'DAL 7' }), null);
  assert.equal(fieldPosition({ ...game, possessionText: 'SEA 75' }), null);
  assert.equal(fieldPosition({ ...game, live: false, position: 90 }), null);
  assert.equal(fieldPosition({ ...game, away: { ...game.away, abbr: 'JAX' }, possessionText: 'JAC 22' }), 22);
  assert(gamePriority(game) > gamePriority({ ...game, live: false, state: 'pre' }));
});

test('Standings retain every division, 0 values and team abbreviation mappings', () => {
  const raw = { season: { year: 2026 }, children: ['AFC','NFC'].map(conference => ({ abbreviation: conference, children: ['East','North','South','West'].map(name => ({ name: `${conference} ${name}`, standings: { entries: [{ team: club('1','JAC','Jaguars','Jacksonville Jaguars'), stats: [{ name: 'wins', value: 0, displayValue: '0' }] }] } })) })) };
  const data = normalizeStandings(raw); assert.equal(data.divisions.length, 8); assert.equal(data.divisions[0].entries[0].team.abbr, 'JAX'); assert.equal(data.divisions[0].entries[0].stats[0].value, 0);
});

test('Game summaries deduplicate current drive plays and use only a reported field position', () => {
  const board = fixture('in'), p = { id: 'p1', sequenceNumber: '100', text: 'A reported pass.', clock: { displayValue: '12:04' }, period: { number: 1 }, statYardage: 12, end: { team: { id: '17' }, yardsToEndzone: 7, down: 1, distance: 7, downDistanceText: '1st & Goal', possessionText: 'SEA 7' } };
  const data = normalizeGame({ header: board.events[0], drives: { previous: [{ plays: [p] }], current: { plays: [p] } } });
  assert.equal(data.plays.length, 1); assert.equal(data.plays[0].yards, 12); assert.equal(data.game.position, 93);
  assert.equal(data.game.positionSource, 'Latest reported play'); assert.equal(data.scoring.length, 0);
  assert.throws(() => normalizeGame({}));
});

test('nflverse import handles quotes and distinguishes missing metrics from zero', () => {
  const csv = 'season,team,games,passing_epa,passing_cpoe,note\r\n2025,LA,17,-5.25,,"a, quoted \"\"value\"\""\r\n';
  assert.equal(parseCSV(csv)[0].note, 'a, quoted "value"');
  const data = advancedStats(csv).teams[0]; assert.equal(data.team, 'LAR'); assert.equal(data.stats.games, 17); assert.equal(data.stats.passing_epa, -5.25); assert.equal(data.stats.passing_cpoe, null);
  assert.throws(() => parseCSV('<html>Not available</html>'));
});

test('Broadcast discovery ranks two-team listings above possible matches and excludes expired or mistimed programmes', () => {
  const game = normalizeScoreboard(fixture()).games[0], now = Date.parse(game.date) - 30 * 60000;
  const program = { title: 'NFL: New England Patriots at Seattle Seahawks', description: 'Live football', start: Date.parse(game.date) - 15 * 60000, end: Date.parse(game.date) + 4 * 3600000 };
  const channels = [
    { id: 'one', name: 'Sports 1', programs: [{ ...program, title: 'Patriots coverage' }] },
    { id: 'full', name: 'Sports 2', programs: [program] },
    { id: 'expired', name: 'Sports 3', programs: [{ ...program, start: now - 7200000, end: now - 1 }] },
    { id: 'replay', name: 'Sports 4', programs: [{ ...program, start: now + 86400000, end: now + 90000000 }] },
    { id: 'wrong', name: 'Sports 5', programs: [{ ...program, title: 'Chiefs at Bills' }] },
    { id: 'named', name: 'Patriots vs Seahawks', programs: [] },
  ];
  const results = matchBroadcasts(game, channels, now);
  assert.deepEqual(results.map(c => c.id), ['full','named','one']); assert.equal(results[0].matchedProgram, program);
  assert.match(results[2].confidence, /Possible/); assert.equal(channels[1].matchScore, undefined);
});

test('NFL service coalesces requests, preserves cached data on failure, backs off and rejects unsafe inputs', async () => {
  let clock = Date.UTC(2026,8,9), calls = 0, fail = false;
  const service = createNFL({ now: () => clock, fetcher: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 8)); return new Response(JSON.stringify(fixture()), { status: fail ? 503 : 200 }); } });
  const server = http.createServer((req,res) => service.handle(req,res,() => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/preview/nfl/';
  const get = (route='scoreboard', headers={}) => fetch(base + route, { headers: { 'X-FieldScreen': '1', ...headers } });
  try {
    assert.equal((await fetch(base + 'scoreboard')).status,403);
    assert.equal((await get('scoreboard', { Origin: 'https://foreign.example' })).status,403);
    assert.equal((await get('game?id=../../secret')).status,400);
    assert.equal((await get('scoreboard?week=1')).status,400);
    assert.equal((await get('scoreboard?season=2099')).status,400);
    const responses = await Promise.all([get(),get(),get()]); assert.equal(calls,1);
    const initial = await responses[0].json(); assert.equal(initial.meta.stale,false); assert.equal(initial.meta.updatedAt,clock);
    await get(); assert.equal(calls,1);
    clock += 26000; fail = true;
    const stale = await (await get()).json(); assert.equal(stale.meta.stale,true); assert.equal(stale.games.length,1); assert.equal(stale.meta.updatedAt,initial.meta.updatedAt);
    await get(); assert.equal(calls,2);
    clock += 61000; fail = false;
    assert.equal((await (await get()).json()).meta.stale,false); assert.equal(calls,3);
  } finally { service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
