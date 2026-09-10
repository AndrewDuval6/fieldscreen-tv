import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chooseBroadcast } = require('../desktop/broadcast.cjs');
const { startLocalServer } = require('../desktop/iptv.cjs');

test('Stream selection checks media bytes, skips bad feeds, picks a responsive feed and reuses recent results', async () => {
  let calls = 0;
  const server = http.createServer((req,res) => {
    calls++;
    if (req.url === '/html') { res.setHeader('content-type','text/html'); return res.end('<html>Sign in</html>'); }
    if (req.url === '/master') { res.setHeader('content-type','application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\n/variant'); }
    if (req.url === '/variant') { res.setHeader('content-type','application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXTINF:6,\n/media'); }
    const send = () => { res.setHeader('content-type','video/mp2t'); res.end(Buffer.from([0x47,1,2,3])); };
    if (req.url === '/slow') return setTimeout(send, 200);
    send();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const upstream=async(url,{signal})=>({url,response:await fetch(url,{signal})});
  const cache=new Map(), candidates=['html','slow','master'].map(id=>({id,url:origin+'/'+id}));
  let service;
  try {
    const chosen=await chooseBroadcast(candidates,{upstream,cache});
    assert.equal(chosen.channelId,'master'); assert.equal(chosen.verified,true); assert.equal(chosen.checked,3);
    const previous=calls; await chooseBroadcast(candidates,{upstream,cache}); assert.equal(calls,previous);
    const noRoom=await chooseBroadcast(candidates,{upstream,cache:new Map(),canProbe:false}); assert.equal(noRoom.checked,0); assert.equal(calls,previous);
    service=await startLocalServer();
    const call=async(route,data)=>fetch(new URL('iptv/'+route,service.url),{method:'POST',headers:{'X-FieldScreen':'1','Content-Type':'application/json'},body:JSON.stringify(data)});
    const connected=await (await call('connect',{type:'m3u',playlist:`#EXTM3U\n#EXTINF:-1,Broken\n${origin}/html\n#EXTINF:-1,Working\n${origin}/media`})).json();
    const result=await (await call('choose-broadcast',{channelIds:connected.channels.map(c=>c.id),url:origin+'/must-not-fetch'})).json();
    assert.equal(result.channelId,connected.channels[1].id); assert.equal(result.verified,true);
    assert.doesNotMatch(JSON.stringify(result),/http|127\.0\.0\.1|media/);
    assert.equal((await call('choose-broadcast',{channelIds:['unknown']})).status,400);
  } finally { service?.close(); server.closeAllConnections(); await new Promise(r=>server.close(r)); }
});

test('Stream checks have one total deadline even when a feed hangs', async () => {
  const started=performance.now();
  const upstream=(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true}));
  // A referenced timer keeps the test alive while the abort deadline is pending.
  const keeper=setTimeout(()=>{},1000);
  try {
    const result=await chooseBroadcast([{id:'a',url:'https://test/a'},{id:'b',url:'https://test/b'}],{upstream,budget:100});
    assert(performance.now()-started<500); assert.equal(result.channelId,'b'); assert.equal(result.verified,false);
  } finally { clearTimeout(keeper); }
});
