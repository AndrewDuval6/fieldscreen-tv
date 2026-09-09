import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { icons } from 'lucide-react';
import { build } from 'esbuild';

const output = new URL('../public/preview/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('../node_modules/lucide-react/LICENSE', import.meta.url), new URL('Lucide-LICENSE.txt', output));
await cp(new URL('../public/images/fieldscreen-mark.png', import.meta.url), new URL('fieldscreen-mark.png', output));
await cp(new URL('../node_modules/hls.js/dist/hls.min.js', import.meta.url), new URL('hls.min.js', output));
await cp(new URL('../node_modules/hls.js/LICENSE', import.meta.url), new URL('HLS-LICENSE.txt', output));
await cp(new URL('../node_modules/mpegts.js/dist/mpegts.js', import.meta.url), new URL('mpegts.js', output));
await cp(new URL('../node_modules/mpegts.js/LICENSE', import.meta.url), new URL('MPEGTS-LICENSE.txt', output));
await mkdir(new URL('../desktop/generated/licenses/', import.meta.url), { recursive: true });
await cp(new URL('../desktop/licenses/saxes-LICENSE.txt', import.meta.url), new URL('../desktop/generated/licenses/saxes-LICENSE.txt', import.meta.url));
await cp(new URL('../node_modules/xmlchars/LICENSE', import.meta.url), new URL('../desktop/generated/licenses/xmlchars-LICENSE.txt', import.meta.url));
await build({ entryPoints: [new URL('../desktop/iptv.cjs', import.meta.url).pathname], outfile: new URL('../desktop/generated/iptv.cjs', import.meta.url).pathname, platform: 'node', format: 'cjs', bundle: true, target: 'node22' });
let source = await readFile(new URL('../design/tv-preview.html', import.meta.url), 'utf8');
source = source.replace(/<link[^>]*fonts.googleapis.com[^>]*>/, '')
  .replace('width>=760', 'true')
  .replace('DECK UI PREVIEW', 'TV CONTROLLER')
  .replace('aria-label="FieldScreen field-green NFL dashboard concept"', 'aria-label="FieldScreen TV preview"');

const fontFiles = [];
for (const [family, label, weights] of [
  ['barlow-condensed','Barlow Condensed',[500,600,700,800]],
  ['ibm-plex-mono','IBM Plex Mono',[400,500,600]],
  ['inter','Inter',[400,500,600,700]],
]) {
  await mkdir(new URL('fonts/', output), { recursive: true });
  for (const weight of weights) {
    const name = `${family}-latin-${weight}-normal.woff2`;
    await cp(new URL(`../node_modules/@fontsource/${family}/files/${name}`, import.meta.url), new URL(`fonts/${name}`, output));
    fontFiles.push(`@font-face{font-family:'${label}';font-style:normal;font-weight:${weight};font-display:swap;src:url('./fonts/${name}') format('woff2')}`);
  }
  await cp(new URL(`../node_modules/@fontsource/${family}/LICENSE`, import.meta.url), new URL(`fonts/${family}-LICENSE.txt`, output));
}
const names = new Set([...source.matchAll(/["']([a-z][a-z0-9-]+)["']/g)].map(match => match[1]));
const map = {};
const iconNames = new Map(Object.keys(icons).map(key => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), key]));
for (const name of names) {
  const key = iconNames.get(name.replace(/-/g, ''));
  if (icons[key]) map[name] = renderToStaticMarkup(createElement(icons[key], { width: 16, height: 16, 'aria-hidden': true }));
}
const iconRuntime = `const icons=${JSON.stringify(map)};globalThis.lucide={createIcons(){document.querySelectorAll('i[data-lucide]').forEach(node=>{const markup=icons[node.dataset.lucide];if(!markup)return;const template=document.createElement('template');template.innerHTML=markup;node.replaceWith(template.content.firstElementChild)})}};`;
const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
source = source.replace(/<script>[\s\S]*?<\/script>/g, '');
const styles = [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]);
source = source.replace(/<style>[\s\S]*?<\/style>/g, '');
await writeFile(new URL('preview.css', output), fontFiles.join('\n') + '\n' + styles.join('\n') + '\n' + await readFile(new URL('./tv-shell.css', import.meta.url), 'utf8') + '\n' + await readFile(new URL('./iptv.css', import.meta.url), 'utf8'));
await writeFile(new URL('preview.js', output), iconRuntime + '\n' + scripts.join('\n') + '\nlucide.createIcons();');
const controller = (await readFile(new URL('./controller-core.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
const runtime = (await readFile(new URL('./tv-runtime.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/, '');
await writeFile(new URL('tv-runtime.js', output), '(()=>{\n' + controller + '\n' + runtime + '\n})();');
const iptvCore = (await readFile(new URL('./iptv-core.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
const iptvRuntime = (await readFile(new URL('./iptv-runtime.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/, '');
await writeFile(new URL('iptv-runtime.js', output), '(()=>{\n' + iptvCore + '\n' + iptvRuntime + '\n})();');
await writeFile(new URL('index.html', output), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>FieldScreen TV — Preview</title><link rel="stylesheet" href="./preview.css"></head>
<body>${source}<script src="./preview.js"></script><script src="./hls.min.js"></script><script src="./mpegts.js"></script><script src="./iptv-runtime.js"></script><script src="./tv-runtime.js"></script></body></html>`);
console.log('Built FieldScreen TV with local IPTV, XMLTV guide, and controller support.');
