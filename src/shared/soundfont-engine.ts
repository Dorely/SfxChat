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
      fonts[track.id] = { synth, font: -1 };
      fonts[track.id].font = await synth.loadSFont(bytes);
    }
    return fonts;
  } catch (error) {
    for (const f of Object.values(fonts)) f.synth.close();
    throw error;
  }
}
