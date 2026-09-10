import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const version = JSON.parse(await readFile('desktop/package.json', 'utf8')).version;
for (const valid of [true, false]) test(`Terminal installer ${valid ? 'verifies and installs into paths with spaces' : 'rejects a bad download and preserves the installed app'}`, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fieldscreen-install-'));
  try {
    const bin = path.join(dir, 'tools'), appDir = path.join(dir, 'My Applications'), dataDir = path.join(dir, 'data');
    await mkdir(bin); await mkdir(appDir);
    const appPath = path.join(appDir, 'FieldScreen-TV.AppImage');
    await writeFile(appPath, 'previous app');
    const binary = '#!/bin/sh\nexit 0\n';
    const digest = createHash('sha256').update(valid ? binary : 'different contents').digest('hex');
    await writeFile(path.join(dir, 'binary'), binary);
    await writeFile(path.join(dir, 'checksums'), `${digest}  FieldScreen-TV-${version}-Linux-x86_64.AppImage\n`);
    await writeFile(path.join(bin, 'curl'), `#!/bin/bash
set -eu
url=''
out=''
while (($#)); do
 case "$1" in
 --output) out="$2"; shift 2;;
 https://*) url="$1"; shift;;
 *) shift;;
 esac
done
case "$url" in
 https://github.com/AndrewDuval6/fieldscreen-tv/releases/download/v${version}/SHA256SUMS) cp "$INSTALL_FIXTURE/checksums" "$out";;
 https://github.com/AndrewDuval6/fieldscreen-tv/releases/download/v${version}/FieldScreen-TV-${version}-Linux-x86_64.AppImage) cp "$INSTALL_FIXTURE/binary" "$out";;
 *) exit 5;;
esac
`, { mode: 0o755 });
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, INSTALL_FIXTURE: dir, FIELDSCREEN_INSTALL_DIR: appDir, FIELDSCREEN_BIN_DIR: path.join(dir, 'commands'), XDG_DATA_HOME: dataDir };
    const install = run('bash', ['install.sh', '--no-launch'], { env });
    if (!valid) {
      await assert.rejects(install, error => error.code !== 0 && /verification failed/.test(error.stderr));
      assert.equal(await readFile(appPath, 'utf8'), 'previous app');
      await assert.rejects(access(path.join(dataDir, 'applications/fieldscreen-tv.desktop')));
    } else {
      await install;
      assert.equal(await readFile(appPath, 'utf8'), binary);
      assert.equal(await readlink(path.join(dir, 'commands/fieldscreen-tv')), appPath);
      const desktop = path.join(dataDir, 'applications/fieldscreen-tv.desktop');
      assert.match(await readFile(desktop, 'utf8'), /FieldScreen-TV\.AppImage" --windowed/);
      await access(path.join(dataDir, 'icons/hicolor/512x512/apps/fieldscreen-tv.png'));
      try { await run('desktop-file-validate', [desktop]); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
