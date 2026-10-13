import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const browserAudio: Record<string, string> = {
  'arrangement-worker.js': 'src/renderer/arrangement-worker.ts',
  'arrangement-worklet.js': 'src/renderer/arrangement-worklet.ts',
};
const fluidFile = 'libfluidsynth-2.4.6.js';
async function browserAudioBytes(name: string) {
  if (name === fluidFile) return readFile(`node_modules/js-synthesizer/externals/${fluidFile}`);
  const result = await build({ entryPoints: [browserAudio[name]], bundle: true, platform: 'browser', format: 'iife', target: 'es2022', write: false });
  return result.outputFiles[0].contents;
}
function browserAudioPlugin(): Plugin {
  return {
    name: 'sfx-browser-audio',
    // Dev workers use fixed URLs because FluidSynth loads a classic worker script.
    // Compile on request so shared DSP edits cannot leave an old worker in memory.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.split('?')[0].slice(1) ?? '';
        if (!Object.hasOwn(browserAudio, name) && name !== fluidFile) return next();
        void browserAudioBytes(name).then(bytes => {
          response.setHeader('Content-Type', 'application/javascript');
          response.setHeader('Cache-Control', 'no-store');
          response.end(Buffer.from(bytes));
        }).catch(error => { server.config.logger.error(String(error)); response.statusCode = 500; response.end('Audio worker build failed.'); });
      });
    },
    async generateBundle() {
      for (const name of [...Object.keys(browserAudio), fluidFile]) this.emitFile({ type: 'asset', fileName: name, source: await browserAudioBytes(name) });
    },
  };
}
function offlineAudioPlugin(): Plugin {
  return {
    name: 'sfx-offline-audio',
    buildStart() {
      for (const file of ['src/main/arrangement-render-worker.ts', 'src/main/wav-reader.ts', 'src/shared/sound-engine.ts', 'src/shared/soundfont-engine.ts', 'src/shared/arrangement.ts']) this.addWatchFile(resolve(file));
    },
    async writeBundle() {
      await build({ entryPoints: ['src/main/arrangement-render-worker.ts'], outfile: 'out/main/arrangement-render-worker.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['js-synthesizer', 'js-synthesizer/*'] });
    },
  };
}
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin(), offlineAudioPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react(), browserAudioPlugin()] }
});
