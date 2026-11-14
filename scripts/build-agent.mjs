import { build } from 'esbuild';
import { readFile, mkdir, writeFile, copyFile, access, readdir, rename, chmod, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const rawPlugin = { name: 'guidance-raw', setup(build) { build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' })); build.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' })); } };

const root = resolve('.'), output = join(root, 'out/agent');
const windows = process.platform === 'win32';
if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') throw new Error('Agent packaging requires Windows x64 or Linux x64.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const wasmManifest = JSON.parse(await readFile('third-party/wasm-synthesis/sources.json', 'utf8'));
for (const item of [{ path: wasmManifest.runtime.path, sha256: wasmManifest.runtime.sha256 }, ...wasmManifest.sources.map(s => ({ path: join('third-party/wasm-synthesis', s.name), sha256: s.sha256 }))]) {
  if (createHash('sha256').update(await readFile(item.path)).digest('hex') !== item.sha256) throw new Error(`SoundFont engine hash mismatch: ${item.path}`);
}
await mkdir(output, { recursive: true });
await build({ entryPoints: ['src/cli/index.ts'], outfile: join(output, 'cli.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', define: { SFXCHAT_VERSION: JSON.stringify(pkg.version) }, plugins: [{ name: 'guidance-raw', setup(build) { build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' })); build.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' })); } }] });
// Pin the redistributed runtime independently of the developer's Node installation. Checksums are
// from the official SHASUMS256.txt: the Windows binary itself, and the Linux archive it is unpacked from.
const nodeVersion = 'v24.21.0';
const runtimes = {
  win32: { file: 'win-x64/node.exe', sha256: 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32' },
  linux: { file: `node-${nodeVersion}-linux-x64.tar.xz`, sha256: 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6' }
};
const pinned = runtimes[process.platform];
const runtimeSource = `https://nodejs.org/dist/${nodeVersion}/${pinned.file}`;
const runtimePath = join(output, windows ? 'sfxchat-runtime.exe' : 'sfxchat-runtime');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const download = async () => {
  const response = await fetch(runtimeSource);
  if (!response.ok) throw new Error('Could not download the pinned Node runtime.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== pinned.sha256) throw new Error('Node runtime checksum mismatch.');
  return bytes;
};
if (windows) {
  let runtime;
  try { runtime = await readFile(runtimePath); } catch { /* first build */ }
  if (!runtime || sha256(runtime) !== pinned.sha256) await writeFile(runtimePath, await download());
} else {
  // Keep the verified archive as the cache; the binary is re-extracted from it on every build.
  const cache = join(root, 'out/native-sources'); await mkdir(cache, { recursive: true });
  const archive = join(cache, pinned.file);
  let cached;
  try { cached = await readFile(archive); } catch { /* first build */ }
  if (!cached || sha256(cached) !== pinned.sha256) await writeFile(archive, await download());
  const unpacked = join(cache, `node-${nodeVersion}-linux-x64`);
  await rm(unpacked, { recursive: true, force: true });
  execFileSync('tar', ['-xJf', archive, '-C', cache, `node-${nodeVersion}-linux-x64/bin/node`], { stdio: 'inherit' });
  await copyFile(join(unpacked, 'bin/node'), runtimePath); await chmod(runtimePath, 0o755);
}
const skillOutput = join(root, 'out/skill');
await mkdir(join(skillOutput, 'references'), { recursive: true });
// The runtime manifest is also the packaging/install/hash manifest; no second file list.
const guidanceBundle = await build({ entryPoints: ['src/shared/guidance.ts'], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [rawPlugin] });
const { guidanceDocuments: documents } = await import(`data:text/javascript;base64,${Buffer.from(guidanceBundle.outputFiles[0].text).toString('base64')}`);
for (const name of Object.keys(documents)) {
  await writeFile(join(skillOutput, 'references', name), documents[name]);
}
await copyFile('resources/skill/SKILL.md', join(skillOutput, 'SKILL.md'));
await writeFile(join(skillOutput, 'guidance.json'), JSON.stringify({ version: 1, hash: createHash('sha256').update(JSON.stringify(documents)).digest('hex') }, null, 2) + '\n');
const nodeLicense = join(root, 'third-party/node-LICENSE.txt');
await access(nodeLicense);
if (windows) await writeFile(join(output, 'sfxchat.cmd'), '@echo off\r\n"%~dp0sfxchat-runtime.exe" "%~dp0cli.cjs" %*\r\n');
else {
  // The .deb links /usr/bin/sfxchat here, so resolve the link before locating the runtime.
  await writeFile(join(output, 'sfxchat'), '#!/bin/sh\ndir=$(dirname "$(readlink -f "$0")")\nexec "$dir/sfxchat-runtime" "$dir/cli.cjs" "$@"\n');
  await chmod(join(output, 'sfxchat'), 0o755);
}
const manifest = { node: nodeVersion, sha256: pinned.sha256, source: runtimeSource };
await writeFile(join(output, 'runtime.json'), JSON.stringify(manifest, null, 2) + '\n');

let cmake = process.env.CMAKE || 'cmake';
try { execFileSync(cmake, ['--version'], { stdio: 'ignore' }); } catch {
  if (!windows) throw new Error('CMake is required to build the native helper. Install cmake or set CMAKE.');
  const vswhere = join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio/Installer/vswhere.exe');
  const vs = execFileSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
  cmake = join(vs, 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe');
}
const sources = join(root, 'out/native-sources'); await mkdir(sources, { recursive: true });
for (const directory of ['third-party/encoding', 'third-party/synthesis']) {
  for (const entry of JSON.parse(await readFile(join(directory, 'sources.json'), 'utf8'))) {
    const archive = resolve(directory, entry.name);
    if (createHash('sha256').update(await readFile(archive)).digest('hex') !== entry.sha256) throw new Error(`Source hash mismatch: ${entry.name}`);
    const marker = join(sources, `.${entry.name}.extracted`);
    try { await access(marker); continue; } catch { /* first build */ }
    execFileSync(cmake, ['-E', 'tar', entry.name.endsWith('.zip') ? 'xf' : 'xzf', archive], { cwd: sources, stdio: 'inherit' });
    await writeFile(marker, '');
  }
}
// The gcem archive unpacks under a revision-named directory; give CMake a stable path to point GCEM_INCLUDE_DIR at.
try { await access(join(sources, 'gcem')); }
catch {
  const revision = (await readdir(sources)).find(name => name.startsWith('gcem-'));
  if (revision) await rename(join(sources, revision), join(sources, 'gcem'));
}
// Visual Studio is multi-config (Release/ output folder); Linux uses a single-config Release build.
execFileSync(cmake, ['-S', 'native', '-B', 'out/native-build', ...(windows ? ['-A', 'x64'] : ['-DCMAKE_BUILD_TYPE=Release']), `-DSOURCES=${sources.replaceAll('\\', '/')}`, '-DCMAKE_POLICY_VERSION_MINIMUM=3.5'], { stdio: 'inherit' });
execFileSync(cmake, ['--build', 'out/native-build', '--config', 'Release', '--target', 'sfxchat-helper', '--parallel'], { stdio: 'inherit' });
if (windows) await copyFile('out/native-build/Release/sfxchat-helper.exe', join(output, 'sfxchat-helper.exe'));
else { await copyFile('out/native-build/sfxchat-helper', join(output, 'sfxchat-helper')); await chmod(join(output, 'sfxchat-helper'), 0o755); }
