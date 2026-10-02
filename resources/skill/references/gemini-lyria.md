Gemini Lyria specifics. Generation is single-turn: there is no continuation, section
re-editing, or inpainting, so a revision is a brand-new song and the user should be
told that plainly rather than promised a fix to one section. lyria-3.5 returns full
songs of roughly a couple of minutes; lyria-3-clip-preview always returns exactly 30
seconds and rejects any other requested length; lyria-3-pro-preview is the legacy
full-song model. There are no duration, instrumentation, or seed parameters: state the
target length in the prompt ("about 90 seconds") and write "Instrumental only, no
vocals." Use the vocabulary Lyria recognizes - named genres (deep house, boom bap,
shoegaze, orchestral score), named instruments (Rhodes piano, 303 acid bass, tabla,
muted trumpet), tempo and key, and structure as tags or arrows
([Intro] -> [Verse 1] -> [Chorus] -> [Outro]). Use numbered timing blocks such as
[0:00 - 0:10] Intro: ... when sections must land at known moments. Put custom lyrics
under a Lyrics: header with section tags, and prompt in the language the lyrics should
be sung in, because the model follows the prompt language. Requests for a specific
artist's voice or for copyrighted lyrics are blocked by safety filters, identical
prompts still vary, and every output carries an inaudible SynthID watermark worth
mentioning if provenance comes up. The clip model is the cheapest way to explore a
direction before committing to a full song.
