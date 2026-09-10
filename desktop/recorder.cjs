const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');

const PREFIX = '/preview/recordings/';
const GiB = 1024 ** 3;
const pendingStates = new Set(['scheduled', 'waiting', 'starting', 'recording', 'stopping']);
const clean = value => String(value || '').replace(/[\u0000-\u001f]/g, '').slice(0, 160);
class RecordingError extends Error {}
const fail = text => { throw new RecordingError(text); };

// Files and scheduling stay in the main process. No provider URLs enter the
// catalog, process arguments, or renderer; FFmpeg reads local stream capabilities.
async function createRecorder({ stateFile, ffmpeg, provider, origin, now = Date.now, reserveBytes = GiB, interval = 5000, onChange = () => {} }) {
  let db = { version: 1, folder: '', jobs: [] }, saveQueue = Promise.resolve(), closed = false, ticking = false, launching = false;
  let viewing = 0, viewingAt = 0, lastError = '';
  const running = new Map(), mediaToken = randomBytes(24).toString('hex');
  await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  try {
    const saved = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    if (saved.version !== 1 || !Array.isArray(saved.jobs) || saved.jobs.length > 1000) throw new Error('catalog');
    db = saved;
  } catch (error) { if (error.code !== 'ENOENT') fail('The recordings catalog could not be read. Your video files have been left in place.'); }
  const persist = () => {
    const body = JSON.stringify(db, null, 2);
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const temp = stateFile + '.' + randomUUID() + '.tmp';
      try { await fs.writeFile(temp, body, { mode: 0o600, flag: 'wx' }); await fs.rename(temp, stateFile); }
      finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    });
    return saveQueue;
  };
  const changed = async () => { try { await persist(); lastError = ''; } catch { lastError = 'Could not save the recordings catalog. Check app storage before scheduling more games.'; } onChange(); };
  const fileFor = job => {
    if (!job.folder || !path.isAbsolute(job.folder) || !job.file || path.basename(job.file) !== job.file || !/\.mp4$/.test(job.file)) fail('Recording file is unavailable.');
    return path.join(job.folder, job.file);
  };
  const bytesFor = async job => { try { return (await fs.stat(fileFor(job))).size; } catch { return 0; } };
  for (const job of db.jobs) if (['starting','recording','stopping'].includes(job.state)) {
    job.bytes = await bytesFor(job); job.state = job.bytes > 2048 ? 'partial' : 'failed'; job.note = 'Recording was interrupted when the app or computer stopped.'; job.endedAt = now();
  }
  await persist();
  async function storage(folder = db.folder, verify = false) {
    if (!folder) return { ready: false, free: 0, note: 'Choose where FieldScreen should save your games.' };
    let probe;
    try {
      if (!(await fs.stat(folder)).isDirectory()) throw new Error('folder');
      if (verify) {
        probe = path.join(folder, '.fieldscreen-check-' + randomUUID());
        const sample = randomUUID(); await fs.writeFile(probe, sample, { flag: 'wx', mode: 0o600 });
        if (await fs.readFile(probe, 'utf8') !== sample) throw new Error('readback');
      }
      const info = await fs.statfs(folder), free = info.bavail * info.bsize;
      return { ready: free > reserveBytes, free, note: free > reserveBytes ? 'Folder verified. Recordings stay on this computer.' : 'Less than 1 GB available. Free up space or choose another folder.' };
    } catch { return { ready: false, free: 0, note: 'This folder is missing, disconnected, or not writable. Reconnect the drive or choose another folder.' }; }
    finally { if (probe) await fs.rm(probe, { force: true }).catch(() => {}); }
  }
  async function setFolder(folder) {
    const resolved = await fs.realpath(folder).catch(() => fail('Choose an existing storage folder.'));
    const check = await storage(resolved, true); if (!check.ready) fail(check.note);
    const previous = db.folder; db.folder = resolved;
    try { await persist(); } catch { db.folder = previous; fail('Could not remember this folder. Check app storage.'); }
    onChange(); return status();
  }
  async function status() {
    const disk = await storage();
    const jobs = await Promise.all(db.jobs.map(async job => ({ ...job, bytes: job.file ? await bytesFor(job) : 0,
      media: job.file && ['saved','partial'].includes(job.state) ? PREFIX + 'media/' + mediaToken + '/' + job.id : null })));
    return { supported: true, folder: db.folder, storage: disk, jobs: jobs.reverse(), error: lastError, active: running.size,
      scheduled: jobs.filter(j => ['scheduled','waiting'].includes(j.state)).length, engineReady: await fs.access(ffmpeg, constants.X_OK).then(() => true, () => false) };
  }
  const viewers = () => now() - viewingAt < 15000 ? viewing : 0;
  async function create(input) {
    if (closed) fail('The recorder is shutting down. Reopen FieldScreen.');
    if (db.jobs.length >= 1000) fail('The library is full. Remove old entries before adding another recording.');
    if (lastError) fail(lastError);
    if (launching) fail('A recording is being prepared. Try again in a moment.');
    launching = true;
    try {
      const check = await storage(db.folder, true); if (!check.ready) fail(check.note);
      await fs.access(ffmpeg, constants.X_OK).catch(() => fail('The recording engine is missing. Reinstall the latest FieldScreen TV release.'));
      const duration = Number(input.hours);
      if (![1,2,3,4,5,6,8].includes(duration)) fail('Choose a recording length from 1 to 8 hours.');
      let game = null;
      if (input.game) {
        const g = input.game;
        if (!['nfl','mlb'].includes(g.league) || !/^\d{1,16}$/.test(String(g.id)) || !g.home?.name || !g.away?.name || g.complete || g.timeTBD || g.home.placeholder || g.away.placeholder || !Number.isFinite(Date.parse(g.date))) fail('This game does not have a confirmed start time.');
        const team = t => ({ name: clean(t.name), fullName: clean(t.fullName), abbr: clean(t.abbr) });
        game = { id: String(g.id), league: g.league, date: new Date(g.date).toISOString(), home: team(g.home), away: team(g.away), network: clean(g.network), doubleHeader: Boolean(g.doubleHeader), gameNumber: Number(g.gameNumber) || 1 };
      }
      const scheduled = Boolean(game && Date.parse(game.date) > now() + 120000);
      const startAt = scheduled ? Date.parse(game.date) - 120000 : now();
      if (startAt > now() + 366 * 86400000) fail('Choose a game within the next year.');
      const title = game ? `${game.away.abbr || game.away.name} at ${game.home.abbr || game.home.name}` : clean(input.title) || 'Live recording';
      const p = await provider.snapshot();
      if (!p.connected && !p.saved) fail('Connect and remember your IPTV provider before scheduling a recording.');
      const channel = !game ? p.channels.find(c => c.id === input.channelId) : null;
      if (!game && !channel) fail('This channel is no longer connected.');
      if (db.jobs.some(j => pendingStates.has(j.state) && (game ? j.game?.id === game.id && j.game?.league === game.league : j.channel?.id === channel.id))) fail('This game or channel is already scheduled or recording.');
      const endAt = (scheduled ? Date.parse(game.date) : now()) + duration * 3600000;
      const overlap = db.jobs.filter(j => pendingStates.has(j.state) && j.startAt < endAt && j.endAt > startAt);
      const limit = Math.min(2, Number(p.maxConnections) || 2);
      if (overlap.length >= limit) fail(`These times overlap with ${limit} other recording${limit === 1 ? '' : 's'}. Choose a different time or cancel one first.`);
      if (!scheduled && Number(p.maxConnections) && viewers() + running.size >= Number(p.maxConnections)) fail('Your provider’s connections are in use. Close a live screen before recording.');
      const job = { id: randomUUID(), title, game, channel: channel ? { id: channel.id, name: channel.name, epgId: channel.epgId } : null, state: 'scheduled', createdAt: now(), startAt, endAt, hours: duration, folder: db.folder, note: scheduled ? 'Waiting for the saved start time. The guide will find the channel.' : 'Preparing your recording.' };
      db.jobs.push(job);
      try { await persist(); } catch { db.jobs.pop(); fail('The schedule could not be saved. Check app storage.'); }
      onChange(); void tick(); return { id: job.id };
    } finally { launching = false; }
  }
  async function start(job) {
    job.state = 'starting'; job.note = 'Checking storage and matching the broadcast…'; await changed();
    try {
      const disk = await storage(job.folder, true); if (!disk.ready) fail(disk.note);
      const selected = await provider.resolve(job, viewers() + running.size);
      if (closed || job.state !== 'starting') return;
      if (!selected?.stream) fail('Your guide has not confirmed a channel for this game yet.');
      const stream = new URL(selected.stream, origin());
      if (stream.origin !== origin() || !stream.pathname.startsWith('/preview/iptv/stream/')) fail('This stream is no longer available.');
      job.channel = { id: selected.id, name: selected.name, epgId: selected.epgId };
      const name = job.title.replace(/[^a-zA-Z0-9 -]/g, '').trim().slice(0, 65) || 'Game';
      job.file = `${new Date(now()).toISOString().slice(0,10)} ${name} ${job.id}.mp4`;
      const output = await fs.open(fileFor(job), 'wx', 0o600);
      if (closed || job.state !== 'starting') { await output.close(); await fs.rm(fileFor(job), {force:true}); job.file = null; return; }
      // HLS has extension checks that must be relaxed for opaque proxy paths.
      // Those demuxer-specific options are invalid on direct MPEG-TS feeds.
      const hlsOptions = selected.format === 'hls' ? ['-allowed_extensions','ALL','-extension_picky','0'] : [];
      const args = ['-hide_banner','-loglevel','error','-nostats','-rw_timeout','20000000','-protocol_whitelist','http,tcp,crypto',...hlsOptions,'-i',stream.href,'-map','0:v:0','-map','0:a:0?','-c:v','copy','-c:a','aac','-b:a','160k','-map_metadata','-1','-map_chapters','-1','-t',String(Math.max(1, Math.ceil((job.endAt-now())/1000))),'-movflags','frag_keyframe+empty_moov+default_base_moof','-f','mp4','-progress','pipe:1','pipe:3'];
      let child;
      try { child = spawn(ffmpeg, args, { stdio: ['pipe','pipe','ignore',output.fd], windowsHide: true }); }
      catch (error) { await output.close(); throw error; }
      let resolveDone;
      const run = { child, done: new Promise(r => resolveDone = r), stop: false, lastBytes: 0, lastGrowth: now(), timers: [] };
      running.set(job.id, run); job.startedAt = now(); job.state = 'recording'; job.note = 'Recording to your computer';
      let progress = '';
      child.stdin.on('error', () => {});
      child.stdout.on('data', data => {
        progress = (progress + data.toString()).slice(-4096);
        const times = [...progress.matchAll(/out_time_us=(\d+)/g)];
        if (times.length) job.duration = Math.round(Number(times.at(-1)[1]) / 1000000);
      });
      child.once('error', () => { job.note = 'The recording engine could not start. Reinstall FieldScreen TV.'; });
      child.once('close', async code => {
        run.timers.forEach(clearTimeout); running.delete(job.id); job.endedAt = now(); job.bytes = await bytesFor(job);
        const hasVideo = job.bytes > 2048 && job.duration > 0;
        job.state = hasVideo ? run.stop || code === 0 ? 'saved' : 'partial' : 'failed';
        if (!hasVideo) job.note = 'No playable video was saved. Check the channel, provider connection limit, and supported format.';
        else if (!run.reason) job.note = code === 0 || run.stop ? 'Saved on this computer' : 'The stream ended unexpectedly. The available video was saved.';
        else job.note = run.reason;
        if (!hasVideo) { await fs.rm(fileFor(job), { force: true }).catch(() => {}); job.file = null; }
        await changed(); resolveDone();
      });
      // Install error/close listeners before yielding: an executable can fail
      // immediately even when its file exists and has executable permissions.
      await output.close();
      await changed();
    } catch (error) {
      if (closed || job.state !== 'starting') return;
      const withinWindow = now() < Math.min(job.endAt, job.startAt + 30 * 60000);
      job.state = withinWindow ? 'waiting' : 'failed'; job.retryAt = now() + 60000;
      job.note = error instanceof RecordingError ? error.message : 'Could not start the recording. Check your provider and connection.';
      if (withinWindow) job.note += ' Trying again in one minute.';
      await changed();
    }
  }
  async function stop(id, reason = 'Stopped by you. The available video was saved.') {
    const job = db.jobs.find(j => j.id === id); if (!job) fail('Recording not found.');
    const run = running.get(id);
    if (!run) {
      if (pendingStates.has(job.state)) { job.state = 'cancelled'; job.note = 'Recording cancelled'; await changed(); }
      return;
    }
    if (run.stop) return run.done;
    run.stop = true; run.reason = reason; job.state = 'stopping'; job.note = 'Finishing the video file…'; await changed();
    run.child.stdin.write('q\n');
    run.timers.push(setTimeout(() => run.child.kill('SIGINT'), 4000), setTimeout(() => run.child.kill('SIGKILL'), 8000));
    await run.done;
  }
  async function tick() {
    if (ticking || closed) return; ticking = true;
    try {
      for (const [id, run] of running) {
        const job = db.jobs.find(j => j.id === id), size = await bytesFor(job);
        if (size > run.lastBytes) { run.lastBytes = size; run.lastGrowth = now(); }
        if (!run.stop && now() >= job.endAt) void stop(id, 'Scheduled recording time finished.');
        else if (!run.stop && !(await storage(job.folder)).ready) void stop(id, 'Storage became unavailable or fell below 1 GB. The available video was saved.');
        else if (!run.stop && now() - run.lastGrowth > 90000) void stop(id, 'The stream stopped delivering video. The available video was saved.');
      }
      for (const job of db.jobs) {
        if (!['scheduled','waiting'].includes(job.state) || job.startAt > now()) continue;
        if (job.endAt <= now() || now() > job.startAt + 30 * 60000) { job.state = 'missed'; job.note = 'The start window passed while FieldScreen or the provider was unavailable.'; await changed(); continue; }
        if (running.size >= 2 || job.retryAt > now()) continue;
        await start(job);
      }
    } finally { ticking = false; }
  }
  async function remove(id) {
    const index = db.jobs.findIndex(j => j.id === id), job = db.jobs[index];
    if (!job) fail('Recording not found.');
    if (pendingStates.has(job.state)) fail('Stop or cancel this recording before deleting it.');
    if (job.file) await fs.unlink(fileFor(job)).catch(e => { if (e.code !== 'ENOENT') fail('Could not delete this video. Check access to its folder.'); });
    db.jobs.splice(index,1); await changed();
  }
  async function handle(req, res, next) {
    const url = new URL(req.url, 'http://' + req.headers.host);
    if (!url.pathname.startsWith(PREFIX)) return next();
    const json = (code,data) => { res.writeHead(code, { 'Content-Type':'application/json','Cache-Control':'no-store' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cross-Origin-Resource-Policy','same-origin'); res.setHeader('X-Content-Type-Options','nosniff');
    if (url.origin !== origin() || req.headers.origin && req.headers.origin !== origin() || req.headers['sec-fetch-site'] === 'cross-site') return json(403,{error:'Local access only.'});
    try {
      if (url.pathname.startsWith(PREFIX+'media/'+mediaToken+'/')) {
        if (!['GET','HEAD'].includes(req.method)) return json(405,{error:'Read only.'});
        const job = db.jobs.find(j => j.id === url.pathname.split('/').at(-1));
        if (!job || !['saved','partial'].includes(job.state) || !job.file) return json(404,{error:'Recording unavailable.'});
        const file = fileFor(job), handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await handle.stat(); if (!stat.isFile()) fail('Recording unavailable.');
          const range = byteRange(req.headers.range,stat.size);
          if (!range) { res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}); return res.end(); }
          const {start,end} = range;
          res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type':'video/mp4','Cache-Control':'no-store','Accept-Ranges':'bytes','Content-Length':end-start+1,...(req.headers.range ? {'Content-Range':`bytes ${start}-${end}/${stat.size}`} : {}) });
          if (req.method === 'HEAD') return res.end();
          const stream = handle.createReadStream({start,end,autoClose:false});
          await new Promise(resolve => { res.once('close', () => { stream.destroy(); resolve(); }); stream.once('error',()=>{res.destroy();resolve();}); stream.once('end',resolve); stream.pipe(res); });
        } finally { await handle.close(); }
        return;
      }
      if (req.headers['x-fieldscreen'] !== '1') return json(403,{error:'Open recordings in FieldScreen.'});
      const route = url.pathname.slice(PREFIX.length);
      if (req.method === 'GET' && route === 'status') return json(200,await status());
      if (req.method !== 'POST') return json(405,{error:'Method not allowed.'});
      let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 16000) return json(413,{error:'Request too large.'}); }
      let data; try { data = JSON.parse(text || '{}'); } catch { return json(400,{error:'Invalid request.'}); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return json(400,{error:'Invalid request.'});
      if (route === 'create') return json(200,await create(data));
      if (route === 'stop') { await stop(data.id); return json(200,{}); }
      if (route === 'delete') { await remove(data.id); return json(200,{}); }
      if (route === 'heartbeat') { viewing = Math.max(0,Math.min(4,Number(data.playing)||0)); viewingAt = now(); return json(200,{}); }
      return json(404,{error:'Unknown recording request.'});
    } catch (error) { if (res.headersSent) res.destroy(); else json(400,{error:error instanceof RecordingError ? error.message : 'Recording storage is unavailable. Check the folder and free space.'}); }
  }
  const timer = interval ? setInterval(() => void tick().catch(() => {}),interval) : null; timer?.unref();
  return { status, create, stop, remove, setFolder, handle, tick, hasWork: () => db.jobs.some(j => pendingStates.has(j.state)), count: () => running.size,
    async shutdown() { closed = true; clearInterval(timer); await Promise.all([...running.keys()].map(id=>stop(id,'FieldScreen quit. The available video was saved.'))); await changed(); },
    close() { closed = true; clearInterval(timer); for (const run of running.values()) run.child.kill('SIGINT'); },
  };
}
function byteRange(value, size) {
  if (!size) return null;
  if (!value) return {start:0,end:size-1};
  const match = /^bytes=(\d*)-(\d*)$/.exec(value); if (!match || !match[1] && !match[2]) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size-1,Number(match[2])) : size-1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? {start,end} : null;
}
module.exports = { createRecorder, byteRange };
