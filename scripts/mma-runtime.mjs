import { matchMmaBroadcasts, mmaCoverage } from './mma-core.mjs';
const root=document.getElementById('fieldscreen-concept'), api=root.fieldscreenConcept, q=s=>root.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,attrs='')=>`<button class="ez-button" ${attrs}>${label}</button>`;
const state={board:null,error:'',busy:false,selected:null,promotion:'all',filter:'upcoming',search:'',panel:'gameday'};
const games=()=>state.board?.games||[], active=()=>root.fieldscreenSports.active()==='mma';
const time=d=>d?new Date(d).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Time to be announced';
const fresh=()=>state.board?.meta?`${state.board.meta.stale?'CACHED · ':''}ESPN · ${new Date(state.board.meta.updatedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})}`:'Connecting to fight schedules…';
const current=()=>games().find(g=>g.id===state.selected);
function actions(g,slot) {
  return button(g.live?'▶ Watch live':'Check coverage',`data-mma-watch="${g.id}" ${slot===undefined?'':`data-watch-slot="${slot}"`} ${g.complete||g.stopped?'disabled':''}`)+(g.complete||g.timeTBD||g.stopped?'':button(g.sessionCount>1?'● Record main card':'● Record event',`data-record-game="mma:${g.id}"`));
}
const badge=g=>`<span class="fs-mma-badge ${g.live?'is-live':''}">${esc(g.promotion.toUpperCase())} · ${g.live?'● LIVE':g.complete?'FINAL':g.stopped?g.status:'UPCOMING'}</span>${g.ppv?'<span class="fs-mma-ppv">PPV LISTING</span>':''}`;
function filtered() {
  const needle=state.search.toLowerCase();
  return games().filter(g=>(state.promotion==='all'||g.promotion===state.promotion)&&(state.filter==='recent'?g.complete:state.filter==='numbered'?!g.complete&&(g.numbered||g.ppv):!g.complete)&&(!needle||[g.name,g.venue,...g.fights.flatMap(f=>[f.away.name,f.home.name])].join(' ').toLowerCase().includes(needle))).sort((a,b)=>Number(b.live)-Number(a.live)||(state.filter==='recent'?Date.parse(b.date)-Date.parse(a.date):Date.parse(a.date)-Date.parse(b.date)));
}
function selectDefault() { if(!current())state.selected=[...games()].sort((a,b)=>Number(b.live)-Number(a.live)||Number(a.complete)-Number(b.complete)||Date.parse(a.date)-Date.parse(b.date))[0]?.id; }
async function refresh() {
  if(state.busy)return;state.busy=true;
  try { const r=await fetch('./mma/scoreboard',{headers:{'X-FieldScreen':'1'},cache:'no-store',credentials:'omit'});const data=await r.json();if(!r.ok)throw Error(data.error||'MMA data is unavailable.');state.board=data;state.error='';selectDefault(); }
  catch(e){state.error=e instanceof SyntaxError?'MMA is available in the installed app.':e.message;if(state.board?.meta)state.board.meta.stale=true;}
  finally{state.busy=false;if(active()||api.state.view==='watch')api.render();}
}
function header() {
  root.classList.add('fs-nfl-connected','ez-tv');api.state.tv=true;q('.ez-brand-sub').textContent='SPORTS CONTROL ROOM';
  q('#ez-title').textContent='MMA / '+(api.state.view==='watch'?'MULTIVIEW':state.panel==='schedule'?'EVENT CALENDAR':'Fight night');
  q('#ez-view-label').textContent=fresh();q('#ez-output-state').textContent=fresh();q('.ez-heading-controls').hidden=true;
  q('#ez-status').textContent=state.error||state.board?.meta.warning||'UFC + PFL · FULL FIGHT CARDS · YOUR CHANNELS';
  q('#ez-status').classList.toggle('fs-data-warning',Boolean(state.error||state.board?.meta.stale));
  root.querySelectorAll('[data-tv-view],[data-nfl-view],[data-mlb-view]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.tvView||b.dataset.nflView)===api.state.view)));
}
function empty() {return `<div class="fs-mma-empty"><img src="./fieldscreen-mark.png" alt="" class="${!state.board&&!state.error?'is-loading':''}"><h3>${state.error?'FIGHT FEED UNAVAILABLE':!state.board?'BUILDING THE FIGHT CARD':'NO EVENTS FOUND'}</h3><p>${esc(state.error||(!state.board?'Loading fighters, schedules and results.':'Try another promotion, event filter, or fighter name.'))}</p>${button('Refresh','data-mma-refresh')}</div>`;}
function eventCard(g) { return `<article class="fs-mma-event ${g.id===state.selected?'is-selected':''}"><div>${badge(g)}</div><button class="fs-mma-event-title" data-mma-event="${g.id}">${esc(g.name)}</button><p>${esc(time(g.date))}</p><small>${esc(g.venue||'Venue to be announced')} · ${g.fights.length} bouts</small><div class="fs-mma-actions">${actions(g)}</div></article>`; }
function fights(g) {
  const sessions=[...new Set(g.fights.map(f=>f.date))].sort().reverse();
  return sessions.map((date,index)=>`<section class="fs-mma-session"><header><h3>${sessions.length>1?(index===0?'MAIN CARD':index===sessions.length-1&&sessions.length>2?'EARLY PRELIMS':'PRELIMS'):'FIGHT CARD'}</h3><span>${esc(time(date))}</span></header>${g.fights.filter(f=>f.date===date).map((f,i)=>`<article class="fs-mma-bout ${f.live?'is-live':''}"><div class="fs-mma-bout-top"><span>${g.headlinerConfirmed&&f.id===g.fights[0]?.id?'MAIN EVENT · ':''}${esc(f.weight)}${f.rounds?' · '+f.rounds+' ROUNDS':''}</span><b>${f.live?'● LIVE':f.complete?'FINAL':esc(f.status)}</b></div><div class="fs-mma-fighters">${[f.away,f.home].map((a,n)=>`${n?'<i>VS</i>':''}<div class="${a.winner&&f.complete?'is-winner':''}"><strong>${esc(a.name)}${a.winner&&f.complete?' <span>WIN</span>':''}</strong><small>${esc(a.record||'Record unavailable')} · ${esc(a.country||'Country unavailable')}</small></div>`).join('')}</div>${f.round?`<p class="fs-mma-round">Round ${f.round}${f.clock&&f.clock!=='-'?' · '+esc(f.clock):''}${f.complete?' · as reported':''}</p>`:''}</article>`).join('')}</section>`).join('')||'<p class="fs-nfl-muted">The promotion has not published the fight card yet.</p>';
}
function feature(g) {
  const live=g.fights.find(f=>f.live);
  return `<section class="fs-mma-feature"><div class="fs-mma-feature-top">${badge(g)}<span>${g.fights.filter(f=>f.complete).length}/${g.fights.length} BOUTS COMPLETE</span></div><h2>${esc(g.name)}</h2><p>${esc(g.venue)}${g.location?' · '+esc(g.location):''}</p><div class="fs-mma-event-facts"><div><span>EVENT START</span><strong>${esc(time(g.date))}</strong></div><div><span>${g.sessionCount>1?'MAIN CARD':'BROADCAST'}</span><strong>${esc(g.sessionCount>1?time(g.mainCardDate):g.network||'To be announced')}</strong></div></div>${live?`<div class="fs-mma-live-bout"><b>IN THE CAGE</b><strong>${esc(live.away.name)} vs. ${esc(live.home.name)}</strong><span>${live.round?'Round '+live.round:''} ${esc(live.clock)}</span></div>`:''}<div class="fs-mma-actions">${actions(g)}</div><small class="fs-mma-provider">${esc(g.network||'Broadcast to be announced')} · Watch through your connected provider.</small></section>`;
}
function render() {
  q('#ez-director-surface').hidden=true;root.classList.remove('ez-director');header();
  if(api.state.view==='watch')return false;
  const focused=document.activeElement, focusAttr=focused?.getAttributeNames?.().find(n=>n.startsWith('data-mma-')||n==='data-record-game');
  const identity=focused?.id?'#'+CSS.escape(focused.id):focusAttr?'['+focusAttr+'="'+CSS.escape(focused.getAttribute(focusAttr))+'"]':null;
  const scrolls=[...root.querySelectorAll('.fs-mma-scroll')].map(el=>el.scrollTop), cursor=focused?.id==='fs-mma-search'?[focused.selectionStart,focused.selectionEnd]:null;
  const list=filtered(),g=current();
  q('#ez-body').innerHTML=`<div class="fs-nfl-controls fs-mma-controls"><h2>${state.panel==='schedule'?'Fight calendar':'Fight night'}</h2><select id="fs-mma-promotion" aria-label="Choose MMA promotion">${[['all','All promotions'],['ufc','UFC'],['pfl','PFL']].map(([v,l])=>`<option value="${v}" ${state.promotion===v?'selected':''}>${l}</option>`).join('')}</select><select id="fs-mma-filter" aria-label="Choose MMA events">${[['upcoming','Live + upcoming'],['numbered','Numbered + PPV events'],['recent','Recent results']].map(([v,l])=>`<option value="${v}" ${state.filter===v?'selected':''}>${l}</option>`).join('')}</select><input id="fs-mma-search" type="search" placeholder="Search events or fighters…" aria-label="Search every loaded event and fighter" value="${esc(state.search)}">${button('Refresh','data-mma-refresh')}</div>${state.error?`<div class="fs-mma-warning" role="status">${esc(state.error)}</div>`:''}${state.panel==='schedule'?`<div class="fs-nfl-scroll fs-mma-scroll fs-mma-calendar">${list.length?list.map(eventCard).join(''):empty()}</div>`:`<div class="fs-mma-layout"><aside class="fs-nfl-scroll fs-mma-scroll fs-mma-events" aria-label="MMA events">${list.length?list.map(eventCard).join(''):empty()}</aside><div class="fs-nfl-scroll fs-mma-scroll fs-mma-card" aria-label="Selected fight card">${g?feature(g)+fights(g):empty()}<p class="fs-mma-note">Session times are listed by the feed; individual bout times and card order can change. Numbered events are included regardless of whether a broadcaster sells them as PPV.</p></div></div>`}`;
  root.querySelectorAll('.fs-mma-scroll').forEach((el,i)=>{el.scrollTop=scrolls[i]||0;});
  if(identity&&!focused.isConnected&&!root.fieldscreenRecordings?.isOpen()&&q('#fs-iptv-modal')?.hidden){const next=q(identity);next?.focus({preventScroll:true});if(cursor)next?.setSelectionRange(...cursor);}
  return true;
}
const module={
  teamFavorites:false,game:id=>games().find(g=>g.id===id),render,afterRender:header,matchBroadcasts:matchMmaBroadcasts,coverage:channels=>mmaCoverage(games(),channels),statusText:fresh,
  activate(){state.panel='gameday';api.state.view='gameday';void refresh();},
  sourceOptions(source){return `<optgroup label="MMA fight cards"><option value="mma:dashboard" ${source==='mma:dashboard'?'selected':''}>MMA event board</option>${games().filter(g=>!g.complete).map(g=>`<option value="mma:game:${g.id}" ${source==='mma:game:'+g.id?'selected':''}>${esc(g.name)}</option>`).join('')}</optgroup>`;},
  feed(slot,html){const source=String(api.state.slots[slot]);if(source.startsWith('iptv:'))return undefined;const g=games().find(g=>'mma:game:'+g.id===source);return `<article class="ez-feed fs-nfl-feed fs-mma-feed" data-slot="${slot}">${html}<div class="fs-watch-data">${g?`<h3>${esc(g.name)}</h3><p>${esc(g.status)} · ${esc(time(g.date))}</p>${g.fights.slice(0,5).map(f=>`<div><span>${esc(f.away.name)}<small>${esc(f.home.name)}</small></span><b>${f.live?'LIVE':f.complete?'FINAL':esc(f.weight)}</b></div>`).join('')}<div class="fs-mma-actions">${actions(g,slot)}</div>`:`<h3>MMA · EVENT BOARD</h3>${games().filter(g=>!g.complete).slice(0,8).map(g=>`<button data-mma-${g.live?'watch':'event'}="${g.id}" data-watch-slot="${slot}"><span>${esc(g.name)}<small>${esc(time(g.date))}</small></span><b>${g.live?'LIVE':esc(g.promotion.toUpperCase())}</b></button>`).join('')||esc(state.error||'Loading fight cards…')}`}</div><div class="ez-feed-foot"><span>${esc(fresh())}</span><span>MMA DATA</span></div></article>`;}
};
root.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.mmaWatch){event.preventDefault();event.stopImmediatePropagation();const g=games().find(g=>g.id===b.dataset.mmaWatch);if(g)void root.fieldscreenIptv.openGame(g,Number(b.dataset.watchSlot||0));return;}
  if(b.dataset.mmaEvent){event.preventDefault();event.stopImmediatePropagation();if(!active())root.fieldscreenSports.switchSport('mma');state.selected=b.dataset.mmaEvent;state.panel='gameday';api.state.view='gameday';q('.fs-mma-card')?.scrollTo(0,0);api.render();return;}
  if(!active()||api.state.view==='favorites')return;
  const panel=b.dataset.tvView||b.dataset.nflView||b.dataset.view;
  if(!panel&&!b.hasAttribute('data-mma-refresh'))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(panel){state.panel=panel==='schedule'?'schedule':'gameday';api.state.view=panel==='watch'?'watch':state.panel;api.render();}else void refresh();
},true);
root.addEventListener('change',e=>{if(e.target.id==='fs-mma-promotion'){state.promotion=e.target.value;state.selected=filtered()[0]?.id;api.render();}if(e.target.id==='fs-mma-filter'){state.filter=e.target.value;state.selected=filtered()[0]?.id;api.render();}});
root.addEventListener('input',e=>{if(e.target.id==='fs-mma-search'){state.search=e.target.value;api.render();}});
root.fieldscreenMma=module;root.fieldscreenSports.register('mma',module);void refresh();
setInterval(()=>{if(!document.hidden)void refresh();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
