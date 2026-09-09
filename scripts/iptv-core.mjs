export const footballPattern = /\b(nfl|red\s?zone|sunday ticket|american football|cardinals|falcons|ravens|bills|panthers|bears|bengals|browns|cowboys|broncos|lions|packers|texans|colts|jaguars|chiefs|raiders|chargers|rams|dolphins|vikings|patriots|saints|giants|jets|eagles|steelers|49ers|seahawks|buccaneers|titans|commanders)\b/i;
export function currentProgram(channel, now = Date.now()) {
  return channel.programs?.find(p => p.start <= now && p.end > now) || null;
}
export function nextProgram(channel, now = Date.now()) {
  return channel.programs?.find(p => p.start > now) || null;
}
export function filterChannels(channels, { query = '', group = '', filter = 'all', now = Date.now() } = {}) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return channels.filter(channel => {
    if (group && channel.group !== group) return false;
    const programs = (channel.programs || []).filter(p => p.end > now);
    const text = [channel.name, channel.group, ...programs.map(p => `${p.title} ${p.description} ${p.category}`)].join(' ');
    if (!terms.every(term => text.toLocaleLowerCase().includes(term))) return false;
    if (filter === 'football' && !footballPattern.test(text)) return false;
    if (filter === 'redzone' && !/red\s?zone/i.test(text)) return false;
    if (filter === 'now' && !currentProgram(channel, now)) return false;
    return true;
  });
}

// Reuse players across pane moves; remove feeds that leave the visible layout.
export function reconcilePlayers(previous, desired, create, destroy) {
  const unused = new Set(previous), result = [];
  for (const slot of desired) {
    const existing = [...unused].find(player => player.channel.id === slot.channel.id);
    const player = existing || create(slot.channel);
    unused.delete(player); player.slot = slot.slot; result.push(player);
  }
  for (const player of unused) destroy(player);
  return result;
}
