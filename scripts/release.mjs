// Publishes GitHub release v<package.json version> from this machine: the Windows installer is built
// here and the Linux packages in WSL, both from the pushed HEAD. A published version is never
// rebuilt or replaced. `--no-publish` builds the three packages without the release checks.
import { execFileSync, execSync } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const publish = !process.argv.includes('--no-publish');
if (process.platform !== 'win32') throw new Error('Run releases from Windows; the Linux packages are built in WSL.');
const root = resolve('.'), releaseDir = join(root, 'release');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const tag = `v${version}`;
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8' }).trim();
const quiet = (file, args) => { try { execFileSync(file, args, { stdio: 'ignore' }); return true; } catch { return false; } };

if (run('git', ['status', '--porcelain'])) throw new Error('Commit or stash changes first; packages must match HEAD.');
const sha = run('git', ['rev-parse', 'HEAD']);
if (publish) {
  execFileSync('git', ['fetch', '--tags', 'origin'], { stdio: 'inherit' });
  if (sha !== run('git', ['rev-parse', '@{u}'])) throw new Error('Push HEAD to its upstream before publishing.');
  if (quiet('gh', ['release', 'view', tag])) {
    console.log(`Release ${tag} already exists; bump the version in package.json to publish.`);
    process.exit(0);
  }
}

const files = [`SfxChat-Setup-${version}.exe`, `SfxChat-${version}-x86_64.AppImage`, `SfxChat-${version}-amd64.deb`].map(name => join(releaseDir, name));
await Promise.all(files.map(file => rm(file, { force: true })));
execSync('npm run package', { stdio: 'inherit' });

// SFXCHAT_WSL_DISTRO selects a distro other than the default; its glibc sets the Linux floor.
const wsl = ['--cd', '~', ...(process.env.SFXCHAT_WSL_DISTRO ? ['-d', process.env.SFXCHAT_WSL_DISTRO] : []), '--'];
const linuxPath = path => run('wsl.exe', [...wsl, 'wslpath', '-a', path.replaceAll('\\', '/')]);
const archive = join(tmpdir(), `sfxchat-${version}-${sha.slice(0, 12)}.tar`);
try {
  execFileSync('git', ['archive', '--format=tar', '-o', archive, sha]);
  execFileSync('wsl.exe', [...wsl, 'sh', linuxPath(join(root, 'scripts/release-linux.sh')), linuxPath(archive), linuxPath(releaseDir)], { stdio: 'inherit' });
} finally { await rm(archive, { force: true }); }
for (const file of files) await access(file);
if (!publish) { console.log(`Built without publishing:\n${files.join('\n')}`); process.exit(0); }

const previous = (() => { try { return run('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD']); } catch { return ''; } })();
const changes = run('git', ['log', '--no-merges', '--format=- %s', ...(previous ? [`${previous}..HEAD`] : ['-n', '20'])]);
const notes = `## Install

- **Windows x64:** run \`SfxChat-Setup-${version}.exe\`. The installer is unsigned, so SmartScreen may ask you to choose **More info → Run anyway**.
- **Debian/Ubuntu x64:** \`sudo apt install ./SfxChat-${version}-amd64.deb\`, then open SfxChat from the app menu. Installs the \`sfxchat\` agent CLI.
- **Other Linux x64:** \`chmod +x SfxChat-${version}-x86_64.AppImage\` and run it (needs FUSE 2, e.g. \`libfuse2\`). Agent CLI/MCP integration needs the .deb.

Saving API keys on Linux needs a running Secret Service keyring such as GNOME Keyring or KWallet.

## Changes

${changes}
`;
const notesFile = join(tmpdir(), `sfxchat-${tag}-notes.md`);
await writeFile(notesFile, notes);
try {
  execFileSync('gh', ['release', 'create', tag, ...files, '--target', sha, '--title', `SfxChat ${tag}`, '--notes-file', notesFile], { stdio: 'inherit' });
} finally { await rm(notesFile, { force: true }); }
