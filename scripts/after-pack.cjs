const { rename, copyFile, chmod, access } = require('node:fs/promises');
const path = require('node:path');

module.exports = async context => {
  if (context.electronPlatformName !== 'linux') return;
  const executable = path.join(context.appOutDir, 'fieldscreen-tv');
  const binary = path.join(context.appOutDir, 'fieldscreen-tv-bin');
  // afterPack normally runs on fresh output; fail rather than wrap twice.
  try { await access(binary); throw new Error('FieldScreen launcher already installed in this output directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(executable, binary);
  await copyFile(path.join(__dirname, '../desktop/launch.sh'), executable);
  await chmod(executable, 0o755);
};
