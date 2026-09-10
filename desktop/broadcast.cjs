// Sample actual media, not server ping. Every read is bounded and cancelled.
async function probeMedia(url, upstream, signal, depth = 0) {
  const { response, url: finalURL } = await upstream(url, { signal, timeout: 1200 });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty stream');
  const chunks = []; let length = 0;
  try {
    const first = await reader.read();
    if (first.done || !first.value?.length) throw new Error('Empty stream');
    chunks.push(first.value); length += first.value.length;
    const type = response.headers.get('content-type') || '';
    const head = Buffer.from(first.value).toString('utf8', 0, 64).trimStart();
    if (/mpegurl/i.test(type) || head.startsWith('#EXTM3U')) {
      while (length < 128 * 1024) {
        const next = await reader.read(); if (next.done) break;
        chunks.push(next.value); length += next.value.length;
      }
      const manifest = Buffer.concat(chunks).toString('utf8');
      if (!manifest.trimStart().startsWith('#EXTM3U') || depth >= 2) throw new Error('Invalid playlist');
      const links = manifest.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      const link = /#EXT-X-STREAM-INF/.test(manifest) ? links[0] : links.at(-1);
      if (!link) throw new Error('No media listed');
      await reader.cancel();
      return probeMedia(new URL(link, finalURL).href, upstream, signal, depth + 1);
    }
    const bytes = Buffer.from(first.value);
    if (/^text\/|html|json|xml/i.test(type) || head.startsWith('<')) throw new Error('Not media');
    const media = /^video\//i.test(type) || /mp2t/i.test(type) || bytes[0] === 0x47 || /ftyp|styp|moof/.test(bytes.toString('ascii', 4, 8));
    if (!media) throw new Error('Unrecognized stream');
  } finally { await reader.cancel().catch(() => {}); }
}

async function chooseBroadcast(candidates, { upstream, cache, signal, budget = 2500, canProbe = true } = {}) {
  if (candidates.length < 2 || !canProbe) return { channelId: candidates[0]?.id || null, checked: 0, verified: false };
  const deadline = AbortSignal.any([AbortSignal.timeout(budget), ...(signal ? [signal] : [])]);
  const results = [];
  // One short-lived request at a time avoids consuming several provider slots.
  for (const candidate of candidates.slice(0, 8)) {
    if (deadline.aborted) break;
    const previous = cache?.get(candidate.id);
    if (previous && Date.now() - previous.at < (previous.ok ? 120000 : 20000)) { results.push({ ...previous, id: candidate.id }); continue; }
    const started = performance.now(); let ok = false;
    try { await probeMedia(candidate.url, upstream, deadline); ok = true; } catch { /* A failed feed must not prevent other candidates. */ }
    const result = { id: candidate.id, ok, ms: Math.round(performance.now() - started), at: Date.now() };
    if (!deadline.aborted) cache?.set(candidate.id, result);
    results.push(result);
  }
  const healthy = results.filter(result => result.ok);
  // Tiny timing differences are noise; retain broadcast priority in that band.
  const fastest = Math.min(...healthy.map(result => result.ms));
  const best = healthy.find(result => result.ms <= fastest + 80);
  return { channelId: best?.id || candidates.find(c => !results.some(r => r.id === c.id && !r.ok))?.id || candidates[0]?.id || null, checked: results.length, verified: Boolean(healthy.length) };
}
module.exports = { chooseBroadcast, probeMedia };
