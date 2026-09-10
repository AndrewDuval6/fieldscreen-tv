import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { normalizeFavorites, favoriteGames, createFavoriteStore } from '../scripts/favorites-core.mjs';
const require = createRequire(import.meta.url);
const { createFavorites } = require('../desktop/favorites.cjs');
const { createNFL } = require('../desktop/nfl.cjs');
const { createMLB } = require('../desktop/mlb.cjs');

test('Favorite identity includes the league, deduplicates teams, and rejects malformed storage', () => {
  assert.deepEqual(normalizeFavorites(['nfl:1','mlb:1','nfl:1']), ['mlb:1','nfl:1']);
  for (const value of [null, {}, ['JAX'], ['nfl:../test'], ['nfl:<script>'], Array(257).fill('nfl:1')]) assert.throws(() => normalizeFavorites(value));
});
const game = (league, id, state, date, away='1', home='2') => ({league,id,state,date,live:state==='in',complete:state==='post',away:{id:away},home:{id:home}});
test('Cross-league favorites match either side once, keep doubleheaders, and put live games before upcoming and recent results', () => {
  const games = [
    game('nfl','11','pre','2026-09-13T17:00Z'),
    game('mlb','11','in','2026-09-10T17:00Z'),
    game('mlb','12','pre','2026-09-10T21:00Z'),
    game('mlb','13','post','2026-09-09T17:00Z'),
    game('mlb','14','post','2026-09-10T17:00Z'),
    game('mlb','15','in','2026-09-10T17:00Z','8','9'),
  ];
  const favorites = ['nfl:1','mlb:1','mlb:2'];
  assert.deepEqual(favoriteGames([...games,games[1]], favorites).map(g=>`${g.league}:${g.id}`), ['mlb:11','mlb:12','nfl:11','mlb:14','mlb:13']);
  assert.deepEqual(favoriteGames(games,['nfl:2']).map(g=>g.league), ['nfl']);
  assert.deepEqual(favoriteGames(games,[]), []);
  assert.equal(games.length, 6);
});
test('Browser preferences survive a fresh store and report writes that do not persist', async () => {
  const values = new Map(), storage = {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  assert.deepEqual(await createFavoriteStore(storage).read(), []);
  await createFavoriteStore(storage).write(['nfl:30','mlb:147']);
  assert.deepEqual(await createFavoriteStore(storage).read(), ['mlb:147','nfl:30']);
  await assert.rejects(createFavoriteStore({...storage,setItem(){}}).write(['nfl:1']), /verification/);
  await createFavoriteStore(storage).write([]);
  assert.deepEqual(await createFavoriteStore(storage).read(), []);
});
test('Desktop favorites survive restart without relying on a browser address and verify private disk writes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'fs-favorites-'));
  try {
    const file = path.join(dir,'profile','favorites.json');
    assert.deepEqual(await createFavorites(file).read(), []);
    await createFavorites(file).write(['mlb:147','nfl:30','nfl:30']);
    assert.deepEqual(await createFavorites(file).read(), ['mlb:147','nfl:30']);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(path.dirname(file)), ['favorites.json']);
    const store = createFavorites(file);
    await Promise.all([store.write(['nfl:1']),store.write(['mlb:2'])]);
    assert.deepEqual(await createFavorites(file).read(), ['mlb:2']);
    await store.write([]);
    assert.deepEqual(await createFavorites(file).read(), []);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('Invalid, corrupted, or unwritable desktop storage never claims success or silently overwrites saved data', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'fs-favorites-'));
  try {
    const file = path.join(dir,'favorites.json'), store = createFavorites(file);
    await store.write(['nfl:1']); const before = await readFile(file,'utf8');
    assert.throws(()=>store.write(['<invalid>']));
    assert.equal(await readFile(file,'utf8'),before);
    await writeFile(file,'invalid json');
    await assert.rejects(store.read(),/could not be read/);
    assert.equal(await readFile(file,'utf8'),'invalid json');
    await assert.rejects(createFavorites(path.join(file,'child.json')).write(['nfl:1']),/could not be saved/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
for (const [league,create,fixture] of [['nfl',createNFL,{events:[]}],['mlb',createMLB,{dates:[]}]]) {
  test(`${league.toUpperCase()} Favorites uses the current rolling schedule, not historical browsing parameters, and shares cached requests`, async () => {
    const urls=[];
    const service=create({now:()=>Date.parse('2026-12-31T22:00:00Z'),fetcher:async url=>{urls.push(String(url));return new Response(JSON.stringify(fixture));}});
    const server=http.createServer((req,res)=>service.handle(req,res,()=>res.end()));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base=`http://127.0.0.1:${server.address().port}/preview/${league}/favorites`;
    try {
      assert.equal((await fetch(base)).status,403);
      const request=()=>fetch(base+'?season=2020&date=2020-05-05',{headers:{'X-FieldScreen':'1'}});
      const responses=await Promise.all([request(),request()]);
      for(const response of responses){assert.equal(response.status,200);assert.deepEqual((await response.json()).games,[]);}
      assert.equal(urls.length,1);
      const url=new URL(urls[0]);
      if(league==='nfl')assert.equal(url.searchParams.get('dates'),'20261230-20270107');
      else {assert.equal(url.searchParams.get('startDate'),'2026-12-30');assert.equal(url.searchParams.get('endDate'),'2027-01-07');assert.equal(url.searchParams.has('date'),false);}
    } finally {service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
  });
}
