import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mlb from '../desktop/mlb.cjs';
import { matchBroadcasts, gamePriority, resolveSelectedGame } from '../scripts/mlb-core.mjs';

const rawGame = () => ({ gamePk:123,gameDate:'2026-09-10T00:00:00Z',officialDate:'2026-09-09',season:'2026',gameType:'R',status:{abstractGameState:'Live',detailedState:'In Progress'},teams:{away:{team:{id:137,name:'San Francisco Giants',teamName:'Giants',abbreviation:'SF'},score:0},home:{team:{id:119,name:'Los Angeles Dodgers',teamName:'Dodgers',abbreviation:'LAD'},score:1}},linescore:{currentInning:10,inningState:'Top',isTopInning:true,balls:0,strikes:2,outs:1,offense:{second:{id:77,fullName:'Runner Two'},batter:{id:7,fullName:'A Batter'}},defense:{pitcher:{id:8,fullName:'A Pitcher'}},innings:[{num:1,away:{runs:0},home:{runs:1}}],teams:{away:{runs:0,hits:2,errors:0},home:{runs:1,hits:3,errors:0}}},doubleHeader:'N' });
const normalize = raw => mlb.normalizeSchedule({dates:[{games:[raw]}]}).games[0];

test('MLB preserves zero counts, extra innings and occupied bases without inventing scheduled scores',()=>{
  const raw=rawGame(), g=normalize(raw);
  assert.equal(g.league,'mlb');assert.equal(g.live,true);assert.equal(g.inning,10);assert.equal(g.balls,0);assert.equal(g.away.score,0);assert.deepEqual(g.bases,[false,true,false]);assert.equal(g.runners[1],'Runner Two');assert.equal(g.home.errors,0);
  raw.status={abstractGameState:'Preview',detailedState:'Scheduled',startTimeTBD:true};const pre=normalize(raw);assert.equal(pre.away.score,null);assert.equal(pre.timeTBD,true);assert.deepEqual(pre.bases,[null,null,null]);assert.equal(pre.batter,'');
  for(const status of ['Delayed','Suspended','Postponed','Cancelled']){raw.status={abstractGameState:'Live',detailedState:status};assert.equal(normalize(raw).live,false);assert.equal(normalize(raw).complete,false);}
  assert.throws(()=>mlb.normalizeSchedule({}));assert.deepEqual(mlb.normalizeSchedule({dates:[]}).games,[]);
});

test('Baseball hides stale runners between innings and after final; live late close games lead',()=>{
  const raw=rawGame(), live=normalize(raw);raw.linescore.inningState='Middle';raw.linescore.outs=3;
  assert.deepEqual(normalize(raw).bases,[null,null,null]);assert.equal(normalize(raw).batter,'');
  raw.status={abstractGameState:'Final',detailedState:'Final'};const final=normalize(raw);assert.equal(final.complete,true);assert.equal(final.live,false);assert.deepEqual(final.bases,[null,null,null]);
  assert(gamePriority(live)>gamePriority({...live,inning:2}));assert(gamePriority(live)>gamePriority(final));
});

test('MLB channel matching rejects football, replay, wrong-time and explicitly wrong doubleheader games',()=>{
  const g={...normalize(rawGame()),doubleHeader:true,gameNumber:2},now=Date.parse(g.date)+60000;
  const p={title:'MLB: Giants vs Dodgers Game 2',description:'Live baseball',start:Date.parse(g.date),end:now+10800000};
  const channels=[{id:'good',name:'Sports 1',group:'MLB',programs:[p]},{id:'football',name:'NFL Giants',group:'NFL',programs:[p]},{id:'replay',name:'Sports 2',group:'MLB',programs:[{...p,title:'Replay Giants vs Dodgers'}]},{id:'earlier',name:'Sports 3',group:'MLB',programs:[{...p,title:'Giants vs Dodgers Game 1'}]},{id:'expired',name:'Sports 4',group:'MLB',programs:[{...p,end:now-1}]}];
  assert.deepEqual(matchBroadcasts(g,channels,now).map(c=>c.id),['good']);
});

test('Postseason placeholder teams and uncertain start times remain explicit',()=>{
  const raw=rawGame();raw.status={abstractGameState:'Preview',detailedState:'Scheduled',startTimeTBD:true};raw.teams.away.team={id:4944,name:'AL Wild Card #2',teamName:'AL Wild Card #2',abbreviation:'ALWC2',placeholder:true};raw.gameType='F';raw.ifNecessary='Y';raw.seriesGameNumber=3;raw.seriesDescription='AL Wild Card Series';
  const g=normalize(raw);assert.equal(g.away.placeholder,true);assert.equal(g.timeTBD,true);assert.equal(g.ifNecessary,true);assert.equal(g.seriesGame,3);assert.equal(g.away.score,null);
});

test('MLB cache deduplicates, keeps last successful data on outages, rejects bad dates and cross-site access',async()=>{
  let clock=Date.UTC(2026,8,10),calls=0,fail=false;
  const service=mlb.createMLB({now:()=>clock,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return new Response(JSON.stringify({dates:[{games:[rawGame()]}]}),{status:fail?503:200});}});
  const server=http.createServer((req,res)=>service.handle(req,res,()=>res.end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/preview/mlb/`;
  const get=(path='scoreboard',headers={})=>fetch(base+path,{headers:{'X-FieldScreen':'1',...headers}});
  try{
    assert.equal((await fetch(base+'scoreboard')).status,403);assert.equal((await get('scoreboard',{Origin:'https://example.com'})).status,403);
    for(const path of ['scoreboard?date=2026-02-30','game?id=../../secret','standings?season=2099'])assert.equal((await get(path)).status,400);
    const responses=await Promise.all([get(),get(),get()]);assert.equal(calls,1);assert.equal((await responses[0].json()).meta.stale,false);
    fail=true;clock+=30000;const cached=await(await get()).json();assert.equal(cached.meta.stale,true);assert.equal(cached.games.length,1);assert.equal(calls,2);await get();assert.equal(calls,2);
    assert.equal((await fetch(base+'scoreboard',{method:'POST',headers:{'X-FieldScreen':'1'}})).status,405);
  }finally{service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('Today keeps last night’s live game after midnight and excludes yesterday’s finals',async()=>{
  const live=rawGame(),final=rawGame();final.gamePk=124;final.status={abstractGameState:'Final',detailedState:'Final'};
  const next=rawGame();next.gamePk=125;next.officialDate='2026-09-10';next.status={abstractGameState:'Preview',detailedState:'Scheduled'};
  let upstream='';const service=mlb.createMLB({now:()=>Date.parse('2026-09-10T04:15:00Z'),fetcher:async url=>{upstream=url;return new Response(JSON.stringify({dates:[{games:[live,final,next]}]}));}});
  const server=http.createServer((req,res)=>service.handle(req,res,()=>res.end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const r=await fetch(`http://127.0.0.1:${server.address().port}/preview/mlb/scoreboard`,{headers:{'X-FieldScreen':'1'}});const data=await r.json();assert.deepEqual(data.games.map(g=>g.id),['123','125']);assert.match(upstream,/startDate=2026-09-09/);assert.match(upstream,/endDate=2026-09-10/);}
  finally{service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('MLB remembered view tolerates an unloaded board and ignores detail from another game', () => {
  assert.equal(resolveSelectedGame([], null, null), undefined);
  const base = {id:'123', network:'Home broadcast', score:1};
  assert.equal(resolveSelectedGame([base], '123', null), base);
  assert.equal(resolveSelectedGame([base], '123', {game:{id:'999',score:8}}), base);
  const current = resolveSelectedGame([base], '123', {game:{id:'123',score:2,network:''}});
  assert.equal(current.score, 2);
  assert.equal(current.network, 'Home broadcast');
});
