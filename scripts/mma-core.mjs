const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const contains = (haystack,name) => name && (' '+normalize(haystack)+' ').includes(' '+normalize(name)+' ');
export function matchMmaBroadcasts(game,channels,now=Date.now()) {
  const start = Date.parse(game.date), promotion = game.promotion || 'ufc';
  const title = game.eventName || game.name || '', number = String(game.eventNumber || title.match(/\bufc\s+(\d{2,4})\b/i)?.[1] || '');
  const wrong = text => /\bnfl\b|\bmlb\b|\bnhl\b|baseball|basketball|\bboxing\b/i.test(text) || (promotion==='ufc' ? /\bpfl\b|\bbellator\b/i : /\bufc\b|contender series/i).test(text);
  function score(value) {
    if (wrong(value) || /\b(replay|classic|highlights|review|encore|weigh.ins|press conference|countdown)\b/i.test(value)) return 0;
    if (game.session==='main' && /\bprelims?\b|preliminary/i.test(value)) return 0;
    const listed = String(value).match(/\bufc\s+(\d{2,4})\b/i)?.[1];
    if (number && listed && number!==listed) return 0;
    if (number && listed===number) return 100;
    // A named event or both headliners identify the card; a generic MMA/UFC
    // channel, one surname, or a shared broadcast network does not.
    if (normalize(title).length>12 && contains(value,title)) return 100;
    const has = fighter => {
      if (!fighter || fighter.placeholder) return false;
      const full = normalize(fighter.fullName || fighter.name), last = full.split(' ').at(-1);
      return full.length>4 && contains(value,full) || last?.length>=4 && contains(value,last);
    };
    return has(game.away) && has(game.home) && normalize(game.away?.name)!==normalize(game.home?.name) ? 100 : 0;
  }
  return channels.map(c=>{
    if(wrong(c.name+' '+c.group))return {...c,matchScore:0};
    const programs = (c.programs || []).filter(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>now&&Number.isFinite(start)&&p.start<=start+6*3600000&&p.end>start&&p.start>=start-6*3600000&&score(p.title+' '+(p.description||''))===100);
    programs.sort((a,b)=>Number(b.start<=now)-Number(a.start<=now)||a.start-b.start);
    const matchedProgram=programs[0];
    return {...c,matchScore:matchedProgram?100:score(c.name)?60:0,matchedProgram,confidence:matchedProgram?'Fight card confirmed in TV guide':'Event in channel name · verify listing'};
  }).filter(c=>c.matchScore>0).sort((a,b)=>b.matchScore-a.matchScore||a.name.localeCompare(b.name));
}
export function mmaCoverage(games,channels,now=Date.now()) {
  return games.filter(g=>!g.complete&&!g.stopped).map(game=>{
    const matches=matchMmaBroadcasts(game,channels,now), ready=game.live&&matches.some(c=>c.matchScore===100&&c.matchedProgram.start<=now&&c.matchedProgram.end>now);
    return {game,matches,ready};
  });
}
