export { matchBroadcasts, liveBroadcast } from './broadcast-core.mjs';
import { matchBroadcasts } from './broadcast-core.mjs';
export function gamePriority(game, now = Date.now()) {
  if (game.live) return 1000 + (game.inning >= 7 && Math.abs((game.home.score ?? 0)-(game.away.score ?? 0)) <= 2 ? 150 : 0) + (game.bases?.every(Boolean) ? 60 : 0) + (game.inning || 0);
  if (game.state === 'pre') return 500 - Math.min(400,Math.max(0,(Date.parse(game.date)-now)/3600000));
  return game.complete ? 10 : 20;
}
export function gameLabel(game) {
  if (game.live && game.inning) return `${game.half || 'Inning'} ${game.inning}`;
  return game.status;
}
export function gameCoverage(games,channels,now=Date.now()) {
  return games.filter(g => !g.complete && (g.live || Date.parse(g.date) >= now && Date.parse(g.date) < now+48*3600000)).sort((a,b)=>gamePriority(b,now)-gamePriority(a,now)).map(game => { const matches = matchBroadcasts(game,channels,now); return { game,matches,ready: game.live && matches.find(c=>c.matchScore===100 && c.matchedProgram?.start<=now && c.matchedProgram?.end>now) }; });
}

// Scoreboard data can still be loading when a remembered MLB view opens.
export function resolveSelectedGame(games, selected, detail) {
  const base = games.find(game => game.id === selected);
  if (!base || detail?.game?.id !== base.id) return base;
  return {...base, ...detail.game, network: base.network, series: base.series,
    seriesStatus: base.seriesStatus, doubleHeader: base.doubleHeader, gameNumber: base.gameNumber};
}
