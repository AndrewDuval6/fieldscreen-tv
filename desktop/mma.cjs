const BASE = 'https://site.api.espn.com/apis/site/v2/sports/mma/';
const PREFIX = '/preview/mma/';
const list = v => Array.isArray(v) ? v : [];
const text = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);
const id = v => /^\d{1,16}$/.test(String(v)) ? String(v) : '';
const date = v => Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : '';
const norm = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function fighter(raw = {}) {
  const a = raw.athlete || {};
  return { id: id(raw.id), name: text(a.fullName || a.displayName || 'To be announced'), fullName: text(a.fullName || a.displayName || 'To be announced'), abbr: text(a.shortName || a.fullName, 80), country: text(a.flag?.alt, 80), record: text(list(raw.records).find(r => r.type === 'total' || r.name === 'overall')?.summary, 40), winner: raw.winner === true, placeholder: !a.fullName && !a.displayName };
}
function bout(raw) {
  const competitors = list(raw.competitors).slice().sort((a,b) => (a.order || 0) - (b.order || 0));
  if (!id(raw.id) || competitors.length !== 2) return null;
  const s = raw.status || {}, type = s.type || {}, stopped = /cancel|postpon|suspend|delay/i.test(type.name + ' ' + type.description);
  const live = type.state === 'in' && !stopped, complete = type.completed === true && !stopped;
  return { id: id(raw.id), date: date(raw.date), timeTBD: raw.timeValid === false, away: fighter(competitors[0]), home: fighter(competitors[1]), weight: text(raw.type?.abbreviation, 60), rounds: Number(raw.format?.regulation?.periods) || null, live, complete, status: text(type.description || 'Scheduled'), round: live || complete ? Number(s.period) || null : null, clock: live || complete ? text(s.displayClock, 20) : '', network: [...new Set(list(raw.broadcasts).flatMap(b => list(b.names)).concat(raw.broadcast || []).filter(Boolean))].map(n => text(n,80)).join(' / ') };
}
function normalizeScoreboard(raw, promotion) {
  if (!Array.isArray(raw.events)) throw Error('Missing MMA events');
  return { games: raw.events.map(e => {
    const fights = list(e.competitions).map(bout).filter(Boolean).reverse();
    if (!id(e.id)) return null;
    const type = e.status?.type || {}, stopped = /cancel|postpon|suspend|delay/i.test(type.name + ' ' + type.description);
    const complete = type.completed === true && !stopped;
    const live = !complete && !stopped && (type.state === 'in' || fights.some(f => f.live));
    const name = text(e.name || e.shortName || promotion.toUpperCase());
    const dates = [...new Set(fights.map(f => f.date).filter(Boolean))].sort();
    const first = fights[0], venue = list(e.venues)[0] || e.competitions?.[0]?.venue || {};
    const network = [...new Set(fights.map(f => f.network).filter(Boolean))].join(' / ');
    const numbered = name.match(/\bUFC\s+(\d{2,4})\b/i)?.[1] || '';
    const headlinerConfirmed = first && [first.away, first.home].every(f => !f.placeholder && norm(name).includes(norm(f.name).split(' ').at(-1)));
    return { league: 'mma', promotion, id: id(e.id), name, eventName: name, shortName: text(e.shortName), eventNumber: numbered, numbered: Boolean(numbered), ppv: /\bppv\b|pay.per.view/i.test(name + ' ' + network), date: date(e.date), mainCardDate: dates.at(-1) || date(e.date), sessionCount: dates.length,
      timeTBD: !date(e.date) || !fights.length || fights.every(f => f.timeTBD), stopped, state: complete ? 'post' : live ? 'in' : 'pre', live, complete, status: stopped ? text(type.description || 'Schedule changed') : live ? 'Live card' : complete ? 'Final' : text(type.description || 'Scheduled'),
      away: first?.away || fighter(), home: first?.home || fighter(), headlinerConfirmed: Boolean(headlinerConfirmed), fights, network, venue: text(venue.fullName), location: [venue.address?.city, venue.address?.country].filter(Boolean).map(v=>text(v,80)).join(', ') };
  }).filter(Boolean) };
}
function createMMA({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map(), pending = new Set();
  async function load(promotion, range) {
    const path = promotion + '/scoreboard?dates=' + range + '&limit=1000';
    let item = cache.get(path);
    const result = () => ({ ...item.data, meta: { source: 'ESPN · ' + promotion.toUpperCase(), updatedAt: item.updatedAt, stale: Boolean(item.error), warning: item.error || '' } });
    if (item?.job) return item.job;
    if (item?.next > now()) { if (item.data) return result(); throw Error(item.error); }
    if (!item) { item = {}; cache.set(path,item); }
    if (cache.size > 16) for (const [key,value] of cache) if (key !== path && !value.job) { cache.delete(key); break; }
    item.job = (async () => {
      const controller = new AbortController(); pending.add(controller);
      try {
        const res = await fetcher(BASE + path, { signal: AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]), headers: {Accept:'application/json','User-Agent':'FieldScreenTV/0.1'} });
        if (!res.ok) { await res.body?.cancel(); throw Error('Upstream unavailable'); }
        const reader = res.body.getReader(), chunks = []; let bytes = 0;
        try { for (;;) { const {done,value} = await reader.read(); if (done) break; bytes += value.length; if (bytes > 16*1024*1024) { await reader.cancel(); throw Error('Oversized response'); } chunks.push(value); } } finally { reader.releaseLock(); }
        item.data = normalizeScoreboard(JSON.parse(Buffer.concat(chunks).toString()),promotion); item.updatedAt = now(); item.next = now()+25000; item.error = ''; return result();
      } catch { item.next = now()+60000; item.error = promotion.toUpperCase()+' data is temporarily unavailable. Retry shortly.'; if (item.data) return result(); throw Error(item.error); }
      finally { pending.delete(controller); item.job = null; }
    })(); return item.job;
  }
  const json = (res,status,data) => { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}); res.end(JSON.stringify(data)); };
  async function handle(req,res,next) {
    if (!req.url?.startsWith(PREFIX)) return next();
    try {
      const origin = new URL('http://'+req.headers.host);
      if (!['localhost','127.0.0.1','[::1]'].includes(origin.hostname) || req.headers['x-fieldscreen'] !== '1' || req.headers.origin && req.headers.origin !== origin.origin || req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{error:'Open MMA from FieldScreen TV.'});
      if (req.method !== 'GET') return json(res,405,{error:'Read-only data endpoint.'});
      const url = new URL(req.url,origin);
      if (url.pathname !== PREFIX+'scoreboard') return json(res,404,{error:'Unknown MMA data request.'});
      const day = offset => new Date(now()+offset*86400000).toISOString().slice(0,10).replaceAll('-','');
      const range = day(-7)+'-'+day(120), promotions = ['ufc','pfl'];
      const results = await Promise.allSettled(promotions.map(p=>load(p,range)));
      const data = results.filter(r=>r.status==='fulfilled').map(r=>r.value);
      if (!data.length) throw Error('Unavailable');
      const warning = results.map((r,i)=>r.status==='rejected'?promotions[i].toUpperCase()+' schedule unavailable.':r.value.meta.warning).filter(Boolean).join(' ');
      json(res,200,{ games:data.flatMap(d=>d.games).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)), meta:{source:'ESPN · UFC + PFL',updatedAt:Math.min(...data.map(d=>d.meta.updatedAt)),stale:Boolean(warning),warning}, range:{from:day(-7),to:day(120)} });
    } catch { json(res,502,{error:'MMA schedules are temporarily unavailable. Retry shortly.'}); }
  }
  return { handle, close() { pending.forEach(c=>c.abort()); cache.clear(); } };
}
module.exports = { createMMA, normalizeScoreboard };
