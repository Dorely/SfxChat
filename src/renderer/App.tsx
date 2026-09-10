import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Asset, AssetPatch, GenerationInput, Job, Review, Snapshot } from '../shared/types'
import type { TrimInput } from '../shared/types'
import TrimEditor from './TrimEditor'

type Tab = 'library' | 'playground'

const emptySnapshot: Snapshot = {
  conversations: [], messages: [], assets: [], jobs: [], playground: {},
  settings: { codexReady: false, elevenLabsReady: false, secureStorageAvailable: false, loginPending: false, model: 'backend default', error: null },
  activeTurns: [],
}

const api = () => window.sfx

function timeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function shortDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDuration(duration: number | null) {
  if (duration == null) return 'Auto duration'
  return `${duration.toFixed(duration % 1 ? 1 : 0)}s`
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    spark: '✦', plus: '+', search: '⌕', settings: '⚙', send: '↑', stop: '■', play: '▶', pause: 'Ⅱ', download: '↓', close: '×', drag: '⋮⋮', check: '✓', x: '×', back: '‹', import: '↥', library: '▤', waveform: '∿', chat: '◌', edit: '✎', undo: '↶', forward: '↷', trash: '⌫', arrow: '→', info: 'ⓘ', lock: '▣',
  }
  return <span className={`icon icon-${name}`} aria-hidden="true">{paths[name] || '·'}</span>
}

function StatusPill({ status }: { status: Job['status'] }) {
  return <span className={`status-pill status-${status}`}><span className="status-dot" />{status}</span>
}

function Waveform({ active, url }: { active?: boolean; url: string }) {
  const [bars, setBars] = useState<number[]>([])
  useEffect(() => {
    let cancelled = false
    const decode = async () => {
      try {
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AudioContextClass) return
        const response = await fetch(url)
        if (!response.ok) return
        const buffer = await response.arrayBuffer()
        const context = new AudioContextClass()
        let next: number[]
        try {
          const decoded = await context.decodeAudioData(buffer)
          const samples = decoded.getChannelData(0)
          next = Array.from({ length: 48 }, (_, index) => {
            const start = Math.floor(index * samples.length / 48)
            const end = Math.max(start + 1, Math.floor((index + 1) * samples.length / 48))
            let peak = 0
            for (let sample = start; sample < end; sample += 1) peak = Math.max(peak, Math.abs(samples[sample] || 0))
            return Math.round(16 + peak * 72)
          })
        } finally { await context.close().catch(() => undefined) }
        if (!cancelled) setBars(next)
      } catch { /* unavailable media stays a quiet waveform */ }
    }
    void decode()
    return () => { cancelled = true }
  }, [url])
  return <div className={`waveform ${active ? 'waveform-active' : ''} ${bars.length ? '' : 'waveform-loading'}`} aria-hidden="true">{(bars.length ? bars : Array.from({ length: 48 }, () => 16)).map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
}

function AudioCard({ asset, onSelect, selected, onPlay, playerKey, isPlaying, compact = false }: { asset: Asset; onSelect: () => void; selected: boolean; onPlay: (key: string, playing: boolean) => void; playerKey?: string; isPlaying: boolean; compact?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const effectivePlayerKey = playerKey || asset.id
  const [position, setPosition] = useState(0)
  const [loop, setLoop] = useState(false)
  const [gain, setGain] = useState(1)
  const [loaded, setLoaded] = useState(false)
  const url = `sfx-media://asset/${asset.id}`

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) void audio.play().catch(() => onPlay(effectivePlayerKey, false))
    else audio.pause()
  }, [isPlaying, asset.id, onPlay, effectivePlayerKey])

  useEffect(() => { if (audioRef.current) audioRef.current.volume = gain }, [gain])

  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation()
    onPlay(effectivePlayerKey, !isPlaying)
  }

  return <article data-asset-id={asset.id} className={`asset-card ${selected ? 'asset-selected' : ''} ${compact ? 'asset-compact' : ''}`} onClick={onSelect}>
    <audio ref={audioRef} src={url} loop={loop} preload="metadata" onLoadedMetadata={() => setLoaded(true)} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onEnded={() => onPlay(effectivePlayerKey, false)} />
    <div className="asset-card-top">
      <button className={`play-button ${isPlaying ? 'playing' : ''}`} onClick={toggle} aria-label={`${isPlaying ? 'Pause' : 'Play'} ${asset.name}`}><Icon name={isPlaying ? 'pause' : 'play'} /></button>
      <div className="asset-title"><strong>{asset.name || 'Untitled sound'}</strong><span>{asset.format.toUpperCase()} · {formatDuration(asset.duration)}</span></div>
      <span className={`review-mark review-${asset.review}`} title={asset.review}>{asset.review === 'accepted' ? '✓' : asset.review === 'rejected' ? '×' : '·'}</span>
    </div>
    <Waveform active={isPlaying} url={url} />
    <>
      <input className="scrub" type="range" min="0" max={loaded && audioRef.current?.duration ? audioRef.current.duration : asset.duration || 1} step="0.01" value={position} onChange={(event) => { const next = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = next; setPosition(next) }} aria-label="Seek audio" />
      <div className="asset-card-bottom"><span>{formatDuration(asset.duration)}</span><div className="asset-tags">{asset.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div><span className="asset-date">{shortDate(asset.createdAt)}</span></div>
      <div className="preview-controls"><label><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} /> Loop</label><label className="gain-control">Gain <input type="range" min="0" max="1" step="0.05" value={gain} onChange={event => setGain(Number(event.target.value))} aria-label="Preview gain" /></label></div>
    </>
  </article>
}

function ChatSidebar({ snapshot, selectedId, onSelect, onNew, onSend, onStop, onSettings }: { snapshot: Snapshot; selectedId: string | null; onSelect: (id: string) => void; onNew: () => void; onSend: (text: string) => Promise<boolean>; onStop: () => void; onSettings: () => void }) {
  const [text, setText] = useState('')
  const historyRef = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  const previousConversation = useRef(selectedId)
  const messages = snapshot.messages.filter(message => message.conversationId === selectedId)
  const active = selectedId ? snapshot.activeTurns.includes(selectedId) : false
  useLayoutEffect(() => {
    if (previousConversation.current !== selectedId) {
      previousConversation.current = selectedId
      followOutput.current = true
    }
    const history = historyRef.current
    if (history && followOutput.current) history.scrollTop = history.scrollHeight
  }, [selectedId, snapshot.messages, active])
  const submit = async () => {
    if (!text.trim() || active) return
    const draft = text.trim()
    followOutput.current = true
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight
    if (await onSend(draft)) setText('')
  }
  return <aside className="chat-sidebar">
    <div className="brand-row"><div className="brand-mark"><Icon name="spark" /></div><div><strong>SFXCHAT</strong><span>sound workbench</span></div><span className="live-indicator" title="Local workbench ready" /></div>
    <div className="sidebar-heading"><span>Conversations</span><button className="icon-button" onClick={onNew} aria-label="New conversation"><Icon name="plus" /></button></div>
    <div className="conversation-list">
      {snapshot.conversations.length === 0 ? <div className="empty-conversations"><div className="empty-icon"><Icon name="chat" /></div><p>Your sound design sessions will appear here.</p><button className="text-button" onClick={onNew}>Start a conversation <Icon name="arrow" /></button></div> : snapshot.conversations.map(conversation => <button key={conversation.id} className={`conversation-row ${conversation.id === selectedId ? 'conversation-active' : ''}`} onClick={() => onSelect(conversation.id)}><span className="conversation-dot" /><span className="conversation-copy"><strong>{conversation.title || 'Untitled conversation'}</strong><small>{timeLabel(conversation.createdAt)}</small></span><span className="conversation-chevron">›</span></button>)}
    </div>
    <div className="sidebar-chat">
      {selectedId ? <>
        <div className="chat-history" ref={historyRef} aria-live="polite" onScroll={event => {
          const history = event.currentTarget
          followOutput.current = history.scrollHeight - history.scrollTop - history.clientHeight <= 24
        }}>
          {messages.length === 0 && <div className="chat-welcome"><Icon name="spark" /><p>Describe a sound and I’ll help shape it into a usable brief.</p></div>}
          {messages.map(message => <div key={message.id} className={`message message-${message.role}`}><span className="message-role">{message.role === 'user' ? 'You' : message.role === 'tool' ? 'Activity' : 'SfxChat'}</span><p>{message.text}</p>{message.status !== 'completed' && <span className={`message-status message-${message.status}`}>{message.status}</span>}</div>)}
          {active && <div className="typing-row"><span className="typing-dots"><i /><i /><i /></span> Working on it…</div>}
        </div>
        <div className="chat-composer"><textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder="Describe a sound…" aria-label="Message SfxChat" rows={2} /><div className="composer-footer"><span>Enter to send · Shift + Enter for new line</span>{active ? <button className="stop-button" onClick={onStop}><Icon name="stop" /> Stop</button> : <button className="send-button" onClick={() => void submit()} disabled={!text.trim()} aria-label="Send message"><Icon name="send" /></button>}</div></div>
      </> : <div className="no-chat-selected"><Icon name="chat" /><p>Select a conversation to begin.</p></div>}
    </div>
    <div className="sidebar-footer"><span className="connection-dot" /> <span>{snapshot.settings.codexReady ? 'Codex connected' : 'Offline mode'}</span><button className="icon-button" onClick={onSettings} aria-label="Open settings"><Icon name="settings" /></button></div>
  </aside>
}

function Library({ assets, selectedId, query, setQuery, onSelect, onImport, onPlay, playingId, onOpenInspector, onAddToPlayground, inPlayground }: { assets: Asset[]; selectedId: string | null; query: string; setQuery: (value: string) => void; onSelect: (id: string) => void; onImport: () => void; onPlay: (key: string, playing: boolean) => void; playingId: string | null; onOpenInspector: () => void; onAddToPlayground: () => void; inPlayground: boolean }) {
  const playingKey = playingId
  const [searchAssets, setSearchAssets] = useState<Asset[]>(assets)
  useEffect(() => {
    let cancelled = false
    if (!query.trim()) { setSearchAssets(assets); return () => { cancelled = true } }
    const timer = window.setTimeout(async () => {
      try { const found = await api()?.searchAssets(query.trim()); if (!cancelled && found) setSearchAssets(found) }
      catch { if (!cancelled) setSearchAssets([]) }
    }, 140)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [assets, query])
  const [reviewFilter, setReviewFilter] = useState<'all' | Review>('all')
  const filtered = reviewFilter === 'all' ? searchAssets : searchAssets.filter(asset => asset.review === reviewFilter)
  return <section className="workspace-panel library-panel"><div className="panel-header"><div><p className="eyebrow">Your sound library</p><h1>Library <span>{assets.length}</span></h1></div><div className="header-actions"><button className="secondary-button" onClick={onImport}><Icon name="import" /> Import audio</button><button className="primary-button" onClick={onOpenInspector} disabled={!selectedId}><Icon name="edit" /> Inspect</button><button className="secondary-button" onClick={onAddToPlayground} disabled={!selectedId || inPlayground}><Icon name="plus" /> Add to playground</button></div></div><div className="library-toolbar"><label className="search-field"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search sounds, tags, prompts…" aria-label="Search library" /></label><span className="toolbar-count">{filtered.length} {filtered.length === 1 ? 'sound' : 'sounds'}</span><select className="filter-button" value={reviewFilter} onChange={event => setReviewFilter(event.target.value as 'all' | Review)} aria-label="Filter library by review"><option value="all">All sounds</option><option value="unreviewed">Unreviewed</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></div><div className="asset-grid">{filtered.length === 0 ? <div className="empty-state"><div className="empty-icon"><Icon name="waveform" /></div><h2>{assets.length ? 'No sounds found' : 'Your library is ready'}</h2><p>{assets.length ? 'Try a different search or clear the filter.' : 'Generate a sound in the Playground or import an existing WAV or MP3 to get started.'}</p>{!assets.length && <button className="secondary-button" onClick={onImport}><Icon name="import" /> Import a sound</button>}</div> : filtered.map(asset => <AudioCard key={asset.id} asset={asset} selected={asset.id === selectedId} onSelect={() => onSelect(asset.id)} onPlay={onPlay} playerKey={`library-${asset.id}`} isPlaying={playingKey === `library-${asset.id}`} />)}</div></section>
}

function Playground({ assets, jobs, conversationId, selectedId, playgroundIds, onSelect, onPlay, playingId, onGenerate, onCancelJob, onRemove, onMove, onOpenInspector }: { assets: Asset[]; jobs: Job[]; conversationId: string | null; selectedId: string | null; playgroundIds: string[]; onSelect: (id: string) => void; onPlay: (key: string, playing: boolean) => void; playingId: string | null; onGenerate: (input: GenerationInput) => Promise<boolean>; onCancelJob: (id: string) => void; onRemove: (id: string) => void; onMove: (id: string, direction: -1 | 1) => void; onOpenInspector: () => void }) {
  const playingKey = playingId
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState(1)
  const [duration, setDuration] = useState('auto')
  const [loop, setLoop] = useState(false)
  const [influence, setInfluence] = useState(0.3)
  const sounds = playgroundIds.map(id => assets.find(asset => asset.id === id)).filter((asset): asset is Asset => Boolean(asset))
  const activeJobs = jobs.filter(job => job.conversationId === conversationId && (job.status === 'queued' || job.status === 'running'))
  const terminalJobs = jobs.filter(job => job.conversationId === conversationId && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'uncertain'))
  const generate = async () => { const seconds = duration === 'auto' ? null : Number(duration); if (!prompt.trim() || !conversationId || (seconds !== null && (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 30))) return; if (await onGenerate({ prompt: prompt.trim(), count, duration: seconds, loop, influence })) setPrompt('') }
  return <section className="workspace-panel playground-panel"><div className="panel-header"><div><p className="eyebrow">Compare & refine</p><h1>Playground <span>{sounds.length}</span></h1></div><div className="header-actions"><button className="secondary-button" onClick={onOpenInspector} disabled={!selectedId}><Icon name="edit" /> Inspector</button></div></div>{!conversationId ? <div className="empty-state panel-empty"><div className="empty-icon"><Icon name="chat" /></div><h2>Choose a conversation first</h2><p>Your playground is scoped to the active design session.</p></div> : <><div className="playground-grid">{sounds.length === 0 ? <div className="empty-state playground-empty"><div className="empty-icon"><Icon name="waveform" /></div><h2>A blank canvas for sound</h2><p>Generate a few candidates below, then arrange them here to compare.</p></div> : sounds.map((asset, index) => <div className="playground-slot" key={asset.id}><div className="slot-label"><span>Candidate {String(index + 1).padStart(2, '0')}</span><div><button className="mini-button" onClick={() => onMove(asset.id, -1)} disabled={index === 0} aria-label="Move candidate left">←</button><button className="mini-button" onClick={() => onMove(asset.id, 1)} disabled={index === sounds.length - 1} aria-label="Move candidate right">→</button><button className="mini-button" onClick={() => onRemove(asset.id)} aria-label="Remove from playground"><Icon name="close" /></button></div></div><AudioCard asset={asset} selected={asset.id === selectedId} onSelect={() => onSelect(asset.id)} onPlay={onPlay} playerKey={`playground-${asset.id}`} isPlaying={playingKey === `playground-${asset.id}`} compact /></div>)}</div><div className="generation-zone"><div className="generation-title"><div><span className="section-kicker"><Icon name="spark" /> Create sound</span><h2>Turn an idea into candidates</h2></div><span className="generation-note">{snapshotProviderNote()}</span></div><div className="generation-form"><textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="e.g. soft rain on a greenhouse roof, close and detailed…" rows={2} aria-label="Sound generation prompt" /><div className="generation-options"><label>Count <input type="number" min="1" step="1" value={count} onChange={event => setCount(Math.max(1, Number(event.target.value) || 1))} aria-label="Candidate count" /></label><label>Duration <input type="number" min="0.5" max="30" step="0.5" value={duration === 'auto' ? '' : duration} onChange={event => setDuration(event.target.value || 'auto')} placeholder="Auto" aria-label="Duration seconds" /><span className="auto-duration"><button type="button" className={duration === 'auto' ? 'auto-active' : ''} onClick={() => setDuration('auto')}>Auto</button> · 0.5–30s</span></label><label className="check-option"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} /> Loop</label><label className="influence-option">Influence <input type="range" min="0" max="1" step="0.05" value={influence} onChange={event => setInfluence(Number(event.target.value))} /><output>{influence.toFixed(2)}</output></label><button className="primary-button generate-button" onClick={() => void generate()} disabled={!prompt.trim()}><Icon name="spark" /> Generate</button></div></div></div>{activeJobs.length > 0 && <div className="jobs-strip"><div><span className="spinner" /> <strong>Generating {activeJobs.length} {activeJobs.length === 1 ? 'candidate' : 'candidates'}</strong><span className="job-copy">Your results will appear here when ready.</span></div>{activeJobs.map(job => <button key={job.id} className="cancel-job" onClick={() => onCancelJob(job.id)}>Cancel</button>)}</div>}{terminalJobs.length > 0 && <div className="job-history"><span className="field-label">Recent jobs</span>{terminalJobs.slice(-5).reverse().map(job => <div className="job-history-row" key={job.id}><StatusPill status={job.status} /><span>{job.input.prompt}</span>{job.assetId && <code>{job.assetId.slice(0, 8)}</code>}{job.error && <em>{job.error}</em>}</div>)}</div>}</>}</section>
}

function snapshotProviderNote() { return 'Provider settings are managed in Settings' }

function Inspector({ asset, onClose, onSave, onExport, onPlay, isPlaying, playingKey, onRegenerate, onTrim }: { asset: Asset | null; onClose: () => void; onSave: (patch: AssetPatch) => void; onExport: () => void; onPlay: (id: string, playing: boolean) => void; isPlaying: boolean; playingKey: string | null; onRegenerate: (input: GenerationInput) => void; onTrim: (input: TrimInput) => Promise<Asset | null> }) {
  const [name, setName] = useState(asset?.name || '')
  const [description, setDescription] = useState(asset?.description || '')
  const [tags, setTags] = useState(asset?.tags.join(', ') || '')
  const [collections, setCollections] = useState(asset?.collections.join(', ') || '')
  const [feedback, setFeedback] = useState(asset?.feedback || '')
  const [review, setReview] = useState<Review>(asset?.review || 'unreviewed')
  const [trimOpen, setTrimOpen] = useState(false)
  useEffect(() => { if (asset) { setName(asset.name); setDescription(asset.description); setTags(asset.tags.join(', ')); setCollections(asset.collections.join(', ')); setFeedback(asset.feedback); setReview(asset.review); setTrimOpen(false) } }, [asset?.id])
  if (!asset) return null
  const save = () => onSave({ name: name.trim(), description: description.trim(), tags: tags.split(',').map(value => value.trim()).filter(Boolean), collections: collections.split(',').map(value => value.trim()).filter(Boolean), feedback: feedback.trim(), review })
  return <div className="inspector-drawer"><div className="drawer-header"><div><p className="eyebrow">Asset inspector</p><h2>{asset.name || 'Untitled sound'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close inspector"><Icon name="close" /></button></div><div className="drawer-scroll"><AudioCard asset={asset} selected onSelect={() => undefined} onPlay={onPlay} isPlaying={isPlaying} /><div className="trim-action"><button className="primary-button" onClick={() => setTrimOpen(true)}><Icon name="edit" /> Trim as new asset</button></div><div className="form-section"><label>Name<input value={name} onChange={event => setName(event.target.value)} /></label><label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} /></label><label>Tags <span className="field-hint">comma separated</span><input value={tags} onChange={event => setTags(event.target.value)} /></label><label>Collections <span className="field-hint">comma separated</span><input value={collections} onChange={event => setCollections(event.target.value)} /></label><label>Feedback<textarea value={feedback} onChange={event => setFeedback(event.target.value)} rows={3} placeholder="What should change in the next pass?" /></label></div><div className="review-section"><span className="field-label">Review decision</span><div className="review-buttons"><button className={review === 'accepted' ? 'review-active accepted' : ''} onClick={() => setReview('accepted')}><Icon name="check" /> Accept</button><button className={review === 'rejected' ? 'review-active rejected' : ''} onClick={() => setReview('rejected')}><Icon name="x" /> Reject</button><button className={review === 'unreviewed' ? 'review-active unreviewed' : ''} onClick={() => setReview('unreviewed')}>Unreviewed</button></div></div><div className="provenance-section"><div className="provenance-heading"><span className="field-label">Provenance</span><span className="immutable-badge"><Icon name="lock" /> Immutable</span></div><dl><dt>Source</dt><dd>{asset.source} · {asset.format.toUpperCase()}</dd><dt>Prompt</dt><dd>{asset.prompt || 'No prompt recorded'}</dd><dt>Provider / model</dt><dd>{[asset.provider, asset.model].filter(Boolean).join(' · ') || 'Not available'}</dd><dt>Created</dt><dd>{shortDate(asset.createdAt)}</dd><dt>Hash</dt><dd className="hash-value">{asset.hash || 'Not available'}</dd>{asset.parentId && <><dt>Parent asset</dt><dd>{asset.parentId}</dd></>}{asset.edit && <><dt>Edit</dt><dd>{secondsLabel(asset.edit.startFrame / asset.edit.sampleRate)}–{secondsLabel(asset.edit.endFrame / asset.edit.sampleRate)} s · {asset.edit.fadeInFrames || asset.edit.fadeOutFrames ? 'faded' : 'no fades'}</dd></>}</dl></div></div><div className="drawer-footer"><button className="secondary-button" onClick={onExport}><Icon name="download" /> Export original</button><button className="secondary-button" onClick={() => onRegenerate({ prompt: feedback.trim() || asset.prompt, count: 1, duration: asset.duration && asset.duration >= 0.5 ? asset.duration : null, loop: Boolean(asset.request?.loop), influence: asset.request?.influence ?? 0.3, parentId: asset.id })}><Icon name="undo" /> Regenerate</button><button className="primary-button" onClick={save}>Save changes</button></div>{trimOpen && <TrimEditor asset={asset} onClose={() => setTrimOpen(false)} onSave={onTrim} onPlay={onPlay} playingKey={playingKey} />}</div>
}

function secondsLabel(value: number) { return Number.isFinite(value) ? value.toFixed(3) : '0.000' }

function SettingsDialog({ snapshot, onClose, onLogin, onCancelLogin, onLogout, onSaveKey, onSaveModel, onOpenLogs }: { snapshot: Snapshot; onClose: () => void; onLogin: () => void; onCancelLogin: () => void; onLogout: () => void; onSaveKey: (key: string) => void; onSaveModel: (model: string) => void; onOpenLogs: () => void }) {
  const [key, setKey] = useState('')
  const [model, setModel] = useState(snapshot.settings.model)
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="drawer-header"><div><p className="eyebrow">Workspace</p><h2 id="settings-title">Settings</h2></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><Icon name="close" /></button></div><div className="settings-body"><section className="settings-section"><div className="settings-section-heading"><div><h3>Codex account</h3><p>Connect the assistant for sound design guidance and orchestration.</p></div><span className={`readiness ${snapshot.settings.codexReady ? 'ready' : ''}`}><i />{snapshot.settings.codexReady ? 'Ready' : 'Not connected'}</span></div>{snapshot.settings.loginPending ? <button className="secondary-button" onClick={onCancelLogin}>Cancel sign in</button> : snapshot.settings.codexReady ? <button className="secondary-button" onClick={onLogout}>Log out</button> : <button className="primary-button" onClick={onLogin}>Connect Codex</button>}</section><section className="settings-section"><div className="settings-section-heading"><div><h3>ElevenLabs</h3><p>Your key is saved securely by the desktop app. It never appears here after saving.</p></div><span className={`readiness ${snapshot.settings.elevenLabsReady ? 'ready' : ''}`}><i />{snapshot.settings.elevenLabsReady ? 'Key saved' : 'Not configured'}</span></div><div className="secret-row"><input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder={snapshot.settings.elevenLabsReady ? '••••••••••••••••' : 'Paste API key'} aria-label="ElevenLabs API key" /><button className="secondary-button" onClick={() => { if (key) { onSaveKey(key); setKey('') } }}>{snapshot.settings.elevenLabsReady ? 'Replace key' : 'Save key'}</button></div></section><section className="settings-section"><div className="settings-section-heading"><div><h3>Chat model</h3><p>Leave this to backend default unless you need a specific model.</p></div></div><div className="model-row"><select value={model} onChange={event => setModel(event.target.value)}><option value="backend default">Backend default</option><option value="gpt-5.6-luna">GPT-5.6 Luna</option><option value="gpt-5.6-sol">GPT-5.6 Sol</option><option value="gpt-5.6-astra">GPT-6 Astra</option></select><button className="secondary-button" onClick={() => onSaveModel(model)}>Save model</button></div></section><section className="settings-section"><h3>Diagnostics</h3><p>Local logs keep failure details and request IDs. Credentials are redacted, and older logs rotate automatically.</p><button className="secondary-button" onClick={onOpenLogs}>Open diagnostic logs</button></section><p className="secure-note"><Icon name="lock" /> Secure storage: {snapshot.settings.secureStorageAvailable ? 'available' : 'waiting for desktop host'}</p>{snapshot.settings.error && <p className="settings-error"><Icon name="info" /> {snapshot.settings.error}</p>}</div></section></div>
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot)
  const [uiError, setUiError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('library')
  const [query, setQuery] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(34)
  const refreshSerial = useRef(0)
  const resizingRef = useRef(false)

  const refresh = useCallback(async () => {
    const serial = ++refreshSerial.current
    try { const next = await api()?.snapshot(); if (next && serial === refreshSerial.current) { setSnapshot(next); setConversationId(current => current && next.conversations.some(item => item.id === current) ? current : (next.conversations[0]?.id || null)); setSelectedAssetId(current => current && next.assets.some(item => item.id === current) ? current : null) } } catch (error) { setUiError(error instanceof Error ? error.message : 'Unable to refresh the workbench.') }
  }, [])
  useEffect(() => { void refresh(); const unsubscribe = api()?.onChanged?.(() => void refresh()); return () => unsubscribe?.() }, [refresh])
  useEffect(() => { const handle = (event: MouseEvent) => { if (!resizingRef.current || event.buttons !== 1) return; const next = Math.min(48, Math.max(24, (event.clientX / window.innerWidth) * 100)); setSidebarWidth(next) }; const stop = () => { resizingRef.current = false; document.body.classList.remove('resizing') }; const start = () => { resizingRef.current = true; document.body.classList.add('resizing') }; const handleEl = document.getElementById('resize-handle'); handleEl?.addEventListener('mousedown', start); window.addEventListener('mousemove', handle); window.addEventListener('mouseup', stop); return () => { handleEl?.removeEventListener('mousedown', start); window.removeEventListener('mousemove', handle); window.removeEventListener('mouseup', stop) } }, [])

  const selectedAsset = snapshot.assets.find(asset => asset.id === selectedAssetId) || null
  const playgroundIds = conversationId ? (snapshot.playground[conversationId] || []) : []
  const call = async (action: () => Promise<unknown>): Promise<boolean> => { try { await action(); void refresh(); return true } catch (error) { setUiError(error instanceof Error ? error.message : 'Operation failed.'); return false } }
  const createConversation = async () => { try { const id = await api()?.createConversation(); if (id) { await refresh(); setConversationId(id) } } catch (error) { setUiError(error instanceof Error ? error.message : 'Unable to create a conversation.') } }
  const selectAsset = (id: string) => { setSelectedAssetId(id) }
  const play = useCallback((key: string, playing: boolean) => setPlayingKey(current => playing ? key : current === key ? null : current), [])
  const playingId = playingKey
  const updatePlayground = (ids: string[]) => { if (conversationId) void call(() => api().setPlayground(conversationId, ids)) }
  const moveAsset = (id: string, direction: -1 | 1) => { const index = playgroundIds.indexOf(id); const next = index + direction; if (index < 0 || next < 0 || next >= playgroundIds.length) return; const ids = [...playgroundIds]; [ids[index], ids[next]] = [ids[next], ids[index]]; updatePlayground(ids) }
  const removeAsset = (id: string) => updatePlayground(playgroundIds.filter(value => value !== id))

  const sendMessage = async (text: string) => conversationId ? call(() => api().sendMessage(conversationId, text)) : false
  const generateSound = async (input: GenerationInput) => conversationId ? call(() => api().generate(conversationId, input)) : false
  const trimAsset = async (input: TrimInput): Promise<Asset | null> => {
    if (!selectedAsset || !conversationId) { setUiError('Select a conversation before trimming audio.'); return null }
    try {
      const created = await api().trimAsset(conversationId, selectedAsset.id, input)
      await refresh()
      setSelectedAssetId(created.id)
      return created
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Unable to save the trimmed asset.')
      throw error
    }
  }
  return <div className="app-shell" style={{ '--sidebar-width': `${sidebarWidth}%` } as React.CSSProperties}><ChatSidebar snapshot={snapshot} selectedId={conversationId} onSelect={setConversationId} onNew={createConversation} onSend={sendMessage} onStop={() => { if (conversationId) void call(() => api().cancelTurn(conversationId)) }} onSettings={() => setSettingsOpen(true)} />{uiError && <div className="error-banner" role="alert"><Icon name="info" /><span>{uiError}</span><button className="icon-button" onClick={() => setUiError(null)} aria-label="Dismiss error"><Icon name="close" /></button></div>}<div className="resize-handle" id="resize-handle" role="separator" aria-label="Resize chat sidebar" tabIndex={0} onKeyDown={event => { if (event.key === 'ArrowLeft') setSidebarWidth(value => Math.max(24, value - 2)); if (event.key === 'ArrowRight') setSidebarWidth(value => Math.min(48, value + 2)) }}><span /></div><main className="main-workspace"><header className="topbar"><div className="breadcrumb"><span className="breadcrumb-muted">Workspace</span><Icon name="arrow" /><strong>{snapshot.conversations.find(item => item.id === conversationId)?.title || 'New session'}</strong></div><div className="topbar-actions"><span className="host-status"><i /> {snapshot.settings.codexReady ? 'Connected' : 'Local only'}</span><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><Icon name="settings" /></button></div></header><nav className="workspace-tabs" aria-label="Workspace view"><button className={tab === 'library' ? 'tab-active' : ''} onClick={() => setTab('library')}><Icon name="library" /> Library <span>{snapshot.assets.length}</span></button><button className={tab === 'playground' ? 'tab-active' : ''} onClick={() => setTab('playground')}><Icon name="waveform" /> Playground <span>{playgroundIds.length}</span></button></nav>{tab === 'library' ? <Library assets={snapshot.assets} selectedId={selectedAssetId} query={query} setQuery={setQuery} onSelect={selectAsset} onImport={() => conversationId && void call(() => api().importAudio(conversationId))} onPlay={play} playingId={playingId} onOpenInspector={() => setInspectorOpen(true)} onAddToPlayground={() => { if (selectedAssetId) updatePlayground([...playgroundIds, selectedAssetId]) }} inPlayground={selectedAssetId ? playgroundIds.includes(selectedAssetId) : false} /> : <Playground assets={snapshot.assets} jobs={snapshot.jobs} conversationId={conversationId} selectedId={selectedAssetId} playgroundIds={playgroundIds} onSelect={selectAsset} onPlay={play} playingId={playingId} onGenerate={generateSound} onCancelJob={id => void call(() => api().cancelJob(id))} onRemove={removeAsset} onMove={moveAsset} onOpenInspector={() => setInspectorOpen(true)} />}</main>{inspectorOpen && <Inspector asset={selectedAsset} onClose={() => setInspectorOpen(false)} onSave={async patch => { if (selectedAsset && await call(() => api().updateAsset(selectedAsset.id, patch, conversationId || undefined))) setInspectorOpen(false) }} onExport={() => selectedAsset && void call(() => api().exportAsset(selectedAsset.id))} onPlay={play} isPlaying={playingKey === selectedAssetId} playingKey={playingKey} onRegenerate={input => { if (conversationId) void call(() => api().generate(conversationId, input)) }} onTrim={trimAsset} />}{settingsOpen && <SettingsDialog snapshot={snapshot} onClose={() => setSettingsOpen(false)} onLogin={() => void call(() => api().startLogin())} onCancelLogin={() => void call(() => api().cancelLogin())} onLogout={() => void call(() => api().logout())} onSaveKey={key => void call(() => api().saveElevenLabsKey(key))} onSaveModel={model => void call(() => api().saveModel(model))} onOpenLogs={() => void call(() => api().openLogs())} />}</div>
}
