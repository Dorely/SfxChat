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
import arranging from '../../resources/skill/references/arranging.md?raw';
import synthesis from '../../resources/skill/references/synthesis.md?raw';
import mixing from '../../resources/skill/references/mixing.md?raw';
import localWorkflow from '../../resources/skill/references/local-workflow.md?raw';
import soundDesign from '../../resources/skill/references/sound-design.md?raw';

/** Canonical text: Vite and the CLI build both embed these exact installed references. */
export const guidanceDocuments: Record<string, string> = {
  'design.md': design, 'elevenlabs-sfx.md': sfx, 'editing.md': editing,
  'workflow.md': workflow, 'elevenlabs-music.md': elevenlabs, 'gemini-lyria.md': lyria,
  'elevenlabs-voice.md': elevenVoice, 'gemini-voice.md': geminiVoice,
  'music-craft.md': musicCraft, 'midi-instruments.md': midiInstruments, 'midi-workflow.md': midiWorkflow,
  'arranging.md': arranging, 'synthesis.md': synthesis, 'mixing.md': mixing, 'local-workflow.md': localWorkflow, 'sound-design.md': soundDesign
};
export function selectGuidance(topics?: string[]) {
  if (!topics) return guidanceDocuments;
  return Object.fromEntries(topics.map(topic => {
    const name = topic.endsWith('.md') ? topic : `${topic}.md`;
    if (!Object.hasOwn(guidanceDocuments, name)) throw new Error(`Unknown guidance topic: ${topic}. Available: ${Object.keys(guidanceDocuments).join(', ')}`);
    return [name, guidanceDocuments[name]];
  }));
}
