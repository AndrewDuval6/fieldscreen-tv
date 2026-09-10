export function gamePriority(game, now = Date.now()) {
  if (game.live) return 1000 + (game.redZone ? 100 : 0) + ((game.period || 0) >= 4 && Math.abs((game.home.score ?? 0) - (game.away.score ?? 0)) <= 8 ? 80 : 0) + (game.period || 0);
  if (game.state === 'pre') return 500 - Math.min(400, Math.max(0, (Date.parse(game.date) - now) / 3600000));
  return game.complete ? 10 : 20;
}
export function fieldPosition(game) {
  if (!game.live || !game.possession) return null;
  const possessing = game.possession === game.home.id ? game.home : game.possession === game.away.id ? game.away : null;
  if (!possessing) return null;
  if (Number.isFinite(game.position)) return Math.max(0, Math.min(100, game.position));
  const match = String(game.possessionText || '').match(/^([A-Z]{2,4})\s+(\d{1,2})$/i);
  if (!match) return null;
  if (Number(match[2]) > 50) return null;
  const names = { LA: 'LAR', WSH: 'WAS', JAC: 'JAX' }, side = names[match[1]] || match[1];
  if (![game.home.abbr, game.away.abbr].includes(side)) return null;
  return side === possessing.abbr ? Number(match[2]) : 100 - Number(match[2]);
}
export function matchBroadcasts(game, channels, now = Date.now()) {
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const contains = (haystack, name) => (' ' + normalize(haystack) + ' ').includes(' ' + normalize(name) + ' ');
  const names = t => [t.name, t.fullName].filter(Boolean);
  const kickoff = Date.parse(game.date);
  return channels.map(channel => {
    let score = 0, matchedProgram = null, confidence = '';
    for (const program of channel.programs || []) {
      if (program.end < now || !Number.isFinite(kickoff) || program.start > kickoff + 6 * 3600000 || program.end < kickoff - 30 * 60000) continue;
      const text = program.title + ' ' + program.description;
      const a = names(game.away).some(name => contains(text, name)), h = names(game.home).some(name => contains(text, name));
      const candidate = a && h ? 100 : a || h ? 40 : 0;
      if (candidate > score) { score = candidate; matchedProgram = program; confidence = candidate === 100 ? 'Matchup in TV guide' : 'Possible match · one team listed'; }
    }
    const a = names(game.away).some(name => contains(channel.name, name)), h = names(game.home).some(name => contains(channel.name, name));
    if (a && h && score < 60) { score = 60; confidence = 'Matchup in channel name · verify listing'; }
    return { ...channel, matchScore: score, matchedProgram, confidence };
  }).filter(c => c.matchScore > 0).sort((a, b) => b.matchScore - a.matchScore || a.name.localeCompare(b.name));
}
