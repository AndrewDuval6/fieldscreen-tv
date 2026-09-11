import { matchMmaBroadcasts } from './mma-core.mjs';
export function matchBroadcasts(game, channels, now = Date.now()) {
  if (game.league === 'mma') return matchMmaBroadcasts(game, channels, now);
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const contains = (haystack, name) => (' ' + normalize(haystack) + ' ').includes(' ' + normalize(name) + ' ');
  const names = t => [t.name, t.fullName, ...(String(t.abbr || '').length >= 3 ? [t.abbr] : [])].filter(Boolean);
  const kickoff = Date.parse(game.date);
  const league = game.league || 'nfl';
  const wrongSport = value => league === 'mlb' ? /\bnfl\b|american football/i.test(value) : /\bmlb\b|baseball/i.test(value);
  const teamGroup = value => league === 'mlb' ? /\bmlb\b|baseball/i.test(value) : /\bnfl\b|american football/i.test(value);
  return channels.map(channel => {
    if (wrongSport(channel.name + ' ' + channel.group)) return { ...channel, matchScore: 0 };
    let score = 0, matchedProgram = null, confidence = '';
    for (const program of channel.programs || []) {
      const listedGame = String(program.title || '').match(/\bgame\s*([12])\b/i);
      if (game.doubleHeader && listedGame && Number(listedGame[1]) !== game.gameNumber) continue;
      if (wrongSport(program.title) || program.end <= now || !Number.isFinite(kickoff) || program.start > kickoff + 90 * 60000 || program.end <= kickoff || /\b(replay|classic|highlights|review|encore)\b/i.test(program.title)) continue;
      const text = program.title + ' ' + program.description;
      const a = names(game.away).some(name => contains(text, name)), h = names(game.home).some(name => contains(text, name));
      const candidate = a && h ? 100 : a || h ? 40 : 0;
      if (candidate > score) { score = candidate; matchedProgram = program; confidence = candidate === 100 ? 'Matchup in TV guide' : 'Possible match · one team listed'; }
    }
    const a = names(game.away).some(name => contains(channel.name, name)), h = names(game.home).some(name => contains(channel.name, name));
    if (a && h && score < 60) { score = 60; confidence = 'Matchup in channel name · verify listing'; }
    // When XMLTV is missing, the schedule's network is a useful lead, not
    // proof of the game. Do not confuse ESPN2/ESPNews or Fox Sports with FOX.
    const onNow = (channel.programs || []).find(p => p.start <= now && p.end > now);
    const conflicting = game.live && onNow && !matchedProgram;
    const network = String(game.network || '').split(/\s+(?:and|or)\s+|[,/]/i).map(normalize).filter(Boolean);
    const channelName = normalize(channel.name).replace(/\b(hd|fhd|uhd|4k|us|usa)\b/g, '').trim();
    const epg = normalize(String(channel.epgId || '').split('.')[0]);
    if (!game.complete && !conflicting && score < 25 && network.some(n => n === channelName || n === epg)) { score = 25; confidence = 'Scheduled network · guide confirmation unavailable'; }
    if (!game.complete && !conflicting && score < 20 && (a || h) && teamGroup(channel.group || '')) { score = 20; confidence = 'Team channel · verify listing'; }
    return { ...channel, matchScore: score, matchedProgram, confidence, networkMatch: network.some(n => n === channelName || n === epg) };
  }).filter(c => c.matchScore > 0).sort((a, b) => b.matchScore - a.matchScore || Number(b.networkMatch) - Number(a.networkMatch) || a.name.localeCompare(b.name));
}

export function liveBroadcast(game, channels, now = Date.now()) {
  if (!game.live || game.complete) return null;
  return matchBroadcasts(game, channels, now).find(channel => channel.matchScore === 100 && channel.matchedProgram?.start <= now && channel.matchedProgram?.end > now) || null;
}
