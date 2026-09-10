const root = document.getElementById('fieldscreen-concept'), api = root.fieldscreenConcept;
const modules = new Map(); let active = 'nfl', preference = 'nfl';
try { preference = localStorage.getItem('fieldscreen-sport') || 'nfl'; } catch {}
const picker = document.createElement('select');
picker.id = 'fs-sport-select'; picker.setAttribute('aria-label','Choose sport'); picker.innerHTML = '<option value="nfl">NFL</option><option value="mlb">MLB</option>';
root.querySelector('.ez-tv-switch').prepend(picker);
function switchSport(league) {
  if (!modules.has(league)) return;
  root.fieldscreenPanes?.exit(); active = league; picker.value = league;
  try { localStorage.setItem('fieldscreen-sport',league); } catch {}
  root.classList.toggle('fs-mlb-active',league === 'mlb');
  modules.get(league).activate?.(); api.render();
}
root.fieldscreenSports = {
  register(league,module) { modules.set(league,module); if (league === preference) switchSport(league); },
  active: () => active, switchSport,
  game: (league,id) => modules.get(league)?.game(id),
  render: () => modules.get(active)?.render() || false,
  afterRender: () => modules.get(active)?.afterRender?.(),
  sourceOptions(source) { const selected = ['dashboard','standings'].includes(source) ? active+':'+source : source; return (root.fieldscreenIptv?.sourceOptions(source) || '') + [...modules.values()].map(m => m.sourceOptions(selected,false)).join(''); },
  feed(slot,html) { const source = String(api.state.slots[slot]); const league = source.startsWith('mlb:') ? 'mlb' : source.startsWith('game:') || source.startsWith('nfl:') ? 'nfl' : active; return modules.get(league)?.feed(slot,html); },
  coverage: channels => [...modules.values()].flatMap(m => m.coverage(channels)),
  matchBroadcasts: (game,channels) => modules.get(game.league || 'nfl')?.matchBroadcasts(game,channels) || [],
  statusText: () => modules.get(active)?.statusText() || 'Loading sports…',
};
picker.addEventListener('change',()=>switchSport(picker.value));
