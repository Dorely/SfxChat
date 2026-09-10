# Agentic audio editing: trimming evidence note

Research date: 2026-09-10. Sources were accessed on 2026-09-10. This note guides the
initial trimming milestone; it is evidence and design guidance, not proof that any
model can make reliable aesthetic decisions without audition.

## Findings

### Audio-language models need explicit temporal scaffolding

[TimeAudio: Bridging Temporal Gaps in Large Audio-Language Models](https://arxiv.org/abs/2511.11039)
(2025) identifies timestamp representation, model architecture, and training data as
key causes of weak temporal localization in large audio-language models. It adds
temporal markers, absolute time-aware encoding, and segment-level token merging. The
result supports a conservative interface: send absolute offsets and bounded windows
to the assistant, then refine each proposed boundary in a shorter, re-based window.
The paper does not establish that its method, or a general model, is accurate enough
for sample-level production edits.

[Audio Flamingo 2](https://openreview.net/pdf/303ac4970502bea74c0e0c44636ac53234a485d9.pdf)
(2025) evaluates temporal order, temporal attribute changes, temporal referring, and
temporal grounding as distinct tasks. [Audio Flamingo 3](https://research.nvidia.com/labs/adlr/AF3/)
(2025) likewise treats grounding as a separate temporal-reasoning capability and
uses windowed long-audio processing. These works suggest that “find the focused event”
and “return an exact cut point” should be separate operations in SfxChat. Their
training and evaluation architecture is useful evidence about task decomposition,
not a guarantee about the hosted assistant currently used by SfxChat.

[Music Flamingo](https://research.nvidia.com/labs/adlr/MF/) (2025) adds absolute-time
information to audio tokens with Rotary Time Embeddings to improve localization of
musical changes. This is further motivation for keeping an internal coordinate system
in sample frames (or integer milliseconds) and only formatting human-readable times
at the model boundary.

### Textual measurements are a useful first representation

The current [Gemini audio understanding documentation](https://ai.google.dev/gemini-api/docs/audio)
(updated 2026-09-02) documents non-speech analysis, segment questions, structured
outputs, and `MM:SS` timestamp references. It also states that audio is downsampled to
16 kHz data resolution and multichannel audio is combined to mono. These transformations
make the model useful for coarse semantic observations, but they weaken confidence in
fine waveform-edge decisions. The same documentation describes a 20 MB inline request
limit and recommends file upload for reusable or larger audio.

For the first milestone, the assistant should receive a versioned, bounded JSON
summary generated locally: source duration, sample rate, channel count, and
amplitude min/max/peak/RMS windows. Every interval should include seconds and
sample-frame coordinates plus the analysis window size. This is inspectable, cheap
to regenerate, and does not require treating a rendered image as a measurement
source. SfxChat's tool accepts `startSeconds` and `endSeconds`; the main process
validates and converts them to sample frames. The assistant can explain its
reasoning and uncertainty in chat.
Waveform images, silence/onset detection, and semantic audio hearing are future
options rather than first-milestone inputs.

### Waveform UI should support human precision and optional model context

[wavesurfer.js](https://wavesurfer.xyz/docs/) v7 (documentation current at access)
provides waveform rendering with Regions, Timeline, Minimap, Spectrogram, Hover, and
Zoom plugins. Its repository also documents a visible-range API and windowed rendering
for long spectrograms. The project warns that VBR audio can produce waveform/audio
mismatch. Therefore the UI should use decoded PCM or generated peak data tied to the
decoded duration, and should present a timeline with draggable handles and a zoomed
boundary view.

A waveform PNG can be supplied to the assistant later as supporting context, with a
clearly labeled time axis and overview/zoom variants. It should remain secondary
to structured timestamps and amplitude data. The current research does not justify
assuming that a vision-capable model reads pixel coordinates more precisely than it
reads explicit intervals.

### Local deterministic filters cover the actual trim operation

[FFmpeg’s filter documentation](https://ffmpeg.org/ffmpeg-filters.html) documents
`atrim` as selecting one continuous audio section, `silencedetect` for reporting quiet
regions, and `silenceremove` for configurable silence removal at the beginning, middle,
or end. These filters give the main process a deterministic implementation for exact
interval rendering and “tighten silence” suggestions. The current local engine uses
decoded PCM and WAV writing rather than an FFmpeg runtime dependency. The original
file should remain immutable; each applied interval should create a derived asset
with revision parent, source offsets, and output hash.

[AUDIT: Audio Editing by Following Instructions with Latent Diffusion Models](https://arxiv.org/abs/2304.00830)
(2023) trains on instruction/input/output triplets and aims to preserve regions that
do not require editing. It covers generative operations such as dropping, replacing,
and inpainting. It is relevant as evidence for constrained edit descriptions, but it
is not a reason to introduce generative rewriting for this trimming milestone.

## Provisional implementation decision

Use a shared main-process trim operation driven by validated sample-frame intervals.
Expose it both to the user’s editor and to an assistant tool. Start with local
amplitude min/max/peak/RMS text plus seconds and sample frames. Bounded zoom requests
measure smaller absolute intervals at finer resolution. Apply a trim requested by the user or assistant directly
as a new derived asset, preserving originals and provenance; the current flow does not
require a separate approval step.

This note makes no claim to have heard any audio. Actual listening and user approval
remain the authority for whether a shorter clip is focused or usable. Semantic audio
“hearing” or generative editing can be evaluated later behind explicit capability and
quality checks.
