const root = document.getElementById('fieldscreen-concept');
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const active = job => ['scheduled','waiting','starting','recording','stopping'].includes(job.state);
const time = value => new Date(value).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const size = value => value >= 1024 ** 3 ? (value/1024**3).toFixed(1)+' GB' : Math.round(value/1024**2)+' MB';
const button = (label,attrs='') => `<button class="ez-button${attrs.includes('data-rec-confirm')?' ez-primary':''}" ${attrs}>${label}</button>`;
let data = null, intent = null, busy = false, previousFocus = null, error = '', deletion = null, viewing = null, resumeStreams = null, savedFocus = '';
const tab = document.createElement('button'); tab.className='fs-recordings-tab'; tab.textContent='Recordings'; tab.dataset.recordings='';
root.querySelector('.ez-tv-switch').append(tab);
const modal = document.createElement('div'); modal.className='fs-iptv-modal fs-recordings-modal'; modal.id='fs-recordings-modal'; modal.hidden=true;
modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-labelledby','fs-recordings-title');
modal.innerHTML='<section class="fs-rec-shell"><header><div><span class="fs-rec-eyebrow">FIELDSCREEN / YOUR LIBRARY</span><h2 id="fs-recordings-title">Recorded games</h2></div><button class="ez-button" data-rec-close>Back · B</button></header><div class="fs-rec-message" role="status" aria-live="polite"></div><div class="fs-rec-content"></div><footer>Recordings stay on this device. Keep it powered on, connected to the internet, and FieldScreen running.</footer></section>';
root.append(modal);
const content = modal.querySelector('.fs-rec-content'), message = modal.querySelector('.fs-rec-message');
async function request(route, body) {
  const response = await fetch('./recordings/'+route,{method:body ? 'POST':'GET',headers:{'X-FieldScreen':'1',...(body ? {'Content-Type':'application/json'}:{})},...(body ? {body:JSON.stringify(body)}:{}),cache:'no-store'});
  let result; try { result=await response.json(); } catch { throw Error('Recordings are available in the installed FieldScreen TV app.'); }
  if (!response.ok) throw Error(result.error || 'The recording could not be updated.'); return result;
}
function paint(force=true) {
  message.textContent=error || data?.error || ''; message.hidden=!message.textContent;
  tab.textContent = data?.active ? `● Recording ${data.active}` : 'Recordings'; tab.classList.toggle('is-recording',Boolean(data?.active));
  root.querySelectorAll('[data-player-record]').forEach(b=>{const job=data?.jobs.find(j=>j.channel?.id===b.dataset.playerRecord&&active(j));b.textContent=job?'● Recording…':'● Record'; b.classList.toggle('is-recording',Boolean(job));});
  if(modal.hidden || viewing)return;
  if(!force && intent && content.querySelector('.fs-rec-plan'))return;
  const focused=content.contains(document.activeElement)?document.activeElement:null;
  const focusAttr=focused?[...focused.attributes].find(a=>a.name.startsWith('data-rec-')):null;
  if(!data) { content.innerHTML='<div class="fs-rec-empty"><img src="./fieldscreen-mark.png" alt=""><h3>Your game library</h3><p>'+esc(error || 'Checking your recording storage…')+'</p></div>'; return; }
  const folder=`<div class="fs-rec-storage"><div><strong>${data.folder ? esc(data.folder) : 'Choose your recording folder'}</strong><small>${esc(data.storage.note)}${data.folder ? ' · '+size(data.storage.free)+' free' : ''}</small></div>${button(data.folder?'Change folder':'Choose folder','data-rec-folder')}${data.folder?button('Open folder','data-rec-open-folder'):''}</div>`;
  const ready=data.storage.ready&&data.engineReady;
  if(intent) {
    const g=intent.game, scheduled=g&&Date.parse(g.date)>Date.now()+120000;
    content.innerHTML=folder+`<section class="fs-rec-plan"><span class="fs-rec-eyebrow">${scheduled?'RECORD LATER':'RECORD LIVE'}</span><h3>${esc(intent.title)}</h3><p>${scheduled?'Starts '+time(Date.parse(g.date)-120000)+' · two minutes before the listed game time.':'Starts when the broadcast connects. Earlier footage cannot be recovered.'}</p><label>Recording length <select id="fs-rec-hours">${[1,2,3,4,5,6,8].map(n=>`<option value="${n}" ${n===(g?.league==='mma'?6:4)?'selected':''}>${n} hour${n===1?'':'s'}</option>`).join('')}</select></label><p class="fs-rec-estimate">Allow roughly 4–15 GB for four hours of HD video; the provider’s quality determines the size. Choose more time for overtime, extra innings, or a long fight card.</p><p>${g?.league==='mma'?'Records the main card as one broadcast. Prelims on another channel are separate. FieldScreen matches the event in your TV guide at the saved start time.':g?'FieldScreen finds a confirmed matchup in your TV guide at the saved start time. If it cannot match, it retries for up to 30 minutes and shows the result here.':'Records this channel even when you change the dashboard.'}</p><p class="fs-rec-estimate">${scheduled?'Schedule times are saved as shown; reschedule here if the league changes the start time. ':''}Each recording uses an additional provider connection. Up to two recordings can run at once.</p><div>${button(scheduled?'Schedule recording':'Start recording',`data-rec-confirm ${ready&&!busy?'':'disabled'}`)}${button('Cancel','data-rec-cancel')}</div></section>`;
    if(savedFocus)content.querySelector('#fs-rec-hours').value=savedFocus;
    return;
  }
  const jobs=data.jobs;
  content.innerHTML=folder+(jobs.length?`<div class="fs-rec-grid">${jobs.map(job=>`<article class="fs-rec-card ${active(job)?'is-active':''}"><div class="fs-rec-card-top"><span>${esc(job.game?.league?.toUpperCase()||'LIVE TV')}</span><span class="fs-rec-state">${esc(({saved:'SAVED',partial:'PARTIAL VIDEO',scheduled:'SCHEDULED',waiting:'WAITING FOR CHANNEL',starting:'CONNECTING',recording:'● RECORDING',stopping:'FINISHING',failed:'COULD NOT RECORD',missed:'MISSED',cancelled:'CANCELLED'})[job.state]||job.state)}</span></div><h3>${esc(job.title)}</h3><p>${time(job.startedAt||job.startAt)}${active(job)?' → '+time(job.endAt):''}</p><p>${esc(job.channel?.name||'Channel matched automatically')}${job.bytes?' · '+size(job.bytes):''}${job.duration?' · '+(job.duration<60?job.duration+' sec':Math.floor(job.duration/60)+' min'):''}</p><small>${esc(job.note)}</small><div class="fs-rec-actions">${job.media&&job.bytes?button('▶ Play',`data-rec-play="${job.id}"`):''}${active(job)?button(['scheduled','waiting'].includes(job.state)?'Cancel recording':'■ Stop',`data-rec-stop="${job.id}"`):deletion===job.id?button('Delete video & entry',`data-rec-delete="${job.id}"`)+button('Keep it','data-rec-keep'):button(job.file?'Delete…':'Remove entry…',`data-rec-ask-delete="${job.id}"`)}</div></article>`).join('')}</div>`:'<div class="fs-rec-empty"><div class="fs-rec-reel">●</div><h3>Save the games you want to keep.</h3><p>Choose Record on a live screen, or Record game in the NFL or MLB schedule, or Record event in MMA. Your saved games and upcoming recordings appear here.</p></div>');
  if(focusAttr)content.querySelector('['+focusAttr.name+'="'+CSS.escape(focusAttr.value)+'"]')?.focus({preventScroll:true});
}
async function refresh(render=true) {
  try { data=await request('status'); if(render)paint(false); }
  catch(e){error=e.message;if(render)paint();}
}
async function open(next=null) {
  previousFocus=document.activeElement; intent=next; error=''; deletion=null; savedFocus='';
  modal.hidden=false; paint(); modal.querySelector('[data-rec-close]').focus(); await refresh();
}
function endPlayback() {
  if(!viewing)return; const video=content.querySelector('video'); if(video){video.pause();video.removeAttribute('src');video.load();}
  viewing=null;resumeStreams?.();resumeStreams=null;modal.querySelector('header').hidden=false;
}
function close() {endPlayback();modal.hidden=true;intent=null;previousFocus?.isConnected&&previousFocus.focus();}
async function folder() {
  if(!window.fieldscreenDesktop?.chooseRecordingFolder)throw Error('Choose a recording folder in the installed desktop app.');
  savedFocus=content.querySelector('#fs-rec-hours')?.value||savedFocus;
  const result=await window.fieldscreenDesktop.chooseRecordingFolder();if(result)data=result;paint();
}
function playback(id) {
  const job=data.jobs.find(j=>j.id===id);if(!job?.media)return;
  viewing=id;resumeStreams=root.fieldscreenIptv?.suspendAudio();
  content.innerHTML=`<div class="fs-rec-playback"><video controls autoplay playsinline src="${esc(job.media)}" aria-label="${esc(job.title)}"></video><div><strong>${esc(job.title)}</strong>${button('−30 sec','data-rec-seek="-30"')}${button('Play / Pause','data-rec-toggle')}${button('+30 sec','data-rec-seek="30"')}${button('Back to library','data-rec-library')}</div><p role="status">Saved on this computer · use the timeline to seek.</p></div>`;
  const video=content.querySelector('video'); video.addEventListener('error',()=>{content.querySelector('[role=status]').textContent='This file could not be played. The file may be missing, incomplete, or use a video format this device does not support.';});
  video.play().catch(()=>{});content.querySelector('[data-rec-toggle]').focus();
}
modal.addEventListener('change',e=>{if(e.target.id==='fs-rec-hours')savedFocus=e.target.value;});
modal.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  event.preventDefault();event.stopPropagation();
  if(b.hasAttribute('data-rec-close')){close();return;}
  if(b.hasAttribute('data-rec-cancel')){intent=null;error='';paint();return;}
  if(b.dataset.recPlay){playback(b.dataset.recPlay);return;}
  if(b.hasAttribute('data-rec-library')){endPlayback();paint();return;}
  if(b.hasAttribute('data-rec-toggle')){const video=content.querySelector('video');if(video.paused)video.play().catch(()=>{});else video.pause();return;}
  if(b.dataset.recSeek){const video=content.querySelector('video');video.currentTime=Math.max(0,Math.min(Number.isFinite(video.duration)?video.duration:video.currentTime,video.currentTime+Number(b.dataset.recSeek)));return;}
  if(b.dataset.recAskDelete){deletion=b.dataset.recAskDelete;paint();return;}
  if(b.hasAttribute('data-rec-keep')){deletion=null;paint();return;}
  if(busy)return;busy=true;b.disabled=true;
  void(async()=>{try{
    error='';
    if(b.hasAttribute('data-rec-folder'))await folder();
    else if(b.hasAttribute('data-rec-open-folder')){const result=await window.fieldscreenDesktop?.openRecordingFolder();if(result)throw Error('The folder could not be opened.');}
    else if(b.hasAttribute('data-rec-confirm')){await request('heartbeat',{playing:root.fieldscreenIptv?.playingCount()||0});await request('create',{...intent,hours:Number(content.querySelector('#fs-rec-hours').value)});intent=null;await refresh(false);}
    else if(b.dataset.recStop){await request('stop',{id:b.dataset.recStop});await refresh(false);}
    else if(b.dataset.recDelete){await request('delete',{id:b.dataset.recDelete});deletion=null;await refresh(false);}
  }catch(e){error=e.message;}finally{busy=false;paint();}})();
});
document.addEventListener('keydown',event=>{
  if(modal.hidden)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(viewing){endPlayback();paint();}else close();}
  if(event.key==='Tab'){
    const controls=[...modal.querySelectorAll('button,select,video')].filter(e=>!e.disabled&&e.getBoundingClientRect().width);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
},true);
root.addEventListener('click',event=>{
  const b=event.target.closest('[data-recordings],[data-record-game],[data-player-record]');if(!b)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(b.hasAttribute('data-recordings')){void open();return;}
  if(b.dataset.recordGame){const [league,id]=b.dataset.recordGame.split(':');const game=root.fieldscreenSports?.game(league,id);if(game)void open({game:{...game,league,...(league==='mma'?{date:game.mainCardDate||game.date,session:game.sessionCount>1?'main':'event'}:{})},title:game.league==='mma'?game.eventName:`${game.away.abbr} at ${game.home.abbr}`});return;}
  const job=data?.jobs.find(j=>j.channel?.id===b.dataset.playerRecord&&active(j));
  if(job){void open();return;}
  const channel=root.fieldscreenIptv?.channel(b.dataset.playerRecord);
  if(channel){const program=channel.programs?.find(p=>p.start<=Date.now()&&p.end>Date.now());void open({channelId:channel.id,title:program?.title||channel.name});}
},true);
root.fieldscreenRecordings={open,close,isOpen:()=>!modal.hidden,back(){if(viewing){endPlayback();paint();}else close();}};
window.fieldscreenDesktop?.onBackground(()=>{endPlayback();paint();});
// Keep screen connection accounting current without persisting playback state.
setInterval(()=>{if(!data)return;void request('heartbeat',{playing:root.fieldscreenIptv?.playingCount()||0}).catch(()=>{});if(!busy)void refresh();},5000);
void refresh();
