const { SaxesParser } = require('saxes');
const { createGunzip } = require('node:zlib');
const { Readable } = require('node:stream');

class GuideError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const key = value => String(value || '').trim().toLowerCase();

function xmltvTime(value) {
  const m = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2})(\d{2}))?$/);
  if (!m) return NaN;
  const offset = m[7] ? (Number(m[8]) * 60 + Number(m[9])) * (m[7] === '-' ? -1 : 1) : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - offset * 60000;
}

// Stream only relevant programmes into memory; no external entities or DTD fetches.
async function parseGuide(source, channelIDs, now = Date.now()) {
  const parser = new SaxesParser(), guide = new Map(), decoder = new TextDecoder();
  const ids = new Map([...channelIDs].map(id => [key(id), id]));
  const stats = { programmes: 0, matchingIds: 0, currentListings: 0, latestEnd: 0 };
  let item = null, field = '', depth = 0, bytes = 0, count = 0, tv = false;
  parser.on('opentag', tag => {
    depth++;
    if (depth > 64) throw new GuideError('limit');
    if (tag.name === 'tv') tv = true;
    if (tag.name === 'programme') {
      count++; if (count > 2000000) throw new GuideError('limit');
      stats.programmes++;
      const channel = ids.get(key(tag.attributes.channel)), start = xmltvTime(tag.attributes.start), end = xmltvTime(tag.attributes.stop);
      if (channel) { stats.matchingIds++; if (Number.isFinite(end)) stats.latestEnd = Math.max(stats.latestEnd, end); }
      if (channel && end > now && start < now + 48 * 3600000 && end > start) item = { channel, start, end, title: '', description: '', category: '' };
    } else if (item && ['title', 'desc', 'category'].includes(tag.name)) field = tag.name === 'desc' ? 'description' : tag.name;
  });
  const text = value => { if (item && field) item[field] = (item[field] + value).slice(0, field === 'description' ? 1200 : 200); };
  parser.on('text', text); parser.on('cdata', text);
  parser.on('closetag', tag => {
    depth--;
    if (tag.name === 'programme' && item) {
      if (item.title.trim()) {
        stats.currentListings++;
        const list = guide.get(item.channel) || [];
        list.push(item); list.sort((a, b) => a.start - b.start);
        guide.set(item.channel, list.slice(0, 96));
      }
      item = null;
    }
    field = '';
  });
  // saxes does not resolve external entities. Reject internal declarations as well.
  parser.on('doctype', value => { if (value.includes('[')) throw new GuideError('format'); });
  for await (const chunk of source) {
    bytes += chunk.length;
    if (bytes > 512 * 1024 * 1024) throw new GuideError('limit');
    parser.write(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
  }
  parser.write(decoder.decode()).close();
  if (!tv) throw new GuideError('format');
  guide.stats = stats;
  return guide;
}

async function guideResponse(response, url, ids) {
  if (!response.body) throw new GuideError('format');
  // Inspect bytes: headers/extensions can describe already decompressed XML,
  // or omit gzip altogether. Never unzip the same response twice.
  const input = Readable.fromWeb(response.body), iterator = input[Symbol.asyncIterator]();
  const head = []; let size = 0;
  while (size < 2) { const part = await iterator.next(); if (part.done) break; head.push(Buffer.from(part.value)); size += part.value.length; }
  const prefix = Buffer.concat(head);
  const source = Readable.from((async function* () { yield prefix; for (;;) { const part = await iterator.next(); if (part.done) break; yield part.value; } })());
  let decoded = source;
  if (prefix[0] === 0x1f && prefix[1] === 0x8b) {
    decoded = createGunzip(); source.on('error', error => decoded.destroy(error)); source.pipe(decoded);
  }
  try { return await parseGuide(decoded, ids); }
  finally { decoded.destroy(); source.destroy(); input.destroy(); }
}

module.exports = { xmltvTime, parseGuide, guideResponse, GuideError };
