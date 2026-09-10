const root = document.getElementById('fieldscreen-concept'), api = root.fieldscreenConcept;
let expanded = null, previousAudio = -1, restoreNativeWindow = false, nativeTransition = Promise.resolve();
const back = document.createElement('button');
back.className = 'ez-button fs-pane-back'; back.hidden = true;
back.textContent = 'Back to screens · Esc / B';
root.append(back);
function refresh() { root.fieldscreenIptv?.refreshLayout(); }
function leave(restoreWindow = true) {
  if (expanded === null) return;
  const slot = expanded; expanded = null;
  root.classList.remove('fs-pane-expanded'); delete root.dataset.expandedPane;
  back.hidden = true; api.state.audio = previousAudio; refresh();
  root.querySelector(`[data-promote="${slot}"]`)?.focus();
  if (window.fieldscreenDesktop) {
    nativeTransition = nativeTransition.then(async () => {
      if (restoreNativeWindow && restoreWindow) await window.fieldscreenDesktop.setFullscreen(false);
      restoreNativeWindow = false;
    }).catch(() => {});
  } else if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
}
function enter(slot) {
  if (expanded !== null) { leave(); return; }
  const pane = root.querySelector(`.ez-feed[data-slot="${slot}"]`);
  if (api.state.view !== 'watch' || !pane?.getBoundingClientRect().width) return;
  expanded = slot; previousAudio = api.state.audio; api.state.audio = slot;
  root.dataset.expandedPane = String(slot); root.classList.add('fs-pane-expanded');
  back.hidden = false; back.focus(); refresh();
  // Keep the layout, channel order and player instances intact beneath the view.
  if (window.fieldscreenDesktop) {
    nativeTransition = nativeTransition.then(async () => {
      const state = await window.fieldscreenDesktop.windowState();
      if (expanded !== null && !state.fullscreen) {
        restoreNativeWindow = true;
        await window.fieldscreenDesktop.setFullscreen(true);
      }
    }).catch(() => {});
  } else if (!document.fullscreenElement && root.requestFullscreen) {
    void root.requestFullscreen().catch(() => {});
  }
}
back.addEventListener('click', () => leave());
root.addEventListener('click', event => {
  const button = event.target.closest('[data-promote]'); if (!button) return;
  event.preventDefault(); event.stopImmediatePropagation(); enter(Number(button.dataset.promote));
}, true);
document.addEventListener('keydown', event => {
  if (expanded !== null && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); leave(); }
}, true);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && expanded !== null && !window.fieldscreenDesktop) leave(false); });
window.fieldscreenDesktop?.onWindowState(state => { if (!state.fullscreen && expanded !== null) leave(false); });
root.fieldscreenPanes = { enter, exit: leave, slot: () => expanded };
