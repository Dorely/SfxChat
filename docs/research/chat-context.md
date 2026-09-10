# Chat context counter (2026-09-10)

The composer shows estimated current context plus the draft against the model's
default Codex context size. It does not display the larger API context maximum,
cumulative billed tokens, or account quota. It is advisory and does not truncate,
compact, or block sending.

## Model evidence

Fetched official [Codex models](https://developers.openai.com/codex/models),
[configuration reference](https://developers.openai.com/codex/config-reference),
and [pricing](https://developers.openai.com/codex/pricing) on 2026-09-10. The model
documentation establishes the model IDs, including `gpt-6-astra`. These pages did
not establish a current per-model double-usage threshold; the counter therefore
describes the default context size, without promising billing behavior.

The local Codex model catalog (`C:/Users/jonth/.codex/models_cache.json`, fetched
2026-09-10T17:15:45.177187800Z, client version 0.153.4) provided the following
non-secret model metadata. No account credentials or conversations were read.

| Model | `context_window` | `max_context_window` | `effective_context_window_percent` |
| --- | ---: | ---: | ---: |
| `gpt-5.6-luna` | 272,000 | 872,000 | 95 |
| `gpt-5.6-sol` | 272,000 | 872,000 | 95 |
| `gpt-6-astra` | 272,000 | 872,000 | 95 |

Use **272,000** as the requested base denominator. The 95% effective-window
reservation is not the model's base size. The checked values are pinned in
`src/shared/chat-models.ts`; there is no runtime dependency on a Codex installation
or its cache. Unrecognized saved model IDs retain a token estimate with an unknown
limit. Revalidate this table when changing the configured models.

## Counting and limitations

Pinned [js-tiktoken](https://github.com/dqbd/tiktoken/tree/main/js) 1.0.21 (MIT),
using its pure-JavaScript lite entry point and bundled `o200k_base` ranks. No CDN,
token-count API call, native tokenizer, or renderer tokenizer download is used.
The upstream README and npm metadata were checked on 2026-09-10.

Reference inspection found the same `o200k_base` family of text estimates in
Lorekeeper and PixelChat's `Tokens/TiktokenTokenCounter.cs`, implemented there
with Microsoft.ML.Tokenizers 2.0.0. Their inspected revisions are respectively
`ae6087b2e0458cb18b7784b70c41b31e0a37e7f4` and
`8f2eb708794f2857fd1d2910e19fd86b25f0d4cf`. No source was copied.

The main-process counter tokenizes instructions and serialized tool definitions
and wire history items. Request dispatch and counting share the instructions
builder, including current comparison board and job state. It adds the trimmed
draft in the same user-item shape used for sending. Active turns expose their
in-memory history and streamed text until output replaces that text. Completed
history and tool results come from persistence, with the same ledger repair as
dispatch. Display-only activity/error messages are excluded.

JSON tokenization is a deterministic approximation of Responses framing, not
provider usage. `o200k_base` is an estimation encoding for these models, not a
verified exact mapping of their private tokenizers. Encrypted reasoning is omitted
and flagged in the tooltip; its encoded bytes are not meaningful text tokens.
Unknown server overhead, hidden reasoning, and future output mean the indicator
cannot guarantee a request will fit or avoid higher usage costs. It is not a sum
of usage fields from previous requests.

The UI throttles recalculation to about 150 ms and ignores obsolete async results.
The main counter caches settled text counts with bounded retained strings and
entries. Its fixed IPC operation returns numeric/model metadata only. A failure
shows an unavailable state rather than a fabricated zero. At 90% the meter turns
amber; above 100% it turns red and labels the exceeded default size.
