import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mma from '../desktop/mma.cjs';
import { createRecorder } from '../desktop/recorder.cjs';
import { createIPTV } from '../desktop/iptv.cjs';
import { matchBroadcasts, liveBroadcast } from '../scripts/broadcast-core.mjs';
import { mmaCoverage } from '../scripts/mma-core.mjs';
const kickoff=Date.parse('2026-09-12T18:00:00Z');
const participant=(id,name,order)=>({id,order,athlete:{fullName:name,shortName:name,flag:{alt:'USA'}},records:[{type:'total',summary:'12-2-0'}]});
const bout=(id,date,names,status={state:'pre',description:'Scheduled'})=>({id,date,timeValid:true,type:{abbreviation:'Lightweight'},competitors:names.map((n,i)=>participant(String(i+1),n,i+1)),status:{type:status,displayClock:'0:00',period:1},format:{regulation:{periods:3}},broadcasts:[{names:['Sports Network']}]});
const raw=()=>({events:[{id:'12345',name:'UFC 999: García vs. Jones',date:new Date(kickoff).toISOString(),status:{type:{state:'pre',description:'Scheduled'}},venues:[{fullName:'Test Arena',address:{city:'Test City',country:'USA'}}],competitions:[bout('11',new Date(kickoff).toISOString(),['Prelim One','Prelim Two']),bout('12',new Date(kickoff+3*3600000).toISOString(),['José García','Alex Jones'])]}]});
const normalized=()=>mma.normalizeScoreboard(raw(),'ufc').games[0];
const channel=(id,title,extras={})=>({id,name:'Sports '+id,group:'MMA',programs:[{title,description:'Live MMA',start:kickoff,end:kickoff+7*3600000,...extras}]});

test('MMA normalizes full cards, main-card time, records and accents without claiming numbered cards are PPV',()=>{
  const g=normalized();assert.equal(g.league,'mma');assert.equal(g.promotion,'ufc');assert.equal(g.fights.length,2);assert.equal(g.fights[0].away.name,'José García');assert.equal(g.away.record,'12-2-0');assert.equal(g.eventNumber,'999');assert.equal(g.ppv,false);assert.equal(g.mainCardDate,new Date(kickoff+3*3600000).toISOString());assert.equal(g.sessionCount,2);assert.equal(g.fights[0].round,null);assert.equal(g.headlinerConfirmed,true);
  const r=raw();r.events[0].competitions[1].broadcasts=[{names:['PPV']}];assert.equal(mma.normalizeScoreboard(r,'ufc').games[0].ppv,true);
  r.events[0].name='UFC 999';assert.equal(mma.normalizeScoreboard(r,'ufc').games[0].headlinerConfirmed,false);
  assert.throws(()=>mma.normalizeScoreboard({},'ufc'));assert.deepEqual(mma.normalizeScoreboard({events:[]},'pfl').games,[]);
});
test('A live preliminary bout makes the event live before the main event; canceled and final cards do not stay live',()=>{
  const r=raw();r.events[0].competitions[0].status.type={state:'in',description:'In Progress'};
  let g=mma.normalizeScoreboard(r,'ufc').games[0];assert.equal(g.live,true);assert.equal(g.fights[0].live,false);assert.equal(g.fights[1].round,1);
  r.events[0].status.type={state:'post',completed:true,description:'Final'};assert.equal(mma.normalizeScoreboard(r,'ufc').games[0].live,false);
  for(const description of ['Canceled','Postponed','Delayed','Suspended']){r.events[0].status.type={state:'in',description};g=mma.normalizeScoreboard(r,'ufc').games[0];assert.equal(g.live,false);assert.equal(g.stopped,true);assert.equal(g.complete,false);}
  r.events[0].status.type={state:'pre'};r.events[0].competitions=[];assert.equal(mma.normalizeScoreboard(r,'ufc').games[0].timeTBD,true);
});
test('Guide matching confirms event numbers or both fighters, rejecting wrong events, sports, replay and expired listings',()=>{
  const g={...normalized(),live:true},now=kickoff+3600000;
  const channels=[channel('number','UFC 999 Live'),channel('fighters','Garcia vs Jones'),channel('wrong','UFC 998: Garcia vs Jones'),channel('replay','UFC 999 Replay'),channel('expired','UFC 999',{end:now-1}),channel('future','UFC 999',{start:kickoff+86400000,end:kickoff+90000000}),channel('other','PFL 999 Garcia vs Jones'),channel('one','Garcia and friends'),channel('generic','UFC Live'),{...channel('baseball','UFC 999'),group:'MLB'},channel('press','UFC 999 Press Conference')];
  assert.deepEqual(matchBroadcasts(g,channels,now).map(c=>c.id).sort(),['fighters','number']);assert.equal(liveBroadcast(g,[channels[0]],now).id,'number');assert.equal(liveBroadcast({...g,live:false},channels,now),null);
  assert.equal(mmaCoverage([g],channels,now)[0].ready,true);
  assert.deepEqual(mmaCoverage([{...g,stopped:true}],channels,now),[]);
});
test('Main-card recording excludes prelims and retains the upcoming main-card program',()=>{
  const g={...normalized(),session:'main',date:new Date(kickoff+3*3600000).toISOString()};
  const c={id:'same',name:'UFC 999',group:'MMA',programs:[{title:'UFC 999 Prelims',start:kickoff,end:kickoff+3*3600000},{title:'UFC 999 Main Card',start:kickoff+3*3600000,end:kickoff+7*3600000}]};
  const result=matchBroadcasts(g,[c],kickoff+3*3600000-120000);assert.equal(result[0].matchedProgram.title,'UFC 999 Main Card');
  const onlyPrelims=channel('pre','UFC 999 Prelims');assert.equal(matchBroadcasts(g,[onlyPrelims],kickoff+3*3600000).length,0);
});
test('PFL named events match without treating a generic promotion channel as confirmed',()=>{
  const g={...normalized(),promotion:'pfl',eventNumber:'',eventName:'PFL Chicago: García vs. Jones'};
  assert.equal(matchBroadcasts(g,[channel('good','PFL Chicago: Garcia vs Jones'),channel('wrong','UFC 999 Garcia vs Jones'),channel('generic','PFL Live')],kickoff+1000).length,1);
});
test('MMA service caches both promotions, serves partial failures, and restricts access',async()=>{
  let clock=kickoff,calls=0,fail=false;const urls=[];
  const service=mma.createMMA({now:()=>clock,fetcher:async url=>{calls++;urls.push(url);await new Promise(r=>setTimeout(r,5));return new Response(JSON.stringify(raw()),{status:fail?503:200});}});
  const server=http.createServer((req,res)=>service.handle(req,res,()=>res.end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/preview/mma/scoreboard';
  const get=(headers={})=>fetch(base,{headers:{'X-FieldScreen':'1',...headers}});
  try{
    assert.equal((await fetch(base)).status,403);assert.equal((await get({Origin:'https://evil.test'})).status,403);assert.equal((await fetch(base,{method:'POST',headers:{'X-FieldScreen':'1'}})).status,405);
    const responses=await Promise.all([get(),get(),get()]);assert.equal(calls,2);const data=await responses[0].json();assert.deepEqual(data.games.map(g=>g.promotion).sort(),['pfl','ufc']);assert.equal(data.meta.stale,false);
    assert(urls.every(u=>u.startsWith('https://site.api.espn.com/apis/site/v2/sports/mma/')));assert(urls.some(u=>u.includes('dates=20260905-20270110')));
    fail=true;clock+=30000;const stale=await(await get()).json();assert.equal(stale.meta.stale,true);assert.equal(stale.games.length,2);await get();assert.equal(calls,4);
  }finally{service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
  const partial=mma.createMMA({now:()=>clock,fetcher:async url=>new Response(JSON.stringify(raw()),{status:url.includes('/pfl/')?503:200})});
  const s=http.createServer((req,res)=>partial.handle(req,res,()=>res.end()));await new Promise(r=>s.listen(0,'127.0.0.1',r));
  try{const r=await fetch('http://127.0.0.1:'+s.address().port+'/preview/mma/scoreboard',{headers:{'X-FieldScreen':'1'}});const d=await r.json();assert.equal(r.status,200);assert.equal(d.games.length,1);assert.match(d.meta.warning,/PFL/);}finally{partial.close();s.closeAllConnections();await new Promise(r=>s.close(r));}
});
test('MMA scheduled recordings preserve event matching metadata across restart and omit private inputs',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fieldscreen-mma-'));let recorder;
  const options={stateFile:path.join(dir,'state.json'),ffmpeg:'/bin/true',origin:()=> 'http://127.0.0.1:8765',now:()=>kickoff-3600000,interval:0,provider:{snapshot:async()=>({connected:true,saved:true,channels:[]}),resolve:async()=>null}};
  try{
    recorder=await createRecorder(options);await recorder.setFolder(dir);
    const g={...normalized(),date:new Date(kickoff+3*3600000).toISOString(),session:'main',privateUrl:'https://secret.test/password'};
    await recorder.create({game:g,hours:6});await recorder.shutdown();recorder=await createRecorder(options);
    const job=(await recorder.status()).jobs[0];assert.equal(job.title,'UFC 999: García vs. Jones');assert.equal(job.hours,6);assert.equal(job.game.session,'main');assert.equal(job.game.eventNumber,'999');assert.equal(job.startAt,Date.parse(g.date)-120000);
    assert.equal(matchBroadcasts(job.game,[channel('match','UFC 999 Main Card',{start:Date.parse(g.date),end:Date.parse(g.date)+3600000})],Date.parse(g.date))[0].matchScore,100);
    assert.doesNotMatch(await fs.readFile(options.stateFile,'utf8'),/secret|password|privateUrl/);
    await assert.rejects(()=>recorder.create({game:{...g,id:'999',stopped:true},hours:6}),/confirmed start/);
  }finally{await recorder?.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});
test('MMA recorder resolves a numbered card through the same private IPTV guide pipeline',async()=>{
  const clock=Date.now(),xmltime=t=>new Date(t).toISOString().replace(/[-:T]/g,'').slice(0,14)+' +0000';let origin;
  const server=http.createServer((req,res)=>{
    if(req.url==='/playlist'){res.setHeader('Content-Type','text/plain');return res.end(`#EXTM3U\n#EXTINF:-1 tvg-id="mma" group-title="MMA",Fight event\n${origin}/mma.m3u8\n#EXTINF:-1 tvg-id="wrong" group-title="MMA",Other event\n${origin}/wrong.m3u8`);}
    res.setHeader('Content-Type','application/xml');res.end(`<tv><programme channel="mma" start="${xmltime(clock-300000)}" stop="${xmltime(clock+3600000)}"><title>UFC 999 Main Card</title></programme><programme channel="wrong" start="${xmltime(clock-300000)}" stop="${xmltime(clock+3600000)}"><title>UFC 998 Main Card</title></programme></tv>`);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  const service=createIPTV({vault:{load:async()=>({type:'m3u',url:origin+'/playlist',guideUrl:origin+'/guide'}),available:()=>false}});
  try{const selected=await service.resolve({game:{...normalized(),session:'main',date:new Date(clock).toISOString()}},0);assert.equal(selected.name,'Fight event');assert.match(selected.stream,/^\/preview\/iptv\/stream\//);assert.equal(selected.url,undefined);}finally{service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
