import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import http from 'node:http';
import { channelResults } from '../scripts/iptv-core.mjs';
import { gameCoverage, matchBroadcasts, liveBroadcast } from '../scripts/nfl-core.mjs';
const require = createRequire(import.meta.url);
const { guideResponse } = require('../desktop/guide.cjs');
const { startLocalServer } = require('../desktop/iptv.cjs');
const xmlTime = ms => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0,14) + ' +0000';
const now = Date.now();
const xml = `<tv><programme channel=" NBC.US " start="${xmlTime(now-3600000)}" stop="${xmlTime(now+3600000)}"><title>NFL: Patriots at Seahawks</title></programme></tv>`;

test('XMLTV detects gzip from bytes, accepts mislabeled plain XML, and normalizes guide IDs', async () => {
  for (const [body,url,headers] of [
    [gzipSync(xml),'https://fixture.test/guide',{ 'content-type':'application/octet-stream' }],
    [xml,'https://fixture.test/guide.xml.gz',{ 'content-type':'application/gzip' }],
    [xml,'https://fixture.test/guide',{ 'content-encoding':'gzip' }],
  ]) {
    const guide = await guideResponse(new Response(body,{headers}),url,new Set(['nbc.us']));
    assert.equal(guide.get('nbc.us')[0].title,'NFL: Patriots at Seahawks');
    assert.equal(guide.stats.matchingIds,1);
  }
  await assert.rejects(guideResponse(new Response('<html>Account login</html>'),'https://fixture.test/login',new Set()));
});

test('Search finds late channels and guide text from every page, including a 205-channel lineup', () => {
  const channels = Array.from({length:1205},(_,i)=>({id:String(i),name:'Channel '+i,group:'Sports',programs:[]}));
  channels[204].name='Astros - MLB'; channels[1104].programs=[{title:'Patriots at Seahawks',end:now+3600000}];
  assert.equal(channelResults(channels.slice(0,205)).channels.length,205);
  assert.equal(channelResults(channels.slice(0,205)).pages,1);
  const result=channelResults(channels,{query:'Astros'},2);
  assert.equal(result.channels[0].id,'204'); assert.equal(result.page,0); assert.equal(result.total,1);
  assert.equal(channelResults(channels,{query:'Seahawks'},0).channels[0].id,'1104');
});

test('Games have a watch action only for a current, confirmed guide match; network fallback stays tentative', () => {
  const game={id:'g1',live:true,date:new Date(now-1800000).toISOString(),network:'NBC',away:{name:'Patriots',fullName:'New England Patriots',abbr:'NE'},home:{name:'Seahawks',fullName:'Seattle Seahawks',abbr:'SEA'}};
  const channels=[{id:'nbc',name:'NBC HD',epgId:'NBC.us',programs:[]},{id:'wrong',name:'NBC Sports',epgId:'NBCSports.us',programs:[]}];
  assert.deepEqual(matchBroadcasts(game,channels,now).map(c=>c.id),['nbc']);
  assert.equal(gameCoverage([game],channels,now)[0].ready,undefined);
  assert.equal(liveBroadcast(game,channels,now),null);
  channels[0].programs=[{title:'Patriots at Seahawks',start:now-3600000,end:now+3600000}];
  assert.equal(gameCoverage([game],channels,now)[0].ready.id,'nbc');
  assert.equal(liveBroadcast(game,channels,now).id,'nbc');
  assert.equal(liveBroadcast(game,[{...channels[0],id:'alternate',name:'Alternate Sports',epgId:'other'},...channels],now).id,'nbc','prefer the scheduled network among confirmed game listings');
  assert.equal(liveBroadcast({...game,live:false},channels,now),null);
  assert.equal(liveBroadcast({...game,complete:true},channels,now),null);
  assert.equal(liveBroadcast(game,channels,now+7200000),null);
  channels[0].programs[0].title='Patriots at Seahawks replay';
  assert.equal(gameCoverage([game],channels,now)[0].ready,undefined);
  assert.equal(liveBroadcast(game,channels,now),null);
  assert.equal(gameCoverage([{...game,complete:true}],channels,now).length,0);
});

test('Guide repair preserves channels, diagnoses HTTP/ID/expired errors and never reveals private URLs', async () => {
  let limitedCalls=0;
  const fixture=http.createServer((req,res)=>{
    if(req.url.startsWith('/limited')) {limitedCalls++;res.writeHead(429,{'Retry-After':'120'});return res.end();}
    if(req.url.startsWith('/bad')) {res.writeHead(403);return res.end('private-secret');}
    if(req.url.startsWith('/wrong')) return res.end(xml.replace(' NBC.US ','other'));
    if(req.url.startsWith('/old')) return res.end(xml.replace(xmlTime(now+3600000),xmlTime(now-1)));
    res.setHeader('Content-Type','application/octet-stream');res.end(gzipSync(xml));
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+fixture.address().port;
  const service=await startLocalServer();
  const call=async(route,data)=>{const response=await fetch(new URL('./iptv/'+route,service.url),{method:'POST',headers:{'X-FieldScreen':'1','Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal(response.status,200);return response.json();};
  try {
    const connected=await call('connect',{type:'m3u',playlist:`#EXTM3U\n#EXTINF:-1 tvg-id="nbc.us",NBC\n${base}/live.m3u8`});
    const good=await call('update-guide',{guideUrl:base+'/guide?token=private-secret'});
    assert.equal(good.guideStatus,'ready');assert.equal(good.channels[0].id,connected.channels[0].id);assert.equal(good.channels[0].stream,connected.channels[0].stream);
    const bad=await call('update-guide',{guideUrl:base+'/bad?token=private-secret'});
    assert.equal(bad.guideStatus,'error');assert.match(bad.guideNote,/refused access/);assert.equal(bad.channels[0].programs.length,1);assert.doesNotMatch(JSON.stringify(bad),/private-secret/);
    const wrong=await call('update-guide',{guideUrl:base+'/wrong'});assert.match(wrong.guideNote,/IDs do not match/);
    const old=await call('update-guide',{guideUrl:base+'/old'});assert.match(old.guideNote,/out of date/);
    const limited=await call('update-guide',{guideUrl:base+'/limited'});assert.match(limited.guideNote,/limiting guide requests/);
    await call('guide',{force:true});await call('guide',{force:true});
    assert.equal(limitedCalls,1,'manual refresh must respect provider backoff');
  } finally {service.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
});
