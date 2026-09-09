const { SaxesParser } = require('saxes');
const { createGunzip } = require('node:zlib');
const { Readable } = require('node:stream');

function xmltvTime(value) {
  const m = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2})(\d{2}))?$/);
  if (!m) return NaN;
  const offset = m[7] ? (Number(m[8]) * 60 + Number(m[9])) * (m[7] === '-' ? -1 : 1) : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - offset * 60000;
}

// Stream only relevant programmes into memory; no external entities or DTD fetches.
async function parseGuide(source, channelIDs, now = Date.now()) {
  const parser = new SaxesParser(), guide = new Map(), decoder = new TextDecoder();
  let item = null, field = '', depth = 0, bytes = 0, count = 0, tv = false;
  parser.on('opentag', tag => {
    depth++;
    if (depth > 64) throw new Error('Guide nesting limit');
    if (tag.name === 'tv') tv = true;
    if (tag.name === 'programme') {
      count++; if (count > 1000000) throw new Error('Guide programme limit');
      const channel = tag.attributes.channel, start = xmltvTime(tag.attributes.start), end = xmltvTime(tag.attributes.stop);
      if (channelIDs.has(channel) && end > now && start < now + 48 * 3600000 && end > start) item = { channel, start, end, title: '', description: '', category: '' };
    } else if (item && ['title', 'desc', 'category'].includes(tag.name)) field = tag.name === 'desc' ? 'description' : tag.name;
  });
  const text = value => { if (item && field) item[field] = (item[field] + value).slice(0, field === 'description' ? 1200 : 200); };
  parser.on('text', text); parser.on('cdata', text);
  parser.on('closetag', tag => {
    depth--;
    if (tag.name === 'programme' && item) {
      if (item.title.trim()) {
        const list = guide.get(item.channel) || [];
        list.push(item); list.sort((a, b) => a.start - b.start);
        guide.set(item.channel, list.slice(0, 16));
      }
      item = null;
    }
    field = '';
  });
  // saxes does not resolve external entities. Reject internal declarations as well.
  parser.on('doctype', value => { if (value.includes('[')) throw new Error('Internal DTD not supported'); });
  for await (const chunk of source) {
    bytes += chunk.length;
    if (bytes > 128 * 1024 * 1024) throw new Error('Guide size limit');
    parser.write(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
  }
  parser.write(decoder.decode()).close();
  if (!tv) throw new Error('Not an XMLTV guide');
  return guide;
}

async function guideResponse(response, url, ids) {
  let source = Readable.fromWeb(response.body);
  // Fetch already decompresses Content-Encoding. Some providers instead serve .xml.gz files.
  if (!response.headers.has('content-encoding') && (/\.gz(?:\?|$)/i.test(url) || /(?:x-)?gzip/.test(response.headers.get('content-type') || ''))) {
    const unzip = createGunzip(); source.on('error', error => unzip.destroy(error)); source.pipe(unzip); source = unzip;
  }
  return parseGuide(source, ids);
}

module.exports = { xmltvTime, parseGuide, guideResponse };
