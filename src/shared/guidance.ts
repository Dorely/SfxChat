import design from '../../resources/skill/references/design.md?raw';
import sfx from '../../resources/skill/references/elevenlabs-sfx.md?raw';
import editing from '../../resources/skill/references/editing.md?raw';
import workflow from '../../resources/skill/references/workflow.md?raw';
import elevenlabs from '../../resources/skill/references/elevenlabs-music.md?raw';
import lyria from '../../resources/skill/references/gemini-lyria.md?raw';

/** Canonical text: Vite and the CLI build both embed these exact installed references. */
export const guidanceDocuments: Record<string, string> = {
  'design.md': design, 'elevenlabs-sfx.md': sfx, 'editing.md': editing,
  'workflow.md': workflow, 'elevenlabs-music.md': elevenlabs, 'gemini-lyria.md': lyria
};
