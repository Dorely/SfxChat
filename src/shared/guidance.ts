import design from '../../resources/skill/references/design.md?raw';
import sfx from '../../resources/skill/references/elevenlabs-sfx.md?raw';
import editing from '../../resources/skill/references/editing.md?raw';
import workflow from '../../resources/skill/references/workflow.md?raw';
import elevenlabs from '../../resources/skill/references/elevenlabs-music.md?raw';
import lyria from '../../resources/skill/references/gemini-lyria.md?raw';
import elevenVoice from '../../resources/skill/references/elevenlabs-voice.md?raw';
import geminiVoice from '../../resources/skill/references/gemini-voice.md?raw';
import musicCraft from '../../resources/skill/references/music-craft.md?raw';
import midiInstruments from '../../resources/skill/references/midi-instruments.md?raw';
import midiWorkflow from '../../resources/skill/references/midi-workflow.md?raw';

/** Canonical text: Vite and the CLI build both embed these exact installed references. */
export const guidanceDocuments: Record<string, string> = {
  'design.md': design, 'elevenlabs-sfx.md': sfx, 'editing.md': editing,
  'workflow.md': workflow, 'elevenlabs-music.md': elevenlabs, 'gemini-lyria.md': lyria,
  'elevenlabs-voice.md': elevenVoice, 'gemini-voice.md': geminiVoice,
  'music-craft.md': musicCraft, 'midi-instruments.md': midiInstruments, 'midi-workflow.md': midiWorkflow
};
