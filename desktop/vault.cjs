const { readFile, writeFile, rename, rm, access, mkdir } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function listServices() {
  try { return execFileSync('busctl', ['--user', '--no-pager', '--no-legend', 'list'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}
function configurePasswordStore(commandLine, platform = process.platform, env = process.env, services = listServices) {
  // Keep Electron's KDE/KWallet selection on Steam Deck and respect overrides.
  // Standalone Wayland desktops need an explicit Secret Service selection.
  if (platform === 'linux' && !commandLine.hasSwitch('password-store') &&
      !/kde|plasma/i.test(`${env.XDG_CURRENT_DESKTOP || ''} ${env.DESKTOP_SESSION || ''}`) && !env.KDE_SESSION_VERSION) {
    const names = new Set(services().split('\n').map(line => line.trim().split(/\s+/)[0]));
    const wallet = names.has('org.kde.kwalletd6') ? 'kwallet6' : names.has('org.kde.kwalletd5') ? 'kwallet5' : names.has('org.kde.kwalletd') ? 'kwallet' : null;
    commandLine.appendSwitch('password-store', !names.has('org.freedesktop.secrets') && wallet ? wallet : 'gnome-libsecret');
  }
}

function createVault(file, safeStorage, platform = process.platform) {
  const available = () => {
    try { return safeStorage.isEncryptionAvailable() && (platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())); }
    catch { return false; }
  };
  let checked = null, checking = null;
  async function verify(force = false) {
    if (checking) return checking;
    if (!force && checked && Date.now() - checked.checkedAt < 60000) return checked;
    checking = (async () => {
      let state = 'unavailable', message = 'Secure storage is unavailable or locked. Unlock your desktop keyring or wallet, then choose Check again. Your provider can still connect for this session.';
      if (available()) {
        const probe = file + '.check-' + randomUUID(), sample = randomUUID();
        try {
          const encrypted = safeStorage.encryptString(sample);
          if (safeStorage.decryptString(encrypted) !== sample) throw new Error('Encryption check failed');
          state = 'unwritable';
          message = 'Your app storage could not be written or read. Check free space and access to your app data folder, then choose Check again.';
          await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
          await writeFile(probe, encrypted, { mode: 0o600, flag: 'wx' });
          if (safeStorage.decryptString(await readFile(probe)) !== sample) throw new Error('Storage check failed');
          state = 'ready'; message = 'Secure storage verified on this device. Remembered providers reconnect when you open the app.';
        } catch { /* Return actionable, credential-free diagnostics. */ }
        finally { await rm(probe, { force: true }).catch(() => {}); }
      }
      return checked = { state, message, checkedAt: Date.now() };
    })();
    try { return await checking; } finally { checking = null; }
  }
  return {
    available, verify,
    async hasFile() { try { await access(file); return true; } catch { return false; } },
    async exists() { try { await access(file); return available(); } catch { return false; } },
    async save(config) {
      if ((await verify(true)).state !== 'ready') throw new Error('Secure storage unavailable');
      const encoded = safeStorage.encryptString(JSON.stringify(config));
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, encoded, { mode: 0o600, flag: 'wx' });
        if (safeStorage.decryptString(await readFile(temporary)) !== JSON.stringify(config)) throw new Error('Saved provider verification failed');
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    },
    async load() {
      if (!available()) return null;
      try { return JSON.parse(safeStorage.decryptString(await readFile(file))); } catch { return null; }
    },
    async remove() { await rm(file, { force: true }); await rm(file + '.tmp', { force: true }); },
  };
}
module.exports = { createVault, configurePasswordStore };
