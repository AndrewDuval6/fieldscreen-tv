const root = document.getElementById('fieldscreen-concept');
const q = selector => root.querySelector(selector);
const bar = q('.ez-tv-switch');
const games = q('[data-tv-view="gameday"]');
games.textContent = 'Games';
q('[data-tv-view="watch"]').textContent = 'Watch';
q('[data-favorites-view]').textContent = 'Favorites';
bar.setAttribute('role', 'navigation');
bar.setAttribute('aria-label', 'Main views');

// Keep the original controls and their listeners when moving secondary actions.
const menuButton = document.createElement('button');
menuButton.id = 'fs-menu-toggle';
menuButton.className = 'ez-button fs-menu-toggle';
menuButton.textContent = 'Menu';
menuButton.setAttribute('aria-haspopup', 'dialog');
menuButton.setAttribute('aria-controls', 'fs-app-menu');
menuButton.setAttribute('aria-expanded', 'false');
q('.ez-top').append(menuButton);
const menu = document.createElement('dialog');
menu.id = 'fs-app-menu';
menu.setAttribute('aria-labelledby', 'fs-menu-title');
menu.innerHTML = `<header><h2 id="fs-menu-title">Your game day</h2><button class="ez-button" data-menu-close aria-label="Close menu">Close · B</button></header>
  <section><h3>TV & channels</h3><div class="fs-menu-coverage"></div></section>
  <section><h3>Display & controls</h3><div class="fs-menu-display"></div><p>Arrow keys or D-pad to move. A to select. B or Escape to go back.</p></section>`;
root.append(menu);
const context = document.createElement('div');
context.className = 'fs-context-bar';
context.innerHTML = '<div class="fs-context-sport"></div><nav aria-label="League views" class="fs-context-tabs"><button data-nfl-view="gameday">Live</button></nav><div class="fs-context-actions"></div>';
q('.ez-main').prepend(context);
q('.fs-context-sport').append(q('#fs-sport-select'));
q('.fs-context-tabs').append(q('.fs-extra-tabs'));
q('.fs-context-actions').append(q('#ez-dir-auto'), q('#ez-dir-play'));
q('.fs-menu-coverage').append(q('.fs-iptv-button'));
const redzone = document.createElement('button');
redzone.className = 'ez-button'; redzone.dataset.quickRedzone = ''; redzone.textContent = 'Watch RedZone';
q('.fs-menu-coverage').append(redzone);
for (const selector of ['.fs-display-control', '#ez-theme', '.ez-native-fullscreen', '#ez-intro', '.ez-native-exit']) {
  const control = q(selector);
  if (control) q('.fs-menu-display').append(control);
}
q('#ez-intro span').textContent = 'Welcome screen';
q('#fs-nfl-source').hidden = true;

function close() {
  if (!menu.open) return;
  menu.close(); menuButton.setAttribute('aria-expanded', 'false');
  menuButton.focus({ preventScroll: true });
}
function open() {
  menu.showModal(); menuButton.setAttribute('aria-expanded', 'true');
  q('[data-menu-close]').focus();
}
menuButton.addEventListener('click', open);
menu.addEventListener('cancel', event => { event.preventDefault(); close(); });
menu.addEventListener('click', event => {
  if (event.target === menu) {
    const bounds = menu.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  }
});
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !menu.contains(button)) return;
  // Close before existing actions open their own dialogs, so focus returns here.
  if (button.id !== 'ez-theme') close();
}, true);
root.fieldscreenNavigation = { isOpen: () => menu.open, close };
function syncPrimaryView() {
  const view = root.fieldscreenConcept.state.view;
  const primary = ['watch','favorites'].includes(view) ? view : 'games';
  root.dataset.primaryView = primary;
  q('.fs-context-tabs [data-nfl-view="gameday"]').setAttribute('aria-pressed', String(view === 'gameday'));
  const pressed = String(primary === 'games');
  if (games.getAttribute('aria-pressed') !== pressed) games.setAttribute('aria-pressed', pressed);
}
new MutationObserver(syncPrimaryView).observe(bar, { attributes: true, attributeFilter: ['aria-pressed'], subtree: true });
syncPrimaryView();
root.classList.add('fs-simple-nav');
