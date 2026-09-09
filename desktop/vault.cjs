const { readFile, writeFile, rename, rm, access } = require('node:fs/promises');

function createVault(file, safeStorage, platform = process.platform) {
  const available = () => safeStorage.isEncryptionAvailable() && (platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend()));
  return {
    available,
    async exists() { try { await access(file); return available(); } catch { return false; } },
    async save(config) {
      if (!available()) throw new Error('System keyring unavailable');
      const encoded = safeStorage.encryptString(JSON.stringify(config));
      await writeFile(file + '.tmp', encoded, { mode: 0o600 });
      await rename(file + '.tmp', file);
    },
    async load() {
      if (!available()) return null;
      try { return JSON.parse(safeStorage.decryptString(await readFile(file))); } catch { return null; }
    },
    async remove() { await rm(file, { force: true }); await rm(file + '.tmp', { force: true }); },
  };
}
module.exports = { createVault };
