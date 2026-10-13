# Balance, space, and dynamics

Use after the arrangement communicates its intended roles. Start with relative
levels, register, timing, and density. Equalizing several equally busy parts is
not always the best way to make a foreground audible. Compression, saturation,
and limiting are choices, not mandatory improvements.

For “let a short attack remain clear over a sustained sound,” shorten the sustained
release or move its onset. If sustained overlap is important, put a compressor on
that track with the attack track as sidechain. Start with modest reduction; choose
release so the sustained signal returns when useful. This applies to musical and
nonmusical layers alike. Sidechain routing must remain acyclic.

Original experiment: two tracks share beat 0; retain the attack and change the
support's release from 0.8 to 0.15 seconds. Compare at matched preview gain.
If this removes wanted continuity, restore the envelope and try sidechain
compression instead. Preserve the note timing while evaluating that change.

Use sends for shared space and inserts for individual processing. Delay may
reinforce rhythm or obscure later events. Reverb may imply a room or wash out
material detail. If pumping distracts, reduce compression; if a mix becomes harsh,
reduce competing brightness before turning down every track.

Technical limits: this engine's EQ is a low-frequency blend, not a full parametric
console. Its limiter is a sample-peak ceiling, not certified true-peak mastering.
Peak/RMS, clipping, duration, near-silence, and boundary metrics are diagnostics,
not creative-quality or loudness-compliance scores.

Stems share a timeline and tail policy and exclude master effects. Dry track stems
plus separate send-bus stems sum to the pre-master mix; apply nonlinear master
processing once after summation. Never sum the full mix with its stems. Exact
loops omit tails, while one-shots retain the requested tail. Float WAV can retain
out-of-range values; 24-bit PCM clips outside full scale.

Sources: the implemented routing/encoding contracts, and [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/)
(read 2026-10-13) for filter mathematics. Production suggestions and the example
are original and require contextual listening.
