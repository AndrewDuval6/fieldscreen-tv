import { createRequire } from 'node:module';
import { access, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const entries = asar.listPackage('release/linux-unpacked/resources/app.asar');
for (const entry of ['/main.cjs', '/preload.cjs', '/iptv.cjs', '/vault.cjs', '/favorites.cjs', '/display.cjs', '/licenses/saxes-LICENSE.txt', '/licenses/xmlchars-LICENSE.txt']) assert(entries.includes(entry), `Packaged app is missing ${entry}`);
assert(!entries.some(entry => entry.includes('node_modules') || entry.includes('provider.enc')), 'Unexpected runtime contents');
const prefix = 'release/linux-unpacked/resources/public/preview/';
for (const file of ['index.html', 'preview.js', 'preview.css', 'iptv-runtime.js', 'nfl-runtime.js', 'mlb-runtime.js', 'mma-runtime.js', 'sports-runtime.js', 'favorites-runtime.js', 'hls.min.js', 'mpegts.js', 'tv-runtime.js', 'display-runtime.js', 'navigation-runtime.js', 'pane-runtime.js', 'recorder-runtime.js', 'fieldscreen-mark.png', 'HLS-LICENSE.txt', 'MPEGTS-LICENSE.txt']) await access(prefix + file);
assert((await readFile(prefix + 'index.html', 'utf8')).includes('./iptv-runtime.js'));
assert(asar.extractFile('release/linux-unpacked/resources/app.asar', 'iptv.cjs').toString().includes('/preview/nfl/'));
assert(asar.extractFile('release/linux-unpacked/resources/app.asar', 'iptv.cjs').toString().includes('/preview/mlb/'));
for (const file of ['ffmpeg','FFmpeg-LICENSE.txt','musl-LICENSE.txt','NOTICE.txt']) await access('release/linux-unpacked/resources/recorder/' + file);
assert(asar.extractFile('release/linux-unpacked/resources/app.asar', 'iptv.cjs').toString().includes('/preview/recordings/'));
console.log('Packaged recording engine, library, and NFL and MLB data service, IPTV service, guide parser, players, licenses, and UI are present.');

assert(asar.extractFile('release/linux-unpacked/resources/app.asar', 'iptv.cjs').toString().includes('/preview/mma/'));

await access('release/linux-unpacked/fieldscreen-tv-bin');
assert((await readFile('release/linux-unpacked/fieldscreen-tv','utf8')).includes('gameoverlayrenderer.so'));
