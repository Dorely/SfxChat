import { build } from 'esbuild';
import { readFile, mkdir, writeFile, copyFile, access, readdir, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve('.'), output = join(root, 'out/agent');
await mkdir(output, { recursive: true });
await build({ entryPoints: ['src/cli/index.ts'], outfile: join(output, 'cli.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', plugins: [{ name: 'guidance-raw', setup(build) { build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' })); build.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' })); } }] });
// Pin the redistributed runtime independently of the developer's Node installation.
const nodeVersion = 'v24.21.0';
const nodeHash = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32';
const runtimePath = join(output, 'sfxchat-runtime.exe');
let runtime;
try { runtime = await readFile(runtimePath); } catch { /* first build */ }
if (!runtime || createHash('sha256').update(runtime).digest('hex') !== nodeHash) {
  const response = await fetch(`https://nodejs.org/dist/${nodeVersion}/win-x64/node.exe`);
  if (!response.ok) throw new Error('Could not download the pinned Node runtime.');
  runtime = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(runtime).digest('hex') !== nodeHash) throw new Error('Node runtime checksum mismatch.');
  await writeFile(runtimePath, runtime);
}
const skillOutput = join(root, 'out/skill');
await mkdir(join(skillOutput, 'references'), { recursive: true });
const documents = {};
for (const name of ['design.md', 'elevenlabs-sfx.md', 'editing.md', 'workflow.md', 'elevenlabs-music.md', 'gemini-lyria.md', 'elevenlabs-voice.md', 'gemini-voice.md', 'music-craft.md', 'midi-instruments.md', 'midi-workflow.md']) {
  documents[name] = await readFile(join(root, 'resources/skill/references', name), 'utf8');
  await writeFile(join(skillOutput, 'references', name), documents[name]);
}
await copyFile('resources/skill/SKILL.md', join(skillOutput, 'SKILL.md'));
await writeFile(join(skillOutput, 'guidance.json'), JSON.stringify({ version: 1, hash: createHash('sha256').update(JSON.stringify(documents)).digest('hex') }, null, 2) + '\n');
const nodeLicense = join(root, 'third-party/node-LICENSE.txt');
await access(nodeLicense);
await writeFile(join(output, 'sfxchat.cmd'), '@echo off\r\n"%~dp0sfxchat-runtime.exe" "%~dp0cli.cjs" %*\r\n');
const manifest = { node: nodeVersion, runtimeHash: nodeHash, source: `https://nodejs.org/dist/${nodeVersion}/win-x64/node.exe` };
await writeFile(join(output, 'runtime.json'), JSON.stringify(manifest, null, 2) + '\n');

if (process.platform !== 'win32') throw new Error('Agent packaging currently requires Windows x64.');
let cmake = process.env.CMAKE || 'cmake';
try { execFileSync(cmake, ['--version'], { stdio: 'ignore' }); } catch {
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
execFileSync(cmake, ['-S', 'native', '-B', 'out/native-build', '-A', 'x64', `-DSOURCES=${sources.replaceAll('\\', '/')}`, '-DCMAKE_POLICY_VERSION_MINIMUM=3.5'], { stdio: 'inherit' });
execFileSync(cmake, ['--build', 'out/native-build', '--config', 'Release', '--target', 'sfxchat-helper', '--parallel'], { stdio: 'inherit' });
await copyFile('out/native-build/Release/sfxchat-helper.exe', join(output, 'sfxchat-helper.exe'));
