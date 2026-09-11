import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
const run = promisify(execFile);

test('packaged launcher removes Steam overlay preloads and preserves launch arguments', async () => {
  const folder = await mkdtemp(path.join(tmpdir(),'fieldscreen launcher '));
  try {
    await copyFile('desktop/launch.sh',path.join(folder,'fieldscreen-tv'));
    await writeFile(path.join(folder,'fieldscreen-tv-bin'),'#!/bin/sh\nprintf "preload=%s\\n" "${LD_PRELOAD:-}"\nprintf "arg=%s\\n" "$@"\n',{ mode:0o755 });
    const env = { ...process.env, SteamGameId:'123', LD_PRELOAD:'/fixture/ubuntu12_32/gameoverlayrenderer.so:/fixture/ubuntu12_64/gameoverlayrenderer.so' };
    const launch = await run('/bin/sh',[path.join(folder,'fieldscreen-tv'),'--windowed','a path with spaces'],{ env });
    assert.equal(launch.stdout,'preload=\narg=--ozone-platform=x11\narg=--windowed\narg=a path with spaces\n');
    const explicit = await run('/bin/sh',[path.join(folder,'fieldscreen-tv'),'--ozone-platform=wayland'],{ env:{ ...env,LD_PRELOAD:env.LD_PRELOAD+':/fixture/custom.so' } });
    assert.equal(explicit.stdout,'preload=/fixture/custom.so\narg=--ozone-platform=wayland\n');
    const desktop = await run('/bin/sh',[path.join(folder,'fieldscreen-tv'),'--windowed'],{env:{...env,SteamGameId:'',SteamAppId:'',LD_PRELOAD:''}});
    assert.equal(desktop.stdout,'preload=\narg=--windowed\n');
  } finally { await rm(folder,{recursive:true,force:true}); }
});
