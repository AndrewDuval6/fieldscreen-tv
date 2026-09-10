export const FAVORITES_KEY = 'fieldscreen-favorite-teams-v1';
export const teamKey = (league, team) => `${league}:${team.id}`;

export function normalizeFavorites(value) {
  if (!Array.isArray(value) || value.length > 256) throw Error('Choose a valid list of teams.');
  if (value.some(key => typeof key !== 'string' || !/^[a-z][a-z0-9-]{1,15}:\d{1,12}$/.test(key))) throw Error('Choose a valid team.');
  return [...new Set(value)].sort();
}

export function favoriteGames(games, favorites) {
  const keys = new Set(favorites), unique = new Map();
  for (const game of games) {
    const league = game.league;
    if (!league || !game.id || !game.home || !game.away) continue;
    if (keys.has(teamKey(league, game.home)) || keys.has(teamKey(league, game.away))) unique.set(`${league}:${game.id}`, game);
  }
  const rank = g => g.live ? 0 : g.complete ? 2 : 1;
  return [...unique.values()].sort((a, b) => rank(a) - rank(b) || (a.complete ? Date.parse(b.date) - Date.parse(a.date) : Date.parse(a.date) - Date.parse(b.date)) || `${a.league}:${a.id}`.localeCompare(`${b.league}:${b.id}`));
}

export function createFavoriteStore(storage) {
  return {
    async read() {
      const raw = storage.getItem(FAVORITES_KEY);
      return raw == null ? [] : normalizeFavorites(JSON.parse(raw));
    },
    async write(keys) {
      const normalized = normalizeFavorites(keys), raw = JSON.stringify(normalized);
      storage.setItem(FAVORITES_KEY, raw);
      if (storage.getItem(FAVORITES_KEY) !== raw) throw Error('Storage verification failed.');
      return normalized;
    },
  };
}
