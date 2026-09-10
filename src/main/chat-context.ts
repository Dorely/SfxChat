import { Tiktoken } from 'js-tiktoken/lite';
import o200kBase from 'js-tiktoken/ranks/o200k_base';

let tokenizer: Tiktoken | undefined;

// A textual request estimate: Responses framing and private reasoning aren't
// reproducible locally. Never tokenize encrypted reasoning as if it were prose.
export class ContextTokenCounter {
  private cache = new Map<string, number>();
  private cachedCharacters = 0;

  private textTokens(text: string): number {
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;
    tokenizer ??= new Tiktoken(o200kBase);
    const count = tokenizer.encode(text, [], []).length;
    // Reuse settled history/tool counts between draft edits and stream updates.
    // Bound retained strings, including for long conversations.
    if (text.length <= 1_000_000) {
      while (this.cache.size && (this.cachedCharacters + text.length > 1_000_000 || this.cache.size >= 512)) {
        const key = this.cache.keys().next().value!;
        this.cache.delete(key); this.cachedCharacters -= key.length;
      }
      this.cache.set(text, count); this.cachedCharacters += text.length;
    }
    return count;
  }

  count(args: { instructions: string; tools: unknown[]; input: unknown[]; draft?: string; streamingText?: string }) {
    let includesHiddenReasoning = false;
    const serialize = (value: unknown) => JSON.stringify(value, (key, entry: unknown) => {
      if (key === 'encrypted_content') { if (entry) includesHiddenReasoning = true; return undefined; }
      return entry;
    });
    let tokens = this.textTokens(args.instructions) + this.textTokens(serialize(args.tools));
    for (const item of args.input) tokens += this.textTokens(serialize(item));
    if (args.streamingText) tokens += this.textTokens(serialize({ role: 'assistant', content: [{ type: 'output_text', text: args.streamingText }] }));
    if (args.draft?.trim()) tokens += this.textTokens(serialize({ role: 'user', content: [{ type: 'input_text', text: args.draft.trim() }] }));
    return { tokens, includesHiddenReasoning };
  }
}
