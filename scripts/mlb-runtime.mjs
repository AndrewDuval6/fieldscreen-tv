import { gamePriority, gameLabel, gameCoverage, matchBroadcasts, liveBroadcast } from './mlb-core.mjs';

const root = document.getElementById('fieldscreen-concept'), api = root.fieldscreenConcept;
const q = s => root.querySelector(s), esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dash = v => v === null || v === undefined || v === '' ? '—' : v;
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateLabel = d => new Date(d+'T12:00:00').toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
const time = g => g.timeTBD ? dateLabel(g.officialDate || g.date.slice(0,10))+' · Time TBD' : new Date(g.date).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const label = g => g.state === 'pre' ? time(g) : gameLabel(g);
const button = (label,attrs='') => `<button class="ez-button" ${attrs}>${label}</button>`;
const record = g => g.complete || g.timeTBD || g.home.placeholder || g.away.placeholder ? '' : button('● Record game',`data-record-game="mlb:${g.id}"`);
const watch = (g,slot) => button(g.complete ? 'Final' : 'Watch game ↗',`data-mlb-watch="${g.id}" ${slot === undefined ? '' : `data-watch-slot="${slot}"`} ${g.complete || g.away.placeholder || g.home.placeholder ? 'disabled' : ''}`) + record(g);
const state = { panel:'gameday',board:null,post:null,standings:null,teams:[],team:'147',teamData:null,detail:null,selected:null,date:null,season:new Date().getFullYear(),league:'AL',race:false,auto:true,page:0,stage:'all',loading:true,errors:{},busy:new Map() };
const generations = new Map();
const active = () => root.fieldscreenSports.active() === 'mlb';
const games = () => [...new Map([...(state.board?.games || []),...(state.post?.games || [])].map(g=>[g.id,g])).values()];
function current() { const base = games().find(g=>g.id===state.selected); return state.detail?.game.id === base?.id ? {...base,...state.detail.game,network:base.network,series:base.series,seriesStatus:base.seriesStatus,doubleHeader:base.doubleHeader,gameNumber:base.gameNumber} : base; }
const fresh = data => data?.meta ? `${data.meta.stale ? 'CACHED · ' : ''}${data.meta.source || 'MLB'} · ${new Date(data.meta.updatedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})}` : 'Connecting to MLB…';
function blank(message,loading=false) { return `<div class="fs-nfl-empty fs-mlb-empty"><div class="fs-mlb-loader ${loading?'is-loading':''}"><span></span><span></span><span></span><span></span></div><strong>${loading?'CONNECTING THE BALLPARK':'BASEBALL'}</strong><p>${esc(message)}</p>${loading?'':button('Refresh','data-mlb-refresh')}</div>`; }
async function load(key,route) {
  if (state.busy.get(key) === route) return;
  const generation = (generations.get(key)||0)+1; generations.set(key,generation); state.busy.set(key,route);
  try {
    const response = await fetch('./mlb/'+route,{headers:{'X-FieldScreen':'1'},cache:'no-store',credentials:'omit'}); const data = await response.json();
    if (!response.ok) throw Error(data.error || 'MLB data is unavailable.');
    if (generations.get(key) !== generation) return;
    state[key] = data; state.errors[key] = '';
    if (key === 'board') {
      state.loading = false;
      if (!state.selected || state.auto && state.panel !== 'game') state.selected = [...data.games].sort((a,b)=>gamePriority(b)-gamePriority(a))[0]?.id;
      else if (state.panel !== 'game' && !data.games.some(g=>g.id===state.selected)) state.selected = data.games[0]?.id;
    }
  } catch (e) { if (generations.get(key) === generation) { state.errors[key] = e.message; if (state[key]?.meta) state[key].meta.stale = true; if (key==='board') state.loading=false; } }
  finally { if (generations.get(key) === generation) { state.busy.delete(key); if (active() || api.state.view==='watch') api.render(); } }
}
function refresh() { void load('board','scoreboard'+(state.date?'?date='+state.date:'')); }
function loadDetail() { if (state.selected) void load('detail','game?id='+state.selected); }
function loadStandings() { void load('standings','standings?season='+state.season); }
function loadPost() { void load('post','postseason?season='+state.season); }
function loadTeam() { void load('teamData',`team?id=${state.team}&season=${state.season}`); }
function ensureTeams() { if (!state.teams.length && !state.busy.has('teamList')) void load('teamList','teams?season='+state.season).then(()=>{state.teams=state.teamList?.teams || []; if(active() && state.panel==='teams') api.render();}); }
function navigate(panel) {
  state.panel=panel; api.state.view=panel==='game'?'gameday':panel; api.render();
  if(panel==='game') loadDetail(); if(panel==='standings') loadStandings(); if(panel==='postseason') loadPost(); if(panel==='teams'){ensureTeams();loadTeam();}
}
function scoreboard(g) { return `<div class="fs-nfl-matchup"><div style="--club:${g.away.color}"><b>${esc(g.away.abbr)}</b><span>${esc(g.away.name)}</span></div><strong>${esc(dash(g.away.score))}<i>:</i>${esc(dash(g.home.score))}</strong><div style="--club:${g.home.color}"><b>${esc(g.home.abbr)}</b><span>${esc(g.home.name)}</span></div></div>`; }
function diamond(g,key) {
  const id = 'diamond-'+key.replace(/[^a-z0-9-]/gi,''), occupied = g.bases || [];
  const coords=[[398,230],[300,142],[202,230]];
  const baseNames=['First','Second','Third'];
  return `<svg class="fs-diamond" viewBox="0 0 600 370" role="img" aria-label="${esc(g.home.fullName)} diamond. ${esc(g.live ? gameLabel(g)+'. '+baseNames.map((n,i)=>n+' base '+(occupied[i]===null?'unavailable':occupied[i]?'occupied':'empty')).join('. ') : g.status)}">
    <defs><radialGradient id="${id}-light"><stop stop-color="#467d43"/><stop offset="1" stop-color="#102c28"/></radialGradient><pattern id="${id}-mow" width="48" height="48" patternTransform="rotate(38)" patternUnits="userSpaceOnUse"><rect width="24" height="48" fill="#b0ea850b"/></pattern><clipPath id="${id}-clip"><path d="M300 338L65 101Q300 -67 535 101Z"/></clipPath></defs>
    <path d="M300 349L37 99Q300 -95 563 99Z" fill="#091e20" stroke="#6c969033" stroke-width="14"/>
    <path d="M300 340L57 101Q300 -80 543 101Z" fill="#887151" stroke="#cdbb8022" stroke-width="5"/>
    <path d="M300 338L65 101Q300 -67 535 101Z" fill="url(#${id}-light)"/>
    <rect width="600" height="370" fill="url(#${id}-mow)" clip-path="url(#${id}-clip)"/>
    <path d="M300 331L185 229Q180 176 225 139Q300 105 375 139Q420 176 415 229Z" fill="#99724d" stroke="#d7b67b55" stroke-width="2"/>
    <path d="M300 318L208 229L300 148L392 229Z" fill="#3f6d3c"/>
    <path d="M66 100L300 327L534 100M202 230L300 142L398 230" fill="none" stroke="#e9ecd9a6" stroke-width="2"/>
    <ellipse cx="300" cy="230" rx="21" ry="15" fill="#b58b5b"/><path d="M293 229H307" stroke="#f4edcf" stroke-width="4"/>
    <circle cx="300" cy="326" r="20" fill="#b58b5b"/><path d="M293 320H307V330L300 336L293 330Z" fill="#fbf9e9"/>
    <path d="M278 313V334H287V313ZM313 313V334H322V313Z" fill="none" stroke="#f0efceaa"/>
    ${coords.map(([x,y],i)=>`<g><rect x="${x-8}" y="${y-8}" width="16" height="16" rx="1" transform="rotate(45 ${x} ${y})" fill="${occupied[i]?'#d6ff67':'#ecf2da'}" stroke="${occupied[i]?'#f2ffb9':'#bccbb5'}" stroke-width="${occupied[i]?5:1}"/>${occupied[i]?`<circle cx="${x}" cy="${y}" r="23" fill="none" stroke="#d6ff6788" stroke-width="2"/><text x="${i===0?x+32:i===2?x-32:x}" y="${i===1?y-30:y+5}" text-anchor="${i===0?'start':i===2?'end':'middle'}" fill="#eafaab" font-size="15">${esc((g.runners[i]||'Runner').split(' ').at(-1))}</text>`:''}</g>`).join('')}
    <text x="300" y="67" text-anchor="middle" fill="#c9e2bd99" font-size="18" letter-spacing="7">${esc(g.home.abbr)}</text>
    <text x="100" y="145" fill="#dbe4c677" font-size="13">LF</text><text x="481" y="145" fill="#dbe4c677" font-size="13">RF</text>
    <text x="40" y="338" fill="#b5cec0" font-size="16">${esc(g.live ? gameLabel(g).toUpperCase() : g.complete?'FINAL':'FIRST PITCH')}</text><text x="557" y="338" text-anchor="end" fill="#dff2b9" font-size="17">${g.live?`${dash(g.balls)}–${dash(g.strikes)} · ${dash(g.outs)} OUT`:''}</text>
  </svg>`;
}
function lineTable(g) {
  const n=Math.max(9,g.away.innings?.length||0,g.home.innings?.length||0);
  return `<div class="fs-linescore"><table><thead><tr><th>TEAM</th>${Array.from({length:n},(_,i)=>`<th>${i+1}</th>`).join('')}<th>R</th><th>H</th><th>E</th></tr></thead><tbody>${[g.away,g.home].map(t=>`<tr><th>${esc(t.abbr)}</th>${Array.from({length:n},(_,i)=>`<td>${esc(dash(t.innings?.[i]))}</td>`).join('')}<th>${esc(dash(t.score))}</th><td>${esc(dash(t.hits))}</td><td>${esc(dash(t.errors))}</td></tr>`).join('')}</tbody></table></div>`;
}
function header() {
  q('.ez-brand-sub').textContent='SPORTS CONTROL ROOM'; q('.ez-dir-name>b').textContent='BALLPARK DIRECTOR';
  root.classList.add('fs-nfl-connected','ez-tv'); api.state.tv=true;
  const panel=state.panel==='game'?'gameday':state.panel;
  root.querySelectorAll('[data-tv-view],[data-nfl-view],[data-mlb-view]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.tvView||b.dataset.nflView||b.dataset.mlbView)===panel)));
  q('#ez-title').textContent='MLB / '+state.panel.toUpperCase(); q('#ez-view-label').textContent=fresh(state.board); q('#ez-output-state').textContent=fresh(state.board);
  q('#ez-status').textContent=state.errors.board || state.board?.meta.warning || 'MLB DATA · YOUR TV GUIDE · YOUR CHANNELS'; q('#ez-status').classList.toggle('fs-data-warning',Boolean(state.errors.board || state.board?.meta.stale)); q('.ez-heading-controls').hidden=true;
}
function director() {
  const g=current(), surface=q('#ez-director-surface'); surface.hidden=!g; root.classList.toggle('ez-director',Boolean(g));
  if(!g){q('#ez-body').innerHTML=blank(state.errors.board || (state.loading?'Loading today’s games and ballparks.':'No games scheduled for this date. Open Schedule to choose another day.'),state.loading);return;}
  q('#ez-body').innerHTML='';surface.setAttribute('aria-label','Baseball game day director');
  q('#ez-dir-mode').textContent=state.auto?'AUTO FOCUS':'PINNED BY YOU';q('#ez-dir-auto').textContent=state.auto?'Auto focus on':'Resume auto focus';q('#ez-dir-auto').setAttribute('aria-pressed',String(state.auto));
  q('#ez-dir-play').innerHTML='<span>Refresh scores</span>';q('#ez-dir-matchup').innerHTML=scoreboard(g);q('#ez-dir-channel').textContent=`${g.away.abbr} @ ${g.home.abbr} · ${g.venue}`;
  q('.ez-dir-bug').textContent=state.board?.meta.stale?'CACHED':'MLB';q('#ez-dir-kind').textContent=g.live?'LIVE BASEBALL':g.complete?'FINAL':'UPCOMING';q('#ez-dir-clock').textContent=label(g);
  q('#ez-dir-pitch').innerHTML=diamond(g,'main');q('#ez-dir-down').textContent=g.live?`COUNT ${dash(g.balls)}–${dash(g.strikes)} · ${dash(g.outs)} OUT`:g.status;
  q('#ez-dir-yard').textContent=g.live?g.batter?`AT BAT · ${g.batter}`:'Between innings':g.venue;
  q('#ez-dir-event-label').textContent=g.live?'ON THE MOUND':g.complete?'FINAL RESULT':'BROADCAST';q('#ez-dir-event-text').textContent=g.live?g.pitcher || 'Waiting for the next pitcher update':g.complete?`${g.away.fullName} ${g.away.score}, ${g.home.fullName} ${g.home.score}`:g.network || 'Broadcast to be announced';
  q('#ez-dir-pin').setAttribute('aria-pressed',String(!state.auto));q('#ez-dir-pin span').textContent=state.auto?'Pin game':'Unpin';q('#ez-dir-count').textContent=(state.board?.games.length||0)+' GAMES';
  const ranked=[...(state.board?.games||[])].sort((a,b)=>gamePriority(b)-gamePriority(a));
  q('#ez-dir-queue').innerHTML=ranked.filter(x=>x.id!==g.id).slice(0,3).map(x=>`<button class="ez-dir-cue" data-mlb-game="${x.id}"><span class="ez-dir-cue-kind">${esc(gameLabel(x))}</span><span class="ez-dir-cue-score"><span>${esc(x.away.abbr)} @ ${esc(x.home.abbr)}</span><strong>${esc(dash(x.away.score))}–${esc(dash(x.home.score))}</strong></span><span class="ez-dir-cue-clock">${esc(x.state==='pre'?time(x):x.venue)}</span></button>`).join('');
  q('#ez-dir-reason-title').textContent=state.auto?'On the main screen':'You have control';q('#ez-dir-reason').textContent=state.auto?'Live games lead. Close late innings and bases-loaded situations move to the front.':'This game stays selected while the rest of the league updates.';
  q('#ez-dir-moments').setAttribute('aria-label','Selected baseball game actions');q('#ez-dir-moments').innerHTML=watch(g)+button('Game details',`data-mlb-detail="${g.id}"`)+button('Postseason','data-mlb-view="postseason"');q('.ez-dir-timeline>span').textContent='BASEBALL';
  const pages=Math.max(1,Math.ceil(ranked.length/6));state.page%=pages;
  q('#ez-dir-step').innerHTML=`<span>${esc(dateLabel(state.date||today()))}</span><button data-mlb-page="-1" aria-label="Previous baseball games">←</button>${state.page+1}/${pages}<button data-mlb-page="1" aria-label="Next baseball games">→</button>`;
  q('#ez-dir-fields').setAttribute('aria-label','All baseball games');
  q('#ez-dir-fields').innerHTML=ranked.slice(state.page*6,state.page*6+6).map(x=>`<button class="ez-dir-mini" data-mlb-game="${x.id}" aria-pressed="${x.id===state.selected}"><div class="ez-dir-mini-head"><span>${esc(x.away.abbr)} · ${esc(x.home.abbr)}</span><b>${esc(dash(x.away.score))} : ${esc(dash(x.home.score))}</b></div><div class="ez-dir-mini-field">${diamond(x,'mini-'+x.id)}</div><div class="ez-dir-mini-foot"><span>${esc(label(x))}</span><span>${x.live?'LIVE':''}</span></div></button>`).join('');
  q('#ez-dir-foot-state').textContent=fresh(state.board)+' · Updates every 30 seconds';q('#ez-dir-detail').textContent='Open selected game ↗';
}
function card(g) { return `<article class="fs-schedule-game"><div class="fs-game-kicker"><span>${esc(gameLabel(g))}${g.doubleHeader?' · GAME '+g.gameNumber:''}</span><span>${g.ifNecessary?'IF NECESSARY':''}</span></div>${scoreboard(g)}<p>${esc(time(g))}</p><small>${esc(g.venue)}</small><p class="fs-mlb-network">${esc(g.network || (g.away.placeholder || g.home.placeholder?'Matchup to be determined':'Broadcast to be announced'))}</p><div>${button('Game details',`data-mlb-detail="${g.id}"`)}${watch(g)}</div></article>`; }
function seasonPicker() { return `<label>Season <select id="fs-mlb-season">${Array.from({length:7},(_,i)=>new Date().getFullYear()+1-i).map(y=>`<option ${y===state.season?'selected':''}>${y}</option>`).join('')}</select></label>`; }
function schedule() { return `<div class="fs-nfl-controls"><h2>THE DAILY SLATE</h2>${button('←','data-mlb-day="-1" aria-label="Previous day"')}<label>Date <input id="fs-mlb-date" type="date" value="${state.date||today()}"></label>${button('→','data-mlb-day="1" aria-label="Next day"')}${button('Today','data-mlb-today')}${button('Refresh','data-mlb-refresh')}</div><div class="fs-nfl-scroll fs-schedule-grid">${state.loading?blank('Loading games…',true):state.board?.games.length?state.board.games.map(card).join(''):blank(state.errors.board||'No games scheduled for this date.')}</div>`; }
function standings() {
  const divisions=state.standings?.divisions.filter(d=>d.league===state.league)||[];
  const entries=divisions.flatMap(d=>d.entries).filter(e=>!e.leader).sort((a,b)=>(a.wcRank||99)-(b.wcRank||99));
  const table=(entries,race=false)=>`<table><thead><tr><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>${race?'WC GB':'GB'}</th><th>DIFF</th><th>L10</th></tr></thead><tbody>${entries.map(e=>`<tr><td><button data-mlb-team="${e.team.id}">${esc(e.team.fullName)}${e.clinched?' ✓':''}</button>${race&&e.eliminated?'<small> Eliminated</small>':''}</td>${[e.wins,e.losses,e.pct,race?e.wcgb:e.gb,e.differential,e.lastTen].map(v=>`<td>${esc(dash(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<div class="fs-nfl-controls"><h2>${state.race?'WILD CARD RACE':'STANDINGS'}</h2>${seasonPicker()}${['AL','NL'].map(l=>button(l,`data-mlb-league="${l}" aria-pressed="${l===state.league}"`)).join('')}${button(state.race?'Divisions':'Wild card',`data-mlb-race`)}<span>${esc(state.errors.standings||fresh(state.standings))}</span></div><div class="fs-nfl-scroll ${state.race?'':'fs-standings-grid'}">${state.standings?.divisions.length?state.race?`<section class="fs-nfl-card"><h3>${state.league} WILD CARD · DIVISION LEADERS EXCLUDED</h3>${table(entries,true)}<p class="fs-nfl-muted">Standings as reported by MLB. ✓ Clinched a postseason berth. Games back can include a lead over the cutoff.</p></section>`:divisions.map(d=>`<section class="fs-nfl-card"><h3>${esc(d.name)}</h3>${table(d.entries)}<p class="fs-nfl-muted">✓ Clinched a postseason berth</p></section>`).join(''):blank(state.errors.standings||(state.standings?'Standings have not been published for this season.':'Loading the pennant races…'),!state.errors.standings&&!state.standings)}</div>`;
}
function postseason() {
  const stages=[['all','All rounds'],['F','Wild card'],['D','Division'],['L','Championship'],['W','World Series']];
  const gs=(state.post?.games||[]).filter(g=>state.stage==='all'||g.gameType===state.stage), groups=new Map();
  gs.forEach(g=>{const key=g.gameType+':'+[g.away.id,g.home.id].sort().join(':');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(g);});
  return `<div class="fs-nfl-controls"><h2>THE POSTSEASON</h2>${seasonPicker()}<span>${esc(state.errors.post||fresh(state.post))}</span></div><div class="fs-stats-tabs">${stages.map(([v,l])=>button(l,`data-mlb-stage="${v}" aria-pressed="${state.stage===v}"`)).join('')}</div><div class="fs-nfl-scroll fs-mlb-series-grid">${state.post?[...groups.values()].map(series=>{const first=series[0],wins=t=>series.filter(g=>g.complete&&(g.away.id===t.id?g.away.score>g.home.score:g.home.score>g.away.score)).length;return `<section class="fs-nfl-card"><h3>${esc(first.series || 'Postseason')}</h3><div class="fs-mlb-series-score"><span>${esc(first.away.fullName)}<b>${first.away.placeholder?'—':wins(first.away)}</b></span><span>${esc(first.home.fullName)}<b>${first.home.placeholder?'—':wins(first.home)}</b></span></div><p class="fs-nfl-muted">${first.away.placeholder||first.home.placeholder?'Teams to be determined':esc(series.find(g=>g.live)?.seriesStatus || series.filter(g=>g.complete).at(-1)?.seriesStatus || first.seriesStatus)}</p>${series.map(g=>`<div class="fs-mlb-series-game"><span>GAME ${g.seriesGame || g.gameNumber || '—'}${g.ifNecessary?' · IF NEEDED':''}<small>${esc(label(g))}</small></span>${g.complete?`<b>${esc(g.away.abbr)} ${g.away.score}–${g.home.score} ${esc(g.home.abbr)}</b>`:g.live?watch(g):button('Details',`data-mlb-detail="${g.id}"`)}</div>`).join('')}</section>`;}).join('')||blank('MLB has not published postseason matchups for this season.'):blank(state.errors.post||'Loading the postseason schedule…',!state.errors.post)}</div>`;
}
const statLabels={avg:'Batting average',obp:'On-base percentage',slg:'Slugging',ops:'OPS',homeRuns:'Home runs',runs:'Runs',hits:'Hits',rbi:'RBI',stolenBases:'Stolen bases',baseOnBalls:'Walks',strikeOuts:'Strikeouts',era:'ERA',whip:'WHIP',inningsPitched:'Innings pitched',wins:'Wins',losses:'Losses',saves:'Saves',strikeoutsPer9Inn:'Strikeouts / 9',fielding:'Fielding percentage',errors:'Errors',assists:'Assists',putOuts:'Putouts',doublePlays:'Double plays',gamesPlayed:'Games'};
const statKeys={hitting:['gamesPlayed','avg','obp','slg','ops','runs','hits','homeRuns','rbi','stolenBases','baseOnBalls','strikeOuts'],pitching:['era','whip','inningsPitched','wins','losses','saves','strikeOuts','baseOnBalls','strikeoutsPer9Inn','homeRuns'],fielding:['fielding','errors','assists','putOuts','doublePlays']};
function teams() { return `<div class="fs-nfl-controls"><h2>TEAM LAB</h2><select id="fs-mlb-team" aria-label="Choose an MLB team">${state.teams.map(t=>`<option value="${t.id}" ${t.id===state.team?'selected':''}>${esc(t.fullName)}</option>`).join('')}</select>${root.fieldscreenFavorites?.teamButton('mlb', state.teams.find(t=>t.id===state.team), true) || ''}${seasonPicker()}</div><div class="fs-nfl-scroll fs-mlb-team-grid">${state.teamData?state.teamData.categories.map(c=>`<section class="fs-nfl-card"><h3>${esc(c.name.toUpperCase())}</h3><table><tbody>${(statKeys[c.name]||[]).map(k=>`<tr><td>${statLabels[k]||k}</td><td>${esc(dash(c.stats[k]))}</td></tr>`).join('')}</tbody></table></section>`).join(''):blank(state.errors.teamData||'Loading team statistics…',!state.errors.teamData)}<p class="fs-nfl-muted">${esc(state.errors.teamData||fresh(state.teamData))}</p></div>`; }
function detail() {
  const g=current(), d=state.detail?.game.id===g?.id?state.detail:null;if(!g)return blank('Choose a game from the schedule.');
  return `<div class="fs-nfl-controls">${button('← Game day','data-mlb-view="gameday"')}<h2>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</h2><span>${esc(state.errors.detail||fresh(d))}</span>${watch(g)}</div><div class="fs-nfl-scroll fs-detail-grid"><section class="fs-nfl-card fs-detail-feature">${scoreboard(g)}<p>${esc(label(g))}</p><div class="fs-mlb-detail-diamond">${diamond(g,'detail')}</div>${lineTable(g)}<p class="fs-nfl-muted">${esc(g.live?`${g.batter || '—'} at bat · ${g.pitcher || '—'} pitching${d?.pitchCount!=null?' · '+d.pitchCount+' pitches':''}`:g.venue)}</p></section><section class="fs-nfl-card"><h3>LATEST AT-BATS</h3>${d?.plays.length?d.plays.map(p=>`<div class="fs-real-play"><span>${esc(p.half)}<b>${p.inning}</b></span><p>${esc(p.text || p.event)}</p><strong>${p.scoring?`${p.awayScore}–${p.homeScore}`:''}</strong></div>`).join(''):`<p class="fs-nfl-muted">${esc(state.errors.detail || (d?'No at-bats reported yet.':'Loading game details…'))}</p>`}</section>${d?.box.map(b=>`<section class="fs-nfl-card"><h3>${esc(b.teamId===g.away.id?g.away.fullName:g.home.fullName)} · BATTING</h3><table><thead><tr><th>Player</th>${['AB','R','H','RBI','BB','SO'].map(k=>`<th>${k}</th>`).join('')}</tr></thead><tbody>${b.players.map(p=>`<tr><td>${esc(p.name)} <small>${esc(p.position)}</small></td>${['atBats','runs','hits','rbi','baseOnBalls','strikeOuts'].map(k=>`<td>${esc(dash(p[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`).join('')||''}</div>`;
}
function render() {
  if(api.state.view==='watch'){state.panel='watch';header();q('#ez-director-surface').hidden=true;root.classList.remove('ez-director');return false;}
  if(state.panel==='watch')state.panel='gameday';
  const focused=document.activeElement, identity=focused?.id?'#'+CSS.escape(focused.id):focused?.dataset.mlbGame?`[data-mlb-game="${focused.dataset.mlbGame}"]`:null, scroll=q('.fs-nfl-scroll')?.scrollTop||0;
  if(state.panel==='gameday')director();else{q('#ez-director-surface').hidden=true;root.classList.remove('ez-director');q('#ez-body').innerHTML=state.panel==='schedule'?schedule():state.panel==='standings'?standings():state.panel==='postseason'?postseason():state.panel==='teams'?teams():detail();}
  if(q('.fs-nfl-scroll'))q('.fs-nfl-scroll').scrollTop=scroll;if(identity&&!focused.isConnected&&q('#fs-iptv-modal').hidden)q(identity)?.focus({preventScroll:true});header();return true;
}
const module = {
  game: id => games().find(g=>g.id===id),
  render,afterRender:header,matchBroadcasts,liveBroadcast,
  activate(){state.panel='gameday';api.state.view='gameday';refresh();},
  coverage:channels=>gameCoverage(games(),channels),statusText:()=>fresh(state.board),
  sourceOptions(source){return `<optgroup label="MLB scorecards">${games().map(g=>`<option value="mlb:game:${g.id}" ${source==='mlb:game:'+g.id?'selected':''}>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}${g.doubleHeader?' · Game '+g.gameNumber:''}</option>`).join('')}</optgroup><optgroup label="MLB data"><option value="mlb:dashboard" ${source==='mlb:dashboard'?'selected':''}>MLB scoreboard</option><option value="mlb:standings" ${source==='mlb:standings'?'selected':''}>MLB standings</option></optgroup>`;},
  feed(slot,html){const source=String(api.state.slots[slot]);if(source.startsWith('iptv:'))return undefined;const g=games().find(g=>'mlb:game:'+g.id===source);let body;
    if(g)body=`<div class="fs-watch-scorecard fs-mlb-scorecard">${scoreboard(g)}<span>${esc(label(g))}</span><div>${diamond(g,'watch-'+slot)}</div>${watch(g,slot)}</div>`;
    else if(source.endsWith('standings')){if(!state.standings&&!state.busy.has('standings')&&!state.errors.standings)loadStandings();body=`<div class="fs-watch-data"><h3>MLB STANDINGS</h3>${state.standings?.divisions.map(d=>`<p>${esc(d.name)}</p>${d.entries.map(e=>`<div><span>${esc(e.team.abbr)}</span><b>${e.wins}–${e.losses}</b></div>`).join('')}`).join('')||esc(state.errors.standings||'Loading standings…')}</div>`;}
    else body=`<div class="fs-watch-data"><h3>MLB SCOREBOARD</h3>${state.board?.games.map(g=>`<button ${g.live?'data-mlb-watch':'data-mlb-detail'}="${g.id}" data-watch-slot="${slot}"><span>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}<small>${esc(label(g))}</small></span><b>${esc(dash(g.away.score))} : ${esc(dash(g.home.score))}</b></button>`).join('')||esc(state.errors.board||'Loading baseball…')}</div>`;
    return `<article class="ez-feed fs-nfl-feed" data-slot="${slot}">${html}${body}<div class="ez-feed-foot"><span>${esc(fresh(state.board))}</span><span>MLB DATA</span></div></article>`;}
};
const postButton=document.createElement('button');postButton.className='fs-mlb-tab';postButton.dataset.mlbView='postseason';postButton.textContent='Postseason';q('.fs-extra-tabs').append(postButton);
root.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(!active() && !b.dataset.mlbWatch && !b.dataset.mlbDetail)return;
  const panel=b.dataset.mlbView||b.dataset.nflView||b.dataset.tvView||b.dataset.view;
  if(!(panel || Object.keys(b.dataset).some(k=>k.startsWith('mlb')) || ['ez-dir-auto','ez-dir-pin','ez-dir-play','ez-dir-detail'].includes(b.id)))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(b.dataset.mlbWatch){const g=games().find(g=>g.id===b.dataset.mlbWatch);if(g)void root.fieldscreenIptv.openGame(g,Number(b.dataset.watchSlot||0));return;}
  if(!active())root.fieldscreenSports.switchSport('mlb');
  if(panel)navigate(panel);
  else if(b.dataset.mlbGame || b.dataset.mlbDetail){state.selected=b.dataset.mlbGame||b.dataset.mlbDetail;state.auto=false;state.detail=null;state.errors.detail='';const g=current();if(b.dataset.mlbGame&&g?.live&&root.fieldscreenIptv.connected())void root.fieldscreenIptv.openGame(g);else navigate(b.dataset.mlbDetail?'game':'gameday');}
  else if(b.dataset.mlbTeam){state.team=b.dataset.mlbTeam;state.teamData=null;navigate('teams');}
  else if(b.dataset.mlbLeague){state.league=b.dataset.mlbLeague;api.render();}
  else if(b.hasAttribute('data-mlb-race')){state.race=!state.race;api.render();}
  else if(b.dataset.mlbStage){state.stage=b.dataset.mlbStage;api.render();}
  else if(b.dataset.mlbPage){state.page=(state.page+Number(b.dataset.mlbPage)+Math.max(1,Math.ceil((state.board?.games.length||0)/6)))%Math.max(1,Math.ceil((state.board?.games.length||0)/6));api.render();}
  else if(b.dataset.mlbDay || b.hasAttribute('data-mlb-today')){const date=new Date((state.date||today())+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+Number(b.dataset.mlbDay||0));state.date=b.hasAttribute('data-mlb-today')?null:date.toISOString().slice(0,10);state.board=null;state.detail=null;state.selected=null;state.loading=true;api.render();refresh();}
  else if(b.id==='ez-dir-auto'||b.id==='ez-dir-pin'){state.auto=!state.auto;if(state.auto)state.selected=[...(state.board?.games||[])].sort((a,b)=>gamePriority(b)-gamePriority(a))[0]?.id;api.render();}
  else if(b.id==='ez-dir-detail')navigate('game');
  else {refresh();if(state.panel==='standings')loadStandings();if(state.panel==='postseason')loadPost();if(state.panel==='teams')loadTeam();if(state.panel==='game')loadDetail();}
},true);
root.addEventListener('change',event=>{
  if(!active())return;const el=event.target;
  if(el.id==='fs-mlb-date'&&el.value){state.date=el.value;state.board=null;state.detail=null;state.selected=null;state.loading=true;api.render();refresh();}
  else if(el.id==='fs-mlb-season'){state.season=Number(el.value);for(const key of ['standings','post','teamData']){state[key]=null;state.errors[key]='';generations.set(key,(generations.get(key)||0)+1);state.busy.delete(key);}navigate(state.panel);}
  else if(el.id==='fs-mlb-team'){state.team=el.value;state.teamData=null;api.render();loadTeam();}
});
root.fieldscreenMlb=module;root.fieldscreenSports.register('mlb',module);refresh();
setInterval(()=>{if(document.hidden)return;refresh();if(active()&&state.panel==='game')loadDetail();if(active()&&state.panel==='postseason')loadPost();},30000);
setInterval(()=>{if(!document.hidden&&state.standings)loadStandings();},300000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
