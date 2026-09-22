import { useEffect, useRef, useState } from 'react'
import type { ChatContext, Snapshot } from '../shared/types'

const number = new Intl.NumberFormat('en-US')

export default function ChatContextMeter({ conversationId, draft, snapshot }: { conversationId: string; draft: string; snapshot: Snapshot }) {
  const [result, setResult] = useState<{ conversationId: string; context: ChatContext | null } | null>(null)
  const lastRequest = useRef(0)
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      lastRequest.current = Date.now()
      void window.sfx.chatContext(conversationId, draft).then(context => {
        if (!cancelled) setResult({ conversationId, context })
      }).catch(() => { if (!cancelled) setResult({ conversationId, context: null }) })
    }, Math.max(0, 150 - (Date.now() - lastRequest.current)))
    return () => { cancelled = true; clearTimeout(timer) }
  }, [conversationId, draft, snapshot])

  const context = result?.conversationId === conversationId ? result.context : undefined
  if (!context) return <div className="chat-context" data-testid="chat-context">{context === null ? 'Context estimate unavailable' : 'Calculating context…'}</div>
  const fraction = context.limit ? context.tokens / context.limit : null
  const over = fraction !== null && fraction > 1
  const detail = `${context.model}. Estimated with tiktoken: instructions, tools, conversation history, current board/jobs, streamed text, and draft. Hidden reasoning and server framing may differ.${context.includesHiddenReasoning ? ' Encrypted reasoning is present and excluded from this count.' : ''}${context.includesEstimatedMedia ? ' Attached images and audio clips are included by estimate, not tokenization.' : ''} ${context.limit ? 'Compared with the default Codex context size; advisory only.' : 'Default Codex context size is unknown for this model.'}`
  return <div className={`chat-context${over ? ' context-over' : fraction !== null && fraction >= 0.9 ? ' context-near' : ''}`} title={detail} data-testid="chat-context">
    <div className="context-label"><span>Context{context.includesHiddenReasoning ? '*' : ''}</span><span>~{number.format(context.tokens)} / {context.limit ? number.format(context.limit) : 'unknown'} tokens</span></div>
    {context.limit && <progress value={Math.min(context.tokens, context.limit)} max={context.limit} aria-label="Estimated context usage" aria-valuetext={`${number.format(context.tokens)} of ${number.format(context.limit)} tokens`} />}
    {over && <span className="context-warning">Above default context size</span>}
  </div>
}
