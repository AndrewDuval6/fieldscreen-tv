const { readFile, writeFile, rename, mkdir, rm } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

function normalize(value) {
  if (!Array.isArray(value) || value.length > 256 || value.some(key => typeof key !== 'string' || !/^[a-z][a-z0-9-]{1,15}:\d{1,12}$/.test(key))) throw Error('Choose a valid list of teams.');
  return [...new Set(value)].sort();
}
function createFavorites(file) {
  let pending = Promise.resolve();
  async function read() {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (data.version !== 1) throw Error('Unrecognized favorites.');
      return normalize(data.teams);
    } catch (error) { if (error.code === 'ENOENT') return []; throw Error('Saved teams could not be read.'); }
  }
  function write(value) {
    const teams = normalize(value);
    const save = async () => {
      const temporary = file + '.' + randomUUID();
      try {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const raw = JSON.stringify({ version: 1, teams });
        await writeFile(temporary, raw, { mode: 0o600, flag: 'wx' });
        if (await readFile(temporary, 'utf8') !== raw) throw Error('Storage check failed.');
        await rename(temporary, file);
        const saved = await read();
        if (JSON.stringify(saved) !== JSON.stringify(teams)) throw Error('Storage check failed.');
        return saved;
      } catch { throw Error('Your teams could not be saved. Check free space and app folder access.'); }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
    };
    const result = pending.then(save);
    pending = result.catch(() => {});
    return result;
  }
  return { read, write };
}
module.exports = { createFavorites };
