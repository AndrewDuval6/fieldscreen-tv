import { matchBroadcasts } from './broadcast-core.mjs';
export { matchBroadcasts, liveBroadcast } from './broadcast-core.mjs';
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

export function gameCoverage(games, channels, now = Date.now()) {
  return games.filter(game => !game.complete && (game.live || Date.parse(game.date) >= now && Date.parse(game.date) < now + 48 * 3600000)).sort((a,b) => gamePriority(b, now) - gamePriority(a, now)).map(game => {
    const matches = matchBroadcasts(game, channels, now);
    const ready = matches.find(channel => channel.matchScore === 100 && channel.matchedProgram?.start <= now && channel.matchedProgram?.end > now);
    return { game, matches, ready };
  });
}
