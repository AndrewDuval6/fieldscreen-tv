import { nextFocus, gamepadActions } from './controller-core.mjs';

const root = document.getElementById('fieldscreen-concept');
const api = root.fieldscreenConcept;
const q = selector => root.querySelector(selector);
const supported = ['single', 'split', 'quad', 'focus'];
let lastInput = {}, controllerIndex = null, activeControl = null;

function visibleControls() {
  const dialog = !q('#ez-launch').hidden ? q('#ez-launch') : !q('#ez-overlay').hidden ? q('#ez-overlay') : root;
  return [...dialog.querySelectorAll('button, select')].filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !element.disabled && !element.closest('[inert]');
  });
}
function focus(element) {
  root.querySelectorAll('.ez-controller-focus').forEach(el => el.classList.remove('ez-controller-focus'));
  if (element) { activeControl = element; element.classList.add('ez-controller-focus'); element.focus({ preventScroll: true }); }
}
function move(direction) {
  const controls = visibleControls();
  if (!controls.length) return;
  const boxes = controls.map(element => { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  focus(controls[nextFocus(boxes, controls.indexOf(document.activeElement), direction)]);
}
function cycleSource(select, amount) {
  select.selectedIndex = (select.selectedIndex + amount + select.options.length) % select.options.length;
  const pane = select.dataset.screen;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  focus(q('[data-screen="' + pane + '"]'));
}
function action(name) {
  if (!q('#ez-launch').hidden) { if (name === 'accept' || name === 'back') q('#ez-enter').click(); return; }
  const current = document.activeElement;
  if (['up','down','left','right'].includes(name)) {
    if (current?.matches('select') && ['left','right'].includes(name)) cycleSource(current, name === 'left' ? -1 : 1);
    else move(name);
    return;
  }
  if (name === 'accept') {
    if (current?.matches('select')) cycleSource(current, 1);
    else if (visibleControls().includes(current)) current.click();
    else focus(visibleControls()[0]);
  } else if (name === 'back') {
    if (!q('#ez-overlay').hidden) q('#ez-close').click();
    focus(q('[data-tv-view="gameday"]'));
  } else if (name === 'director' || name === 'multiview') {
    q('[data-tv-view="' + (name === 'director' ? 'gameday' : 'watch') + '"]').click();
    focus(visibleControls()[0]);
  } else if (name === 'audio') {
    if (root.classList.contains('ez-director')) q('#ez-dir-pin').click();
    else (current?.closest('.ez-feed')?.querySelector('[data-audio]') ?? q('[data-audio]'))?.click();
  } else if (name === 'layout') {
    if (root.classList.contains('ez-director')) q('#ez-dir-auto').click();
    else q('[data-layout="' + supported[(supported.indexOf(api.state.layout) + 1) % supported.length] + '"]').click();
  } else if (name === 'demo' && root.classList.contains('ez-director')) q('#ez-dir-play').click();
}
function poll(now) {
  const pads = navigator.getGamepads?.() ?? [];
  const pad = [...pads].find(candidate => candidate?.connected && candidate.mapping === 'standard');
  if (pad && !document.hidden) {
    if (controllerIndex !== pad.index) { lastInput = {}; controllerIndex = pad.index; focus(visibleControls()[0]); }
    root.classList.add('ez-controller-connected');
    const input = gamepadActions(pad, lastInput, now); lastInput = input.state;
    input.actions.forEach(action);
    if (activeControl && !activeControl.isConnected) focus(visibleControls()[0]);
  } else {
    controllerIndex = null; lastInput = {}; root.classList.remove('ez-controller-connected');
  }
  requestAnimationFrame(poll);
}
root.addEventListener('keydown', event => {
  if (!q('#ez-launch').hidden || !q('#ez-overlay').hidden) return;
  if (event.key.startsWith('Arrow') && !event.target.matches('select')) {
    event.preventDefault(); move(event.key.slice(5).toLowerCase());
  }
});
root.addEventListener('pointerdown', () => {
  root.querySelectorAll('.ez-controller-focus').forEach(el => el.classList.remove('ez-controller-focus'));
});
if (window.fieldscreenDesktop) {
  const exit = document.createElement('button'); exit.className = 'ez-button ez-native-exit'; exit.textContent = 'Exit';
  exit.addEventListener('click', () => window.fieldscreenDesktop.quit()); q('.ez-top').append(exit);
}
const hint = document.createElement('span'); hint.className = 'ez-controller-hint';
hint.textContent = 'A SELECT · X AUDIO / PIN · Y LAYOUT / AUTO · LB/RB VIEW';
q('.ez-bottom').append(hint);
api.state.tv = true; api.render();
q('#ez-intro').click();
requestAnimationFrame(poll);
