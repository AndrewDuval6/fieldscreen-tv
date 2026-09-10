const BASE = 'https://statsapi.mlb.com/';
const PREFIX = '/preview/mlb/';
const text = (v, max = 240) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
const num = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const list = v => Array.isArray(v) ? v : [];
const id = v => /^\d{1,12}$/.test(String(v)) ? String(v) : '';
const colors = { AZ:'A71930', ARI:'A71930', ATL:'CE1141', BAL:'DF4601', BOS:'BD3039', CHC:'0E3386', CWS:'80858A', CIN:'C6011F', CLE:'E50022', COL:'8A6CC2', DET:'FA4616', HOU:'EB6E1F', KC:'004687', LAA:'BA0021', LAD:'005A9C', MIA:'00A3E0', MIL:'FFC52F', MIN:'D31145', NYM:'FF5910', NYY:'8099BB', ATH:'EFB21E', PHI:'E81828', PIT:'FDB827', SD:'FFC425', SF:'FD5A1E', SEA:'2CBBA0', STL:'C41E3A', TB:'8FBCE6', TEX:'C0111F', TOR:'134A8E', WSH:'AB0003' };
function team(raw = {}) {
  const abbr = text(raw.abbreviation || raw.teamCode || raw.name, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return { id: id(raw.id), abbr, name: text(raw.teamName || raw.name, 80), fullName: text(raw.name, 100), city: text(raw.locationName), color: '#' + (colors[abbr] || '82BDAE'), placeholder: Boolean(raw.placeholder) };
}
function game(raw) {
  if (!id(raw.gamePk) || !raw.teams?.away?.team || !raw.teams?.home?.team) return null;
  const line = raw.linescore || {}, status = raw.status || {}, phase = status.abstractGameState;
  const complete = phase === 'Final' && !/postpon|cancel|suspend/i.test(status.detailedState || '');
  const live = phase === 'Live' && !/delay|suspend|postpon|cancel|warmup/i.test(status.detailedState || '');
  const side = key => { const s = raw.teams[key], totals = line.teams?.[key] || {}; return { ...team(s.team), score: phase === 'Preview' ? null : num(s.score ?? totals.runs), hits: num(totals.hits), errors: num(totals.errors), record: s.leagueRecord ? `${s.leagueRecord.wins}–${s.leagueRecord.losses}` : '', innings: list(line.innings).map(i => num(i[key]?.runs)) }; };
  const playState = live && Boolean(line.offense) && !['Middle','End'].includes(line.inningState) && line.outs !== 3;
  return { league: 'mlb', id: id(raw.gamePk), date: text(raw.gameDate), officialDate: text(raw.officialDate), season: num(raw.season), away: side('away'), home: side('home'), state: complete ? 'post' : phase === 'Preview' ? 'pre' : 'in', live, complete,
    status: text(status.detailedState || 'Status unavailable'), timeTBD: Boolean(status.startTimeTBD), inning: num(line.currentInning), half: text(line.inningState || line.inningHalf), balls: playState ? num(line.balls) : null, strikes: playState ? num(line.strikes) : null, outs: live ? num(line.outs) : null,
    bases: ['first','second','third'].map(base => playState ? Boolean(line.offense?.[base]?.id) : null), runners: ['first','second','third'].map(base => playState ? text(line.offense?.[base]?.fullName) : ''), batter: playState ? text(line.offense?.batter?.fullName) : '', pitcher: playState ? text(line.defense?.pitcher?.fullName) : '',
    venue: text(raw.venue?.name), network: list(raw.broadcasts).filter(b => b.type === 'TV').map(b => text(b.name, 70)).filter((v,i,a) => a.indexOf(v) === i).join(' / '),
    gameType: text(raw.gameType), doubleHeader: raw.doubleHeader !== 'N' && Boolean(raw.doubleHeader), gameNumber: num(raw.gameNumber), seriesGame: num(raw.seriesGameNumber), series: text(raw.seriesDescription), seriesStatus: text(raw.seriesStatus?.result || raw.seriesStatus?.shortDescription || raw.seriesStatus?.description), ifNecessary: raw.ifNecessary === 'Y', lastPlay: '' };
}
function normalizeSchedule(raw) {
  if (!Array.isArray(raw.dates)) throw Error('Missing schedule');
  return { games: raw.dates.flatMap(d => list(d.games)).map(game).filter(Boolean) };
}
function normalizeStandings(raw) {
  if (!Array.isArray(raw.records)) throw Error('Missing standings');
  return { divisions: raw.records.map(d => ({ id: id(d.division?.id), league: d.league?.id === 103 ? 'AL' : 'NL', name: text(d.teamRecords?.[0]?.team?.division?.name || d.division?.name || 'Division'), entries: list(d.teamRecords).map(r => ({ team: team(r.team), wins: num(r.wins), losses: num(r.losses), pct: text(r.winningPercentage), gb: text(r.divisionGamesBack), wcgb: text(r.wildCardGamesBack), wcRank: num(r.wildCardRank), divisionRank: num(r.divisionRank), leader: Boolean(r.divisionLeader), clinched: Boolean(r.clinched), clinch: text(r.clinchIndicator), eliminated: r.wildCardEliminationNumber === 'E', differential: num(r.runDifferential), streak: text(r.streak?.streakCode), lastTen: (() => { const t = r.records?.splitRecords?.find(s => s.type === 'lastTen'); return t ? `${t.wins}–${t.losses}` : ''; })() })) })) };
}
function normalizeDetail(raw) {
  const data = raw.gameData, live = raw.liveData;
  if (!data?.teams || !live?.linescore) throw Error('Missing game details');
  const normalized = game({ gamePk: raw.gamePk, season: data.game?.season, gameType: data.game?.type, gameDate: data.datetime?.dateTime, status: data.status, teams: { away: { team: data.teams.away }, home: { team: data.teams.home } }, venue: data.venue, linescore: live.linescore });
  const plays = list(live.plays?.allPlays).slice(-80).reverse().map(p => ({ id: num(p.about?.atBatIndex), inning: num(p.about?.inning), half: text(p.about?.halfInning), event: text(p.result?.event), text: text(p.result?.description, 1400), scoring: Boolean(p.about?.isScoringPlay), awayScore: num(p.result?.awayScore), homeScore: num(p.result?.homeScore) }));
  normalized.lastPlay = text(live.plays?.currentPlay?.result?.description, 1400);
  const box = ['away','home'].map(key => { const b = live.boxscore?.teams?.[key] || {}; return { teamId: normalized[key].id, stats: b.teamStats || {}, players: list(b.batters).map(n => b.players?.['ID'+n]).filter(Boolean).map(p => ({ name: text(p.person?.fullName), position: text(p.position?.abbreviation), ...Object.fromEntries(['atBats','runs','hits','rbi','baseOnBalls','strikeOuts'].map(k => [k,num(p.stats?.batting?.[k])])) })) }; });
  return { game: normalized, plays, box, pitchCount: num(live.boxscore?.teams?.[live.linescore?.isTopInning ? 'home' : 'away']?.players?.['ID'+live.linescore.defense?.pitcher?.id]?.stats?.pitching?.numberOfPitches) };
}
function normalizeTeam(raw) {
  if (!Array.isArray(raw.stats)) throw Error('Missing team statistics');
  return { categories: raw.stats.map(s => ({ name: text(s.group?.displayName), stats: Object.fromEntries(Object.entries(s.splits?.[0]?.stat || {}).filter(([,v]) => typeof v === 'string' || typeof v === 'number').map(([k,v]) => [text(k,60),text(v,40)])) })) };
}
function createMLB({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map(), pending = new Set();
  async function load(path, normalize, ttl = 25000) {
    let item = cache.get(path);
    const result = () => ({ ...item.data, meta: { source: 'MLB', updatedAt: item.updatedAt, stale: Boolean(item.error), warning: item.error || '' } });
    if (item?.job) return item.job;
    if (item?.next > now()) { if (item.data) return result(); throw Error(item.error); }
    if (!item) { item = {}; cache.set(path,item); }
    if (cache.size > 100) for (const [key,value] of cache) { if (key !== path && !value.job) { cache.delete(key); break; } }
    item.job = (async () => {
      const controller = new AbortController(); pending.add(controller);
      try {
        const res = await fetcher(BASE + path, { signal: AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]), headers: { Accept:'application/json','User-Agent':'FieldScreenTV/0.1' } });
        if (!res.ok) { await res.body?.cancel(); throw Error('Upstream unavailable'); }
        const reader = res.body.getReader(), chunks = []; let bytes = 0;
        try { for (;;) { const {done,value} = await reader.read(); if (done) break; bytes += value.length; if (bytes > 16 * 1024 * 1024) { await reader.cancel(); throw Error('Oversized response'); } chunks.push(value); } } finally { reader.releaseLock(); }
        item.data = normalize(JSON.parse(Buffer.concat(chunks).toString())); item.updatedAt = now(); item.next = now()+ttl; item.error = ''; return result();
      } catch { item.next = now()+60000; item.error = 'MLB data is temporarily unavailable. Retry shortly.'; if (item.data) return result(); throw Error(item.error); }
      finally { pending.delete(controller); item.job = null; }
    })();
    return item.job;
  }
  const json = (res,status,data) => { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}); res.end(JSON.stringify(data)); };
  async function handle(req,res,next) {
    if (!req.url?.startsWith(PREFIX)) return next();
    try {
      const origin = new URL('http://'+req.headers.host);
      if (!['localhost','127.0.0.1','[::1]'].includes(origin.hostname) || req.headers['x-fieldscreen'] !== '1' || req.headers.origin && req.headers.origin !== origin.origin || req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{error:'Open baseball from FieldScreen TV.'});
      if (req.method !== 'GET') return json(res,405,{error:'Read-only data endpoint.'});
      const url = new URL(req.url,origin), p = url.searchParams, route = url.pathname.slice(PREFIX.length);
      const date = p.get('date'), season = p.get('season') || String(new Date(now()).getFullYear()), key = p.get('id');
      if (!/^\d{4}$/.test(season) || +season < 2000 || +season > new Date(now()).getFullYear()+1 || key && !id(key) || date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) return json(res,400,{error:'Choose a valid baseball date, season, or team.'});
      let data;
      if (route === 'scoreboard' || route === 'postseason' || route === 'favorites') {
        const params = new URLSearchParams({sportId:'1',hydrate:'linescore,team,broadcasts(all),seriesStatus'});
        if (route === 'postseason') { params.set('season',season); params.set('gameTypes','F,D,L,W'); }
        let normalize = normalizeSchedule;
        if (route === 'favorites') {
          const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
          const start = new Date(today+'T12:00:00Z'), end = new Date(start);
          start.setUTCDate(start.getUTCDate()-1); end.setUTCDate(end.getUTCDate()+7);
          params.set('startDate',start.toISOString().slice(0,10)); params.set('endDate',end.toISOString().slice(0,10));
        }
        if (route === 'scoreboard') {
          if (date) params.set('date',date);
          else {
            const current = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
            const previous = new Date(current+'T12:00:00Z'); previous.setUTCDate(previous.getUTCDate()-1);
            params.set('startDate',previous.toISOString().slice(0,10)); params.set('endDate',current);
            normalize = raw => ({games:normalizeSchedule(raw).games.filter(g=>g.officialDate===current || g.live || /delay/i.test(g.status))});
          }
        }
        data = await load('api/v1/schedule?'+params, normalize, route === 'postseason' ? 60000 : 25000);
      } else if (route === 'standings') data = await load(`api/v1/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&hydrate=team`,normalizeStandings,300000);
      else if (route === 'teams') data = await load(`api/v1/teams?sportId=1&season=${season}`,r => { if (!Array.isArray(r.teams)) throw Error('Missing teams'); return { teams:r.teams.map(team) }; },86400000);
      else if (route === 'game' && key) data = await load(`api/v1.1/game/${key}/feed/live`,normalizeDetail);
      else if (route === 'team' && key) data = await load(`api/v1/teams/${key}/stats?stats=season&group=hitting,pitching,fielding&season=${season}`,normalizeTeam,300000);
      else return json(res,404,{error:'Unknown baseball data request.'});
      json(res,200,data);
    } catch { json(res,502,{error:'MLB data is temporarily unavailable. Retry shortly.'}); }
  }
  return { handle, close() { pending.forEach(c=>c.abort()); cache.clear(); } };
}
module.exports = { createMLB, normalizeSchedule, normalizeStandings, normalizeDetail, normalizeTeam };
