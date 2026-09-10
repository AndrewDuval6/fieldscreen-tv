import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRecorder, byteRange } = require('../desktop/recorder.cjs');
const { startLocalServer, createIPTV } = require('../desktop/iptv.cjs');
const engine = path.resolve('desktop/recorder/ffmpeg');
const team = name => ({name,fullName:name,abbr:name.slice(0,3).toUpperCase()});
const game = time => ({id:'1234',league:'mlb',date:new Date(time).toISOString(),home:team('Dodgers'),away:team('Reds')});
const until = async predicate => { for(let n=0;n<100;n++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('Recorder timed out'); };
test('Recording playback validates single, open-ended and suffix ranges',()=>{
  assert.deepEqual(byteRange(undefined,100),{start:0,end:99});assert.deepEqual(byteRange('bytes=20-40',100),{start:20,end:40});
  assert.deepEqual(byteRange('bytes=-10',100),{start:90,end:99});assert.deepEqual(byteRange('bytes=90-',100),{start:90,end:99});
  for(const value of ['bytes=500-','bytes=40-20','bytes=-','bytes=0-2,4-6','bytes=9007199254740999-','bytes=-0'])assert.equal(byteRange(value,100),null);
});
test('Schedules survive restart, omit input URLs, reject duplicates, and mark missed starts',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fieldscreen-rec-'));let clock=Date.now(),rec;
  const options={stateFile:path.join(dir,'state.json'),ffmpeg:'/bin/true',origin:()=> 'http://127.0.0.1:8765',now:()=>clock,interval:0,provider:{snapshot:async()=>({connected:true,saved:true,channels:[]}),resolve:async()=>null}};
  try{
    rec=await createRecorder(options);await assert.rejects(()=>rec.create({game:game(clock+3600000),hours:4}),/Choose where/);
    const chosen=await rec.setFolder(dir);assert.equal(chosen.storage.ready,true);
    const g=game(clock+3600000);g.privateUrl='https://secret.test/password';
    const added=await rec.create({game:g,hours:4,url:'https://secret.test/login'});
    await assert.rejects(()=>rec.create({game:g,hours:4}),/already scheduled/);
    await assert.rejects(()=>rec.create({game:{...g,id:'999',timeTBD:true},hours:4}),/confirmed start/);
    assert.doesNotMatch(await fs.readFile(options.stateFile,'utf8'),/secret|password|privateUrl/);
    await rec.shutdown();rec=await createRecorder(options);assert.equal((await rec.status()).jobs[0].id,added.id);
    clock+=4*3600000;await rec.tick();assert.equal((await rec.status()).jobs[0].state,'missed');
    await rec.remove(added.id);assert.equal((await rec.status()).jobs.length,0);
  }finally{await rec?.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});
test('Disk reserve, overlapping schedules and unavailable guides have visible outcomes',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fieldscreen-rec-'));let rec,clock=Date.now();
  const opts={stateFile:path.join(dir,'state.json'),ffmpeg:'/bin/true',origin:()=> 'http://127.0.0.1:8765',now:()=>clock,interval:0,provider:{snapshot:async()=>({connected:true,saved:false,maxConnections:1,channels:[]}),resolve:async()=>null}};
  try{
    rec=await createRecorder({...opts,reserveBytes:Number.MAX_SAFE_INTEGER});await assert.rejects(()=>rec.setFolder(dir),/available/);await rec.shutdown();
    rec=await createRecorder(opts);await rec.setFolder(dir);const job=await rec.create({game:game(clock+3600000),hours:4});
    await assert.rejects(()=>rec.create({game:{...game(clock+5400000),id:'999'},hours:4}),/overlap/);
    clock+=3600000;await rec.tick();assert.equal((await rec.status()).jobs[0].state,'waiting');assert.match((await rec.status()).jobs[0].note,/guide has not confirmed/);
    await rec.stop(job.id);assert.equal(rec.hasWork(),false);
  }finally{await rec?.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});
test('Interrupted recordings retain partial files; a bad catalog is never overwritten',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fieldscreen-rec-'));let rec;
  const stateFile=path.join(dir,'state.json');
  try{
    await fs.writeFile(path.join(dir,'game.mp4'),Buffer.alloc(5000));
    await fs.writeFile(stateFile,JSON.stringify({version:1,folder:dir,jobs:[{id:'interrupted',folder:dir,file:'game.mp4',state:'recording'}]}));
    rec=await createRecorder({stateFile,ffmpeg:'/bin/true',origin:()=> 'http://127.0.0.1:1',provider:{},interval:0});
    const entry=(await rec.status()).jobs[0];assert.equal(entry.state,'partial');assert.equal(entry.bytes,5000);assert.match(entry.note,/interrupted/);await rec.shutdown();
    await fs.writeFile(stateFile,'bad catalog');await assert.rejects(()=>createRecorder({stateFile}),/catalog could not be read/);assert.equal(await fs.readFile(stateFile,'utf8'),'bad catalog');
  }finally{await rec?.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});
test('Scheduled game resolution uses both teams in XMLTV and excludes the wrong sport',async()=>{
  const clock=Date.now(),xmltime=t=>new Date(t).toISOString().replace(/[-:T]/g,'').slice(0,14)+' +0000';let origin;
  const server=http.createServer((req,res)=>{
    if(req.url==='/playlist'){res.setHeader('Content-Type','text/plain');return res.end(`#EXTM3U\n#EXTINF:-1 tvg-id="baseball" group-title="MLB",Baseball\n${origin}/baseball.m3u8\n#EXTINF:-1 tvg-id="football" group-title="NFL",Football\n${origin}/football.m3u8`);}
    res.setHeader('Content-Type','application/xml');res.end(`<tv><programme channel="baseball" start="${xmltime(clock-300000)}" stop="${xmltime(clock+3600000)}"><title>Reds at Dodgers</title></programme><programme channel="football" start="${xmltime(clock-300000)}" stop="${xmltime(clock+3600000)}"><title>Reds at Dodgers</title></programme></tv>`);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  const service=createIPTV({vault:{load:async()=>({type:'m3u',url:origin+'/playlist',guideUrl:origin+'/guide'}),available:()=>false}});
  try{const selected=await service.resolve({game:game(clock)},0);assert.equal(selected.name,'Baseball');assert.match(selected.stream,/^\/preview\/iptv\/stream\//);assert.equal(selected.url,undefined);}finally{service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Bundled engine records named and extensionless HLS plus MPEG-TS, serves seekable private playback, and deletes only the chosen recording',async t=>{
  try{await fs.access(engine);}catch{t.skip('Build the recording engine with npm run build:recorder first.');return;}
  if(spawnSync('ffmpeg',['-version']).error){t.skip('System ffmpeg is needed only to generate this test fixture.');return;}
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fieldscreen-video-'));let service,upstream;
  try{
    const generated=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-preset','ultrafast','-g','24','-c:a','aac','-f','hls','-hls_time','1','-hls_list_size','0','-hls_segment_filename',path.join(dir,'s%03d.ts'),path.join(dir,'sample.m3u8')]);assert.equal(generated.status,0,generated.stderr.toString());
    upstream=http.createServer(async(req,res)=>{try{res.setHeader('Content-Type',req.url.endsWith('m3u8')?'application/vnd.apple.mpegurl':'video/mp2t');res.end(await fs.readFile(path.join(dir,req.url==='/opaque'?'sample.m3u8':path.basename(req.url))));}catch{res.writeHead(404);res.end();}});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
    service=await startLocalServer({directory:path.resolve('public/preview'),recordings:{stateFile:path.join(dir,'state.json'),ffmpeg:engine,interval:100}});
    const call=async(route,body,headers={})=>fetch(new URL(route,service.url),{method:body?'POST':'GET',headers:{'X-FieldScreen':'1',...headers},...(body?{body:JSON.stringify(body)}:{})});
    const connected=await(await call('iptv/connect',{type:'m3u',playlist:`#EXTM3U\n#EXTINF:-1,HLS fixture\nhttp://127.0.0.1:${upstream.address().port}/sample.m3u8\n#EXTINF:-1,TS fixture\nhttp://127.0.0.1:${upstream.address().port}/s000.ts\n#EXTINF:-1,Extensionless HLS fixture\nhttp://127.0.0.1:${upstream.address().port}/opaque`})).json();
    await service.recorder.setFolder(dir);
    for(const channel of connected.channels){
      const created=await service.recorder.create({channelId:channel.id,title:channel.name,hours:1});
      await until(async()=>['saved','partial','failed'].includes((await service.recorder.status()).jobs.find(j=>j.id===created.id).state));
      const job=(await service.recorder.status()).jobs.find(j=>j.id===created.id);assert.equal(job.state,'saved',job.note);assert(job.bytes>5000);assert(job.duration>0);
      const media=await fetch(new URL(job.media,service.url),{headers:{Range:'bytes=0-127'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,128);assert.match(media.headers.get('content-range'),/^bytes 0-127\//);
      assert.equal((await fetch(new URL(job.media,service.url),{headers:{Origin:'https://evil.test'}})).status,403);
      assert.equal((await call('recordings/status',null,{'X-FieldScreen':'0'})).status,403);
      assert.equal((await call('recordings/set-folder',{folder:'/tmp'})).status,404);
      const probe=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_name','-of','json',path.join(dir,job.file)]);assert.equal(probe.status,0);assert.match(probe.stdout.toString(),/h264/);
      await service.recorder.remove(job.id);assert.equal((await fetch(new URL(job.media,service.url))).status,404);
    }
    await fs.access(path.join(dir,'sample.m3u8'));
  }finally{await service?.recorder.shutdown();service?.close();upstream?.closeAllConnections();if(upstream)await new Promise(r=>upstream.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

test('A damaged recording catalog leaves the live app usable and preserves the original data',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fieldscreen-catalog-'));let service;
  try{
    const stateFile=path.join(dir,'state.json');await fs.writeFile(stateFile,'damaged but do not replace');
    await fs.writeFile(path.join(dir,'index.html'),'<h1>Live app fixture</h1>');
    service=await startLocalServer({directory:dir,recordings:{stateFile,ffmpeg:engine}});
    assert.equal((await fetch(service.url)).status,200);
    const response=await fetch(new URL('recordings/status',service.url),{headers:{'X-FieldScreen':'1'}});
    const status=await response.json();assert.equal(status.supported,false);assert.match(status.error,/left in place/);
    assert.equal((await fetch(new URL('iptv/status',service.url),{headers:{'X-FieldScreen':'1'}})).status,200);
    assert.equal(await fs.readFile(stateFile,'utf8'),'damaged but do not replace');
  }finally{await service?.recorder.shutdown();service?.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('A scheduled game starts on time, and stop or shutdown finalizes a running recording',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fieldscreen-scheduler-'));let rec,clock=Date.now(),resolved=0;
  try{
    // Controllable child imitates a long-running media writer; the other test
    // verifies the actual FFmpeg codecs, muxer, and playable output.
    const fake=path.join(dir,'writer');await fs.writeFile(fake,`#!${process.execPath}\nconst fs=require('node:fs');fs.writeSync(3,Buffer.alloc(6000));process.stdout.write('out_time_us=4000000\\n');process.stdin.on('data',()=>process.exit(0));setInterval(()=>{},1000);`,{mode:0o700});
    rec=await createRecorder({stateFile:path.join(dir,'state.json'),ffmpeg:fake,now:()=>clock,interval:0,origin:()=> 'http://127.0.0.1:1',provider:{snapshot:async()=>({connected:true,channels:[]}),resolve:async()=>{resolved++;return{id:'fixture',name:'Test',format:'mpegts',stream:'/preview/iptv/stream/test'};}}});
    await rec.setFolder(dir);const first=await rec.create({game:game(clock+3600000),hours:1});await rec.tick();assert.equal(resolved,0);
    clock+=3600000;await rec.tick();await until(async()=> (await rec.status()).jobs[0].duration===4);assert.equal(resolved,1);assert.equal(rec.count(),1);
    await rec.stop(first.id);let job=(await rec.status()).jobs[0];assert.equal(job.state,'saved');assert.equal(job.bytes,6000);assert.equal(rec.count(),0);
    const second=await rec.create({game:{...game(clock),id:'9999'},hours:1});await until(async()=> (await rec.status()).jobs[0].duration===4);
    await rec.shutdown();job=(await rec.status()).jobs.find(j=>j.id===second.id);assert.equal(job.state,'saved');assert.match(job.note,/quit/);assert.equal(rec.count(),0);
  }finally{await rec?.shutdown();await fs.rm(dir,{recursive:true,force:true});}
});
