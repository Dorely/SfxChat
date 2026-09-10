# Gemini audio-input API notes

This is a narrow note on using Gemini as an audio-observation helper in the SfxChat workbench. Model names, limits, pricing, supported audio types, response behavior, and terms are historical observations from the 2026-09-09 pilot context; revalidate the current Google documentation and account model list before implementation. See [sources](../sources.md), [architecture](../architecture.md), and the vendored [ElevenLabs skill](../../.agents/skills/elevenlabs-sound-effects/SKILL.md).

## Audio attachments

The inspected workflow sends each clip as an explicitly labeled content part followed by an inline audio object:

```json
[
  { "text": "CLIP A (the next attached WAV):" },
  {
    "inlineData": {
      "mimeType": "audio/wav",
      "data": "<base64 bytes>"
    }
  }
]
```

The request body places text and attachments under `contents[].parts[]`. Label every attachment immediately before its bytes, and state the requested output schema in text. The pilot used generated mono 16 kHz WAV clips for blind comparisons; it kept music local. That is a workflow boundary, not a claim that Gemini requires mono, accepts every WAV variant, or should receive music. Convert/measure locally and preserve the exact clip hash before encoding. Base64 increases request size, so use bounded clip duration and reject unexpectedly large inputs before upload.

The source uses the Google Generative Language `v1beta` models listing and `models/{model}:generateContent` operation. It reads `GEMINI_API_KEY` from the environment. Its query-string credential handling is a historical implementation detail, not a pattern to copy into logs or diagnostics; select a current documented authentication mechanism inside SfxChat's privileged provider adapter and redact secrets before logging errors.

Discover callable models from the account’s model listing and check for `generateContent`, then independently verify audio-input support; the method alone does not prove audio capability. Do not hard-code a model name as a permanent capability assumption. Model-dependent generation settings can include temperature, maximum output tokens, JSON response MIME type, and a thinking configuration. The pilot found that a seemingly reasonable thinking value could be rejected by the account/model, so validate settings against the selected model and handle capability errors explicitly.

## Responses and accounting

Parse defensively. Inspect `candidates[]`, `content.parts[]`, and each text part; record the candidate `finishReason`. Capture `usageMetadata` when present, including prompt and candidate token counts. Store the original response JSON, selected model, request timestamp, input hashes, attachment order, latency, and any HTTP error detail after redaction. A JSON response MIME request is a format preference, not proof that returned text is valid JSON: parse it, validate exact keys/types/ranges, and retain invalid responses for diagnosis.

Budget before upload and bound request count, input size, and output tokens. Pricing and token accounting vary by model and may change; the pilot's local cost guard used estimates from returned usage and was neither an invoice nor a guaranteed provider-enforced dollar cap. Count known usage and uncertain attempts conservatively before admitting more work. Cache completed results under immutable run names, refuse accidental overwrite, and make retries explicit. An HTTP failure or timeout may leave billing state uncertain; do not automatically replay a request without a deliberate retry policy and a new result identity.

## Calibration and interpretation limits

Include a byte-identical control in any blind audio measurement run, plus targeted transformations such as level, pitch, filter, onset, clipping, silence, or reversal. Reverse attachment order on repeat calls to expose label/order bias. The pilot’s identical control was judged non-identical in both orders, so the system did not earn trust as an objective detector. A response can report technical observations, but it cannot establish aesthetic fit, gameplay usefulness, mix quality, or approval. Keep listening and in-app audition as the authority for those decisions.

Gemini audio input is documented here as an observation/comparison path. Do not infer that this API generates music from audio input, and do not describe it as a music-generation capability. Local FFmpeg measurements and hashes remain useful even when cloud analysis is disabled.
