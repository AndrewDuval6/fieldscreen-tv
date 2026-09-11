import { displayLayout } from './display-core.mjs';

const root = document.getElementById('fieldscreen-concept');
const desktop = window.fieldscreenDesktop;
const key = 'fieldscreen-display-layout';
let preference = 'auto', display = {};
try { const saved = localStorage.getItem(key); if (['auto','deck','tv'].includes(saved)) preference = saved; } catch {}
const label = document.createElement('label');
label.className = 'fs-display-control';
const select = document.createElement('select');
select.id = 'fs-display-layout'; select.setAttribute('aria-label', 'Screen layout');
for (const [value, text] of [['auto','Screen: Auto'],['deck','Screen: Deck'],['tv','Screen: TV']]) {
  const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
}
select.value = preference; label.append(select); root.querySelector('.ez-bottom').append(label);
function fit() {
  const viewport = window.visualViewport;
  const width = Math.max(1, Math.floor(viewport?.width || window.innerWidth));
  const height = Math.max(1, Math.floor(viewport?.height || window.innerHeight));
  const layout = displayLayout(width, height, preference, display);
  root.dataset.displayMode = layout.mode;
  root.style.setProperty('--fs-screen-width', layout.width + 'px');
  root.style.setProperty('--fs-screen-height', layout.height + 'px');
  select.options[0].textContent = 'Auto: ' + (layout.mode === 'deck' ? 'Deck' : 'TV');
}
select.addEventListener('change', () => {
  preference = select.value;
  try { localStorage.setItem(key, preference); } catch {}
  fit();
});
window.addEventListener('resize', fit);
window.visualViewport?.addEventListener('resize', fit);
if (desktop?.displayState) {
  desktop.displayState().then(state => { display = state; fit(); }).catch(() => {});
  desktop.onDisplayState(state => { display = state; fit(); });
}
fit();
