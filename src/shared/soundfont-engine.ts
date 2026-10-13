import { Synthesizer, waitForReady } from "js-synthesizer";
import type { Arrangement } from "./arrangement";
import type { FontState } from "./sound-engine";

export async function createFonts(
  document: Arrangement,
  sampleRate: number,
  bytes?: ArrayBuffer,
): Promise<Record<string, FontState>> {
  const tracks = document.tracks.filter(
    (t) => t.instrument.type === "soundfont",
  );
  if (!tracks.length) return {};
  if (!bytes) throw new Error("The arrangement requires its SoundFont bank.");
  await waitForReady();
  const fonts: Record<string, FontState> = {};
  try {
    for (const track of tracks) {
      const synth = new Synthesizer();
      synth.init(sampleRate, {
        reverbActive: false,
        chorusActive: false,
        initialGain: 0.5,
        polyphony: 64,
      });
      fonts[track.id] = { synth, font: -1, presets: new Set() };
      fonts[track.id].font = await synth.loadSFont(bytes);
      const bank = synth.getSFontObject(fonts[track.id].font);
      if (!bank) throw new Error('SoundFont could not be loaded.');
      fonts[track.id].presets = new Set(Array.from(bank.getPresetIterable(), p => `${p.bankNum}:${p.num}`));
    }
    return fonts;
  } catch (error) {
    for (const f of Object.values(fonts)) f.synth.close();
    throw error;
  }
}
