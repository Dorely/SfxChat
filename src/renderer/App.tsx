import VoiceControls, { VoiceGenerator } from './VoiceControls'
import { SharedProviderKeys, VoiceSettings } from './ProviderSettings'
import { isDirectGemini } from '../shared/provider-identities'
import ReviewPanel, { ReviewLauncher, workbench } from './ReviewPanel'
import AudioCard from './AudioCard'
import AgentSettings from './AgentSettings'
import { AuditionPlayer, type AuditionState } from './audition'
import type { UiCommand } from '../shared/workbench'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Asset, AssetKind, AssetPatch, ChatModelOption, GenerationInput, Job, AudioGenerationInput, VoiceGenerationInput, MusicGenerationInput, MusicProviderKind, Project, Review, Snapshot } from '../shared/types'
import type { GenericProviderKind, ModelCapabilityResult, TrimInput } from '../shared/types'
import { MUSIC_DURATION_MAX_MS, MUSIC_DURATION_MIN_MS, MUSIC_MODELS, MUSIC_PROVIDER_PRESETS } from '../shared/music-models'
import MidiStudio from './MidiStudio'
import TrimEditor from './TrimEditor'
import ChatContextMeter from './ChatContextMeter'
import Icon from './Icon'
import { THEMES, applyTheme, storedTheme, type ThemeId } from './theme'

type Tab = AssetKind | 'playground'

const emptySnapshot: Snapshot = {
  projects: [], activeProjectId: '', conversations: [], messages: [], assets: [], jobs: [], playground: {},
  settings: { codexReady: false, elevenLabsReady: false, geminiReady: false, providerKeys: [], voiceProviders: [], activeVoiceId: 'elevenlabs', secureStorageAvailable: false, loginPending: false, model: 'backend default', error: null, chatModels: [], activeChat: { modelId: 'codex:gpt-5.6-sol', effort: 'medium' }, providers: [], musicProviders: [], activeMusicId: null },
  activeTurns: [], reviews: [],
}

const LIBRARY_COPY: Record<AssetKind, { eyebrow: string; title: string; placeholder: string; emptyTitle: string; emptyBody: string; importLabel: string; noun: [string, string] }> = {
  effect: { eyebrow: 'Your sound library', title: 'Effects Library', placeholder: 'Search sounds, tags, prompts…', emptyTitle: 'Your effects library is ready', emptyBody: 'Generate a sound in the Playground or import an existing WAV or MP3 to get started.', importLabel: 'Import a sound', noun: ['sound', 'sounds'] },
  voice: { eyebrow: 'Your voice library', title: 'Voice Library', placeholder: 'Search voices, scripts, tags…', emptyTitle: 'Your voice library is ready', emptyBody: 'Generate speech in the Playground or import an existing WAV or MP3.', importLabel: 'Import a voice clip', noun: ['clip', 'clips'] },
  music: { eyebrow: 'Your music library', title: 'Music Library', placeholder: 'Search music, prompts, lyrics…', emptyTitle: 'Your music library is ready', emptyBody: 'Generate a track in the Playground or import an existing WAV or MP3 to get started.', importLabel: 'Import a track', noun: ['track', 'tracks'] },
  midi: { eyebrow: 'Your MIDI library', title: 'MIDI Library', placeholder: 'Search MIDI clips, prompts, tags…', emptyTitle: 'Your MIDI library is ready', emptyBody: 'Compose a clip with the assistant or import an existing MIDI file to get started.', importLabel: 'Import a MIDI file', noun: ['clip', 'clips'] },
}

function kindLabel(kind: AssetKind) { return kind === 'midi' ? 'MIDI clip' : kind === 'voice' ? 'Voice' : kind === 'music' ? 'Music' : 'Sound effect' }
function musicSecondsLabel(ms: number) { const seconds = ms / 1000; return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : `${seconds}s` }

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

function StatusPill({ status }: { status: Job['status'] }) {
  return <span className={`status-pill status-${status}`}><span className="status-dot" />{status}</span>
}

function TitleInput({ value, className, ariaLabel, onCommit, onCancel }: { value: string; className: string; ariaLabel: string; onCommit: (value: string) => void; onCancel: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  const commit = (next: string) => { const trimmed = next.trim(); if (trimmed && trimmed !== value) onCommit(trimmed); else onCancel() }
  return <input ref={inputRef} className={className} defaultValue={value} aria-label={ariaLabel} maxLength={70}
    onKeyDown={event => { if (event.key === 'Enter') commit(event.currentTarget.value); if (event.key === 'Escape') onCancel() }}
    onBlur={event => commit(event.currentTarget.value)} onClick={event => event.stopPropagation()} />
}

function EditableTitle({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <TitleInput value={value} className="breadcrumb-title breadcrumb-title-edit" ariaLabel="Session title" onCommit={title => { setEditing(false); onCommit(title) }} onCancel={() => setEditing(false)} />
  return <button type="button" className="breadcrumb-title" title="Rename session" onClick={() => setEditing(true)}>{value}</button>
}

function ProjectDialog({ mode, project, onClose, onCreate, onRename }: { mode: 'create' | 'rename'; project: Project | null; onClose: () => void; onCreate: (name: string) => void; onRename: (id: string, name: string) => void }) {
  const [name, setName] = useState(mode === 'rename' ? project?.name ?? '' : '')
  const submit = () => { const trimmed = name.trim(); if (!trimmed) return; if (mode === 'create') onCreate(trimmed); else if (project) onRename(project.id, trimmed) }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="settings-dialog project-dialog" role="dialog" aria-modal="true" aria-label={mode === 'create' ? 'New project' : 'Rename project'}>
      <div className="drawer-header"><div><p className="eyebrow">Project</p><h2>{mode === 'create' ? 'New project' : 'Rename project'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close project dialog"><Icon name="close" /></button></div>
      <div className="project-dialog-body">
        <label>Project name<input autoFocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submit() }} maxLength={60} placeholder="Client work" aria-label="Project name" /></label>
        <div className="model-row"><button className="primary-button" onClick={submit} disabled={!name.trim()}>{mode === 'create' ? 'Create project' : 'Save name'}</button><button className="secondary-button" onClick={onClose}>Cancel</button></div>
      </div>
    </section>
  </div>
}

function ProjectSwitcher({ snapshot, onSwitch, onCreate, onRename, onDelete }: { snapshot: Snapshot; onSwitch: (id: string) => void; onCreate: () => void; onRename: () => void; onDelete: () => void }) {
  return <span className="project-switcher">
    <select aria-label="Project" value={snapshot.activeProjectId} onChange={event => onSwitch(event.target.value)}>
      {snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
    <button className="labeled-button" onClick={onCreate} aria-label="New project" title="New project"><Icon name="plus" /> New</button>
    <button className="icon-button" onClick={onRename} aria-label="Rename project" title="Rename project"><Icon name="edit" /></button>
    <button className="icon-button" onClick={onDelete} aria-label="Delete project" title="Delete project"><Icon name="trash" /></button>
  </span>
}

function ChatSidebar({ snapshot, projectName, selectedId, onSelect, onNew, onRename, onDelete, onSend, onStop, onChangeModel, onSettings }: { snapshot: Snapshot; projectName: string; selectedId: string | null; onSelect: (id: string) => void; onNew: () => void; onRename: (id: string, title: string) => void; onDelete: () => void; onSend: (text: string) => Promise<boolean>; onStop: () => void; onChangeModel: (modelId: string, effort: string) => void; onSettings: () => void }) {
  const [text, setText] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
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
    <div className="brand-row"><div className="brand-mark"><Icon name="mark" /></div><div><strong>SFXCHAT</strong><span>sound workbench</span></div><span className="live-indicator" title="Local workbench ready" /></div>
    <div className="sidebar-heading"><span>Conversations <small>{projectName}</small></span><button className="icon-button" disabled={!selectedId} onClick={onDelete} aria-label="Delete selected conversation" title="Delete selected conversation"><Icon name="trash" /></button><button className="labeled-button" onClick={onNew} aria-label="New conversation" title="New conversation"><Icon name="plus" /> New</button></div>
    <div className="conversation-list">
      {snapshot.conversations.length === 0 ? <div className="empty-conversations"><div className="empty-icon"><Icon name="chat" /></div><p>Your sound design sessions will appear here.</p><button className="text-button" onClick={onNew}>Start a conversation <Icon name="arrow" /></button></div> : snapshot.conversations.map(conversation => renamingId === conversation.id ? <div key={conversation.id} className="conversation-row conversation-renaming"><span className="conversation-dot" /><span className="conversation-copy"><TitleInput value={conversation.title} className="conversation-title-input" ariaLabel="Session title" onCommit={title => { setRenamingId(null); onRename(conversation.id, title) }} onCancel={() => setRenamingId(null)} /></span></div> : <button key={conversation.id} onDoubleClick={() => setRenamingId(conversation.id)} title="Double-click to rename" className={`conversation-row ${conversation.id === selectedId ? 'conversation-active' : ''}`} onClick={() => onSelect(conversation.id)}><span className="conversation-dot" /><span className="conversation-copy"><strong>{conversation.title || 'Untitled conversation'}</strong><small>{timeLabel(conversation.createdAt)}</small></span><span className="conversation-chevron">›</span></button>)}
    </div>
    <div className="sidebar-chat">
      {selectedId ? <>
        <div className="chat-history" ref={historyRef} aria-live="polite" onScroll={event => {
          const history = event.currentTarget
          followOutput.current = history.scrollHeight - history.scrollTop - history.clientHeight <= 24
        }}>
          {messages.length === 0 && <div className="chat-welcome"><Icon name="mark" /><p>Describe a sound and I’ll help shape it into a usable brief.</p></div>}
          {messages.map(message => <div key={message.id} className={`message message-${message.role}`}><span className="message-role">{message.role === 'user' ? 'You' : message.role === 'tool' ? 'Activity' : 'SfxChat'}</span><p>{message.text}</p>{message.attachments?.map(attachment => <figure key={attachment.id} className={`chat-attachment chat-attachment-${attachment.kind}`}>{attachment.kind === 'image' ? <img src={window.sfx.mediaUrl(`chat/${message.id}/${attachment.id}`)} alt={attachment.label} loading="lazy" /> : <audio controls preload="metadata" src={window.sfx.mediaUrl(`chat/${message.id}/${attachment.id}`)} />}<figcaption>{attachment.label}</figcaption></figure>)}{message.status !== 'completed' && <span className={`message-status message-${message.status}`}>{message.status}</span>}</div>)}
          {active && <div className="typing-row"><span className="typing-dots"><i /><i /><i /></span> Working on it…</div>}
        </div>
        <div className="chat-composer"><ChatContextMeter conversationId={selectedId} draft={text} snapshot={snapshot} /><textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder="Describe a sound…  (Enter to send · Shift+Enter for a new line)" aria-label="Message SfxChat" rows={3} /><div className="composer-footer"><ChatModelPicker snapshot={snapshot} onChange={onChangeModel} onSettings={onSettings} />{active ? <button className="stop-button" onClick={onStop}><Icon name="stop" /> Stop</button> : <button className="send-button" onClick={() => void submit()} disabled={!text.trim()} aria-label="Send message"><Icon name="send" /></button>}</div></div>
      </> : <div className="no-chat-selected"><Icon name="chat" /><p>Select a conversation to begin.</p></div>}
    </div>
  </aside>
}

function Library({ kind, assets, selectedId, query, setQuery, onSelect, onImport, onPlay, playingId, onOpenInspector, onAddToPlayground, inPlayground }: { kind: AssetKind; assets: Asset[]; selectedId: string | null; query: string; setQuery: (value: string) => void; onSelect: (id: string) => void; onImport: () => void; onPlay: (key: string, playing: boolean) => void; playingId: string | null; onOpenInspector: () => void; onAddToPlayground: () => void; inPlayground: boolean }) {
  const playingKey = playingId
  const copy = LIBRARY_COPY[kind]
  const kindAssets = assets.filter(asset => (asset.kind ?? 'effect') === kind)
  const [searchAssets, setSearchAssets] = useState<Asset[]>(kindAssets)
  useEffect(() => {
    let cancelled = false
    if (!query.trim()) { setSearchAssets(kindAssets); return () => { cancelled = true } }
    const timer = window.setTimeout(async () => {
      try { const found = await api()?.searchAssets(query.trim()); if (!cancelled && found) setSearchAssets(found.filter(asset => (asset.kind ?? 'effect') === kind)) }
      catch { if (!cancelled) setSearchAssets([]) }
    }, 140)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [assets, query, kind])
  const [reviewFilter, setReviewFilter] = useState<'all' | Review>('all')
  const filtered = (query.trim() ? searchAssets : kindAssets).filter(asset => (asset.kind ?? 'effect') === kind && (reviewFilter === 'all' || asset.review === reviewFilter))
  return <section className="workspace-panel library-panel"><div className="panel-header"><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title} <span>{kindAssets.length}</span></h1></div><div className="header-actions"><button className="secondary-button" onClick={onImport}><Icon name="import" /> Import audio</button><button className="primary-button" onClick={onOpenInspector} disabled={!selectedId}><Icon name="edit" /> Inspect</button><button className="secondary-button" onClick={onAddToPlayground} disabled={!selectedId || inPlayground}><Icon name="plus" /> Add to playground</button></div></div><div className="library-toolbar"><label className="search-field"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={copy.placeholder} aria-label={`Search ${copy.title.toLowerCase()}`} /></label><span className="toolbar-count">{filtered.length} {filtered.length === 1 ? copy.noun[0] : copy.noun[1]}</span><select className="filter-button" value={reviewFilter} onChange={event => setReviewFilter(event.target.value as 'all' | Review)} aria-label="Filter library by review"><option value="all">All {copy.noun[1]}</option><option value="unreviewed">Unreviewed</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></div><div className="asset-grid">{filtered.length === 0 ? <div className="empty-state"><div className="empty-icon"><Icon name="waveform" /></div><h2>{kindAssets.length ? `No ${copy.noun[1]} found` : copy.emptyTitle}</h2><p>{kindAssets.length ? 'Try a different search or clear the filter.' : copy.emptyBody}</p>{!kindAssets.length && <button className="secondary-button" onClick={onImport}><Icon name="import" /> {copy.importLabel}</button>}</div> : filtered.map(asset => <AudioCard key={asset.id} asset={asset} selected={asset.id === selectedId} onSelect={() => onSelect(asset.id)} onPlay={onPlay} playerKey={`library-${asset.id}`} isPlaying={playingKey === `library-${asset.id}`} />)}</div></section>
}

function Playground({ assets, jobs, conversationId, selectedId, playgroundIds, musicProviders, activeMusicId, voiceProviders, activeVoiceId, onGenerateVoice, onSelect, onPlay, playingId, onGenerate, onGenerateMusic, onCancelJob, onRemove, onMove, onOpenInspector, reviewControls, reviewResults, reviewCount }: { assets: Asset[]; jobs: Job[]; conversationId: string | null; selectedId: string | null; playgroundIds: string[]; musicProviders: Snapshot['settings']['musicProviders']; activeMusicId: string | null; voiceProviders: Snapshot['settings']['voiceProviders']; activeVoiceId: Snapshot['settings']['activeVoiceId']; onGenerateVoice: (input: VoiceGenerationInput) => Promise<boolean>; onSelect: (id: string) => void; onPlay: (key: string, playing: boolean) => void; playingId: string | null; onGenerate: (input: GenerationInput) => Promise<boolean>; onGenerateMusic: (input: MusicGenerationInput) => Promise<boolean>; onCancelJob: (id: string) => void; onRemove: (id: string) => void; onMove: (id: string, direction: -1 | 1) => void; onOpenInspector: () => void; reviewControls?: React.ReactNode; reviewResults?: React.ReactNode; reviewCount?: number }) {
  const playingKey = playingId
  const [mode, setMode] = useState<AssetKind>('effect')
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState(1)
  const [duration, setDuration] = useState('auto')
  const [loop, setLoop] = useState(false)
  const [influence, setInfluence] = useState(0.3)
  const [musicSeconds, setMusicSeconds] = useState('auto')
  const [instrumental, setInstrumental] = useState(false)
  const [musicProviderId, setMusicProviderId] = useState('')
  const sounds = playgroundIds.map(id => assets.find(asset => asset.id === id)).filter((asset): asset is Asset => Boolean(asset))
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(sounds.length / 24))
  const currentPage = Math.min(page, pageCount - 1)
  const visibleSounds = sounds.slice(currentPage * 24, (currentPage + 1) * 24)
  const activeJobs = jobs.filter(job => (job.status === 'queued' || job.status === 'running'))
  const terminalJobs = jobs.filter(job => (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'uncertain'))
  const activeMusic = musicProviders.find(provider => provider.id === activeMusicId) ?? musicProviders[0] ?? null
  const musicModel = activeMusic ? MUSIC_MODELS[activeMusic.kind].find(entry => entry.id === activeMusic.model) ?? null : null
  const generate = async () => { const seconds = duration === 'auto' ? null : Number(duration); if (!prompt.trim() || !conversationId || (seconds !== null && (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 30))) return; if (await onGenerate({ prompt: prompt.trim(), count, duration: seconds, loop, influence })) setPrompt('') }
  const generateMusic = async () => {
    const ms = musicSeconds === 'auto' ? null : Math.round(Number(musicSeconds) * 1000)
    if (!prompt.trim() || !conversationId) return
    if (ms !== null && (!Number.isFinite(ms) || ms < MUSIC_DURATION_MIN_MS || ms > MUSIC_DURATION_MAX_MS)) return
    const input: MusicGenerationInput = { kind: 'music', prompt: prompt.trim(), count, durationMs: ms, instrumental, providerId: musicProviderId || null }
    if (await onGenerateMusic(input)) setPrompt('')
  }
  return <section className="workspace-panel playground-panel"><div className="panel-header"><div><p className="eyebrow">Compare & refine</p><h1>Playground <span>{reviewCount ?? sounds.length}</span></h1></div><div className="header-actions">{reviewControls}<button className="secondary-button" onClick={onOpenInspector} disabled={!selectedId}><Icon name="edit" /> Inspector</button></div></div>{!conversationId ? <div className="empty-state panel-empty"><div className="empty-icon"><Icon name="chat" /></div><h2>Choose a conversation first</h2><p>Start a conversation to create audio for this project.</p></div> : <>{reviewResults ?? <><div className="playground-grid">{sounds.length === 0 ? <div className="empty-state playground-empty"><div className="empty-icon"><Icon name="waveform" /></div><h2>A blank canvas for sound</h2><p>Generate a few candidates below, then arrange them here to compare.</p></div> : visibleSounds.map((asset, slot) => { const index = currentPage * 24 + slot; return ( <div className="playground-slot" key={asset.id}><div className="slot-label"><span>Candidate {String(index + 1).padStart(2, '0')} · {kindLabel(asset.kind ?? 'effect')}</span><div><button className="mini-button" onClick={() => onMove(asset.id, -1)} disabled={index === 0} aria-label="Move candidate left"><Icon name="arrow-left" /></button><button className="mini-button" onClick={() => onMove(asset.id, 1)} disabled={index === sounds.length - 1} aria-label="Move candidate right"><Icon name="arrow" /></button><button className="mini-button" onClick={() => onRemove(asset.id)} aria-label="Remove from playground"><Icon name="close" /></button></div></div><AudioCard asset={asset} selected={asset.id === selectedId} onSelect={() => onSelect(asset.id)} onPlay={onPlay} playerKey={`playground-${asset.id}`} isPlaying={playingKey === `playground-${asset.id}`} compact /></div>) })}</div>{pageCount > 1 && <div className="playground-pagination"><button className="secondary-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous candidates</button><span>Page {currentPage + 1} of {pageCount} · {sounds.length} candidates</span><button className="secondary-button" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next candidates</button></div>}</>}<div className="generation-zone"><div className="generation-title"><div><span className="section-kicker"><Icon name="spark" /> Create {mode === 'voice' ? 'voice' : mode === 'music' ? 'music' : 'sound'}</span><h2>{mode === 'voice' ? 'Turn words into a performance' : mode === 'music' ? 'Turn an idea into a track' : 'Turn an idea into candidates'}</h2></div><div className="mode-toggle" role="group" aria-label="Generation kind"><button className={mode === 'effect' ? 'mode-active' : ''} onClick={() => setMode('effect')}>Effect</button><button className={mode === 'music' ? 'mode-active' : ''} onClick={() => setMode('music')}>Music</button><button className={mode === 'voice' ? 'mode-active' : ''} onClick={() => setMode('voice')}>Voice</button></div></div>{mode === 'voice' ? <VoiceGenerator providers={voiceProviders} activeId={activeVoiceId} onGenerate={onGenerateVoice} /> : mode === 'effect' ? <div className="generation-form"><textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="e.g. soft rain on a greenhouse roof, close and detailed…" rows={2} aria-label="Sound generation prompt" /><div className="generation-options"><label>Count <input type="number" min="1" step="1" value={count} onChange={event => setCount(Math.max(1, Number(event.target.value) || 1))} aria-label="Candidate count" /></label><label>Duration <input type="number" min="0.5" max="30" step="0.5" value={duration === 'auto' ? '' : duration} onChange={event => setDuration(event.target.value || 'auto')} placeholder="Auto" aria-label="Duration seconds" /><span className="auto-duration"><button type="button" className={duration === 'auto' ? 'auto-active' : ''} onClick={() => setDuration('auto')}>Auto</button> · 0.5–30s</span></label><label className="check-option"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} /> Loop</label><label className="influence-option">Influence <input type="range" min="0" max="1" step="0.05" value={influence} onChange={event => setInfluence(Number(event.target.value))} /><output>{influence.toFixed(2)}</output></label><button className="primary-button generate-button" onClick={() => void generate()} disabled={!prompt.trim()}><Icon name="spark" /> Generate</button></div></div> : musicProviders.length === 0 ? <div className="generation-form"><p className="music-hint">Add a music provider in Settings to generate tracks. Music models use the shared provider API keys in Settings.</p></div> : <div className="generation-form"><textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="e.g. 1980s synthwave, 110 BPM in D minor, driving arpeggios, instrumental…" rows={3} aria-label="Music generation prompt" /><div className="generation-options"><label>Count <input type="number" min="1" step="1" value={count} onChange={event => setCount(Math.max(1, Number(event.target.value) || 1))} aria-label="Candidate count" /></label><label>Length <input type="number" min={MUSIC_DURATION_MIN_MS / 1000} max={MUSIC_DURATION_MAX_MS / 1000} step="1" value={musicSeconds === 'auto' ? '' : musicSeconds} onChange={event => setMusicSeconds(event.target.value || 'auto')} placeholder="Auto" aria-label="Music length seconds" /><span className="auto-duration"><button type="button" className={musicSeconds === 'auto' ? 'auto-active' : ''} onClick={() => setMusicSeconds('auto')}>Auto</button> · 3–600s</span></label><label className="check-option"><input type="checkbox" checked={instrumental} onChange={event => setInstrumental(event.target.checked)} /> Instrumental</label><label>Provider <select value={musicProviderId} onChange={event => setMusicProviderId(event.target.value)} aria-label="Music provider"><option value="">Default ({activeMusic?.label ?? 'none'})</option>{musicProviders.map(provider => <option key={provider.id} value={provider.id}>{provider.label}{provider.ready ? '' : ' — no key'}</option>)}</select></label><button className="primary-button generate-button" onClick={() => void generateMusic()} disabled={!prompt.trim()}><Icon name="spark" /> Generate</button></div><p className="music-hint">{activeMusic ? `${activeMusic.label} · ${activeMusic.model}${musicModel?.fixedDurationMs ? ` · fixed ${musicSecondsLabel(musicModel.fixedDurationMs)} clips` : ''}. Length is a whole-file target; write structure and timing into the prompt.` : ''}</p></div>}</div>{activeJobs.length > 0 && <div className="jobs-strip"><div><span className="spinner" /> <strong>Generating {activeJobs.length} {activeJobs.length === 1 ? 'candidate' : 'candidates'}</strong><span className="job-copy">Your results will appear here when ready.</span></div>{activeJobs.map(job => <button key={job.id} className="cancel-job" onClick={() => onCancelJob(job.id)}>Cancel</button>)}</div>}{terminalJobs.length > 0 && <div className="job-history"><span className="field-label">Recent jobs</span>{terminalJobs.slice(-5).reverse().map(job => <div className="job-history-row" key={job.id}><StatusPill status={job.status} /><span className={`kind-chip kind-${job.kind ?? 'effect'}`}>{job.kind === 'voice' ? 'VOICE' : job.kind === 'music' ? 'MUSIC' : 'SFX'}</span><span>{job.input.kind === 'voice' ? job.input.text : job.input.prompt}</span>{job.assetId && <code>{job.assetId.slice(0, 8)}</code>}{job.error && <em>{job.error}</em>}</div>)}</div>}</>}</section>
}

function voiceGenerationSource(asset: Asset | null, assets: Asset[]): Asset | null {
  let current = asset; const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.request?.kind === 'voice') return current;
    visited.add(current.id); current = assets.find(item => item.id === current?.parentId) ?? null;
  }
  return null;
}

function Inspector({ asset, assets, onClose, onSave, onExport, onPlay, isPlaying, playingKey, onRegenerate, onTrim, voiceProviders, activeVoiceId }: { voiceProviders: Snapshot['settings']['voiceProviders']; activeVoiceId: Snapshot['settings']['activeVoiceId']; assets: Asset[]; asset: Asset | null; onClose: () => void; onSave: (patch: AssetPatch) => void; onExport: (format: 'original' | 'wav' | 'ogg') => void; onPlay: (id: string, playing: boolean) => void; isPlaying: boolean; playingKey: string | null; onRegenerate: (input: AudioGenerationInput) => void; onTrim: (input: TrimInput) => Promise<Asset | null> }) {
  const voiceSource = asset?.kind === 'voice' ? voiceGenerationSource(asset, assets) : null
  const request = voiceSource?.request ?? asset?.request ?? null
  const musicRequest: MusicGenerationInput | null = request && request.kind === 'music' ? request : null
  const effectRequest: GenerationInput | null = request && (request.kind === undefined || request.kind === 'effect') ? request : null
  const [voiceEdit, setVoiceEdit] = useState<VoiceGenerationInput>(request?.kind === 'voice' ? request : { kind: 'voice', text: asset?.prompt ?? '', providerId: activeVoiceId })
  const [name, setName] = useState(asset?.name || '')
  const [description, setDescription] = useState(asset?.description || '')
  const [tags, setTags] = useState(asset?.tags.join(', ') || '')
  const [collections, setCollections] = useState(asset?.collections.join(', ') || '')
  const [feedback, setFeedback] = useState(asset?.feedback || '')
  const [generationPrompt, setGenerationPrompt] = useState(asset?.prompt || '')
  const [review, setReview] = useState<Review>(asset?.review || 'unreviewed')
  const [trimOpen, setTrimOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<'original' | 'wav' | 'ogg'>('original')
  useEffect(() => { if (asset) { setName(asset.name); setDescription(asset.description); setTags(asset.tags.join(', ')); setCollections(asset.collections.join(', ')); setFeedback(asset.feedback); setGenerationPrompt(asset.prompt); setVoiceEdit(request?.kind === 'voice' ? request : { kind: 'voice', text: asset.prompt, providerId: activeVoiceId }); setReview(asset.review); setTrimOpen(false) } }, [asset?.id])
  if (!asset) return null
  const save = () => onSave({ name: name.trim(), description: description.trim(), tags: tags.split(',').map(value => value.trim()).filter(Boolean), collections: collections.split(',').map(value => value.trim()).filter(Boolean), feedback: feedback.trim(), review })
  const regenerate = () => {
    if (!generationPrompt.trim()) return
    if (asset.kind === 'voice') onRegenerate({ ...voiceEdit, text: generationPrompt, count: 1, parentId: asset.id })
    else if (asset.kind === 'music') onRegenerate({ kind: 'music', prompt: generationPrompt.trim(), count: 1, durationMs: musicRequest?.durationMs ?? null, instrumental: musicRequest?.instrumental ?? false, providerId: musicRequest?.providerId ?? null, parentId: asset.id })
    else onRegenerate({ prompt: generationPrompt.trim(), count: 1, duration: effectRequest?.duration ?? null, loop: Boolean(effectRequest?.loop), influence: effectRequest?.influence ?? 0.3, parentId: asset.id })
  }
  return <div className="inspector-drawer"><div className="drawer-header"><div><p className="eyebrow">{kindLabel(asset.kind ?? 'effect')} inspector</p><h2>{asset.name || (asset.kind === 'music' ? 'Untitled track' : 'Untitled sound')}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close inspector"><Icon name="close" /></button></div><div className="drawer-scroll"><AudioCard asset={asset} selected onSelect={() => undefined} onPlay={onPlay} isPlaying={isPlaying} /><div className="trim-action"><button className="primary-button" onClick={() => setTrimOpen(true)}><Icon name="edit" /> Trim as new asset</button></div><div className="form-section"><label>Name<input value={name} onChange={event => setName(event.target.value)} /></label><label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} /></label><label>Tags <span className="field-hint">comma separated</span><input value={tags} onChange={event => setTags(event.target.value)} /></label><label>Collections <span className="field-hint">comma separated</span><input value={collections} onChange={event => setCollections(event.target.value)} /></label><label>{asset.kind === 'voice' ? 'Spoken text' : 'Generation prompt'}<textarea value={generationPrompt} onChange={event => { setGenerationPrompt(event.target.value); if (asset.kind === 'voice') setVoiceEdit(current => ({ ...current, providerText: undefined })) }} rows={asset.kind === 'music' ? 6 : 3} placeholder={asset.kind === 'voice' ? 'The words the voice should say.' : asset.kind === 'music' ? 'Describe the complete track: genre, mood, instrumentation, tempo, key, structure, and any lyrics.' : 'Describe the complete sound: source, action, material, space, character, and timing.'} aria-label="Generation prompt" /><span className="field-hint">{asset.kind === 'voice' ? 'Changing words clears prepared text; delivery controls are saved with the new generation.' : asset.kind === 'music' ? 'Describe the whole track for this generation, including arrangement and lyrics; a revision is a new generation, not an edit.' : 'Describe the full sound for this generation. Use chat for help applying feedback.'}</span></label>{asset.kind === 'voice' && <VoiceControls value={{ ...voiceEdit, text: generationPrompt }} providers={voiceProviders} onChange={setVoiceEdit} />}{voiceSource && voiceSource.id !== asset.id && <p className="field-hint">Controls come from the original generation. Regeneration uses its full script; local trims are not sent.</p>}<label>Feedback<textarea value={feedback} onChange={event => setFeedback(event.target.value)} rows={3} placeholder="What should change in the next pass?" /></label></div><div className="review-section"><span className="field-label">Review decision</span><div className="review-buttons"><button className={review === 'accepted' ? 'review-active accepted' : ''} onClick={() => setReview('accepted')}><Icon name="check" /> Accept</button><button className={review === 'rejected' ? 'review-active rejected' : ''} onClick={() => setReview('rejected')}><Icon name="x" /> Reject</button><button className={review === 'unreviewed' ? 'review-active unreviewed' : ''} onClick={() => setReview('unreviewed')}>Unreviewed</button></div></div><div className="provenance-section"><div className="provenance-heading"><span className="field-label">Provenance</span><span className="immutable-badge"><Icon name="lock" /> Immutable</span></div><dl><dt>Kind</dt><dd>{kindLabel(asset.kind ?? 'effect')}</dd><dt>Source</dt><dd>{asset.source} · {asset.format.toUpperCase()}</dd><dt>Prompt</dt><dd>{asset.prompt || 'No prompt recorded'}</dd><dt>{voiceSource && voiceSource.id !== asset.id ? 'Generation provider / model' : 'Provider / model'}</dt><dd>{[(voiceSource ?? asset).provider, (voiceSource ?? asset).model].filter(Boolean).join(' · ') || 'Not available'}</dd>{asset.providerPrompt && asset.providerPrompt !== asset.prompt && <><dt>Provider text</dt><dd>{asset.providerPrompt}</dd></>}{asset.lyrics && <><dt>Returned lyrics</dt><dd className="lyrics-value">{asset.lyrics}</dd></>}{request?.kind === 'voice' && <><dt>Voice</dt><dd>{request.voiceId}</dd><dt>Delivery settings</dt><dd>{JSON.stringify({ style: request.style, stability: request.stability, similarity: request.similarity, speed: request.speed })}</dd></>}{voiceSource && voiceSource.id !== asset.id && <><dt>Generation source</dt><dd>{voiceSource.id}</dd></>}{asset.requestId && <><dt>Request ID</dt><dd>{asset.requestId}</dd></>}{asset.usage && <><dt>Provider usage</dt><dd>{asset.usage}</dd></>}<dt>Created</dt><dd>{shortDate(asset.createdAt)}</dd><dt>Hash</dt><dd className="hash-value">{asset.hash || 'Not available'}</dd>{asset.parentId && <><dt>Parent asset</dt><dd>{asset.parentId}</dd></>}{asset.edit && <><dt>Edit</dt><dd>{secondsLabel(asset.edit.startFrame / asset.edit.sampleRate)}–{secondsLabel(asset.edit.endFrame / asset.edit.sampleRate)} s · {asset.edit.fadeInFrames || asset.edit.fadeOutFrames ? 'faded' : 'no fades'}</dd></>}</dl></div></div><div className="drawer-footer"><select aria-label="Asset export format" value={exportFormat} onChange={e => setExportFormat(e.target.value as typeof exportFormat)}><option value="original">Original bytes</option><option value="wav">PCM WAV</option><option value="ogg">Ogg Vorbis</option></select><button className="secondary-button" onClick={() => onExport(exportFormat)}><Icon name="download" /> Export</button><button className="secondary-button" onClick={regenerate} disabled={!generationPrompt.trim()}><Icon name="undo" /> Regenerate</button><button className="primary-button" onClick={save}>Save changes</button></div>{trimOpen && <TrimEditor asset={asset} onClose={() => setTrimOpen(false)} onSave={onTrim} onPlay={onPlay} playingKey={playingKey} />}</div>
}

function ChatProviderSettings({ snapshot }: { snapshot: Snapshot }) {
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [kind, setKind] = useState<GenericProviderKind>('chat-completions')
  const [apiKey, setApiKey] = useState('')
  const [providerError, setProviderError] = useState<string | null>(null)
  const [slug, setSlug] = useState('')
  const [efforts, setEfforts] = useState('')
  const [testResult, setTestResult] = useState<ModelCapabilityResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [providerId, setProviderId] = useState(snapshot.settings.providers[0]?.id ?? '')
  const activeProvider = providerId || snapshot.settings.providers[0]?.id || ''
  const resetTest = () => { setTestResult(null); setTestError(null) }
  const saveProvider = async () => {
    setProviderError(null)
    try {
      const saved = await api().saveChatProvider({ label, baseUrl, kind, ...(isDirectGemini(baseUrl) ? {} : { apiKey }) })
      setProviderId(saved.id); setLabel(''); setBaseUrl(''); setApiKey('')
    } catch (error) { setProviderError(error instanceof Error ? error.message : 'Unable to save the provider.') }
  }
  const runTest = async () => {
    if (!activeProvider || !slug.trim()) { setTestError('Select a provider and enter a model name first.'); return }
    setTesting(true); setTestError(null)
    try {
      const result = await api().testChatModel({ providerId: activeProvider, slug: slug.trim(), efforts: efforts.split(',').map(value => value.trim()).filter(Boolean) })
      setTestResult(result)
      if (result.failedEfforts.length) setTestError(`Failed efforts: ${result.failedEfforts.join(', ')}${result.error ? ` — ${result.error}` : ''}`)
    } catch (error) { setTestError(error instanceof Error ? error.message : 'Model test failed.'); setTestResult(null) }
    finally { setTesting(false) }
  }
  const saveModel = async () => {
    if (!activeProvider || !slug.trim()) return
    setTestError(null)
    try {
      await api().saveChatModel({ providerId: activeProvider, slug: slug.trim(), efforts: efforts.split(',').map(value => value.trim()).filter(Boolean) })
      setSlug(''); setEfforts(''); resetTest()
    } catch (error) { setTestError(error instanceof Error ? error.message : 'Unable to save the model.') }
  }
  const removeProvider = async (id: string, name: string) => {
    if (!window.confirm(`Remove ${name} and its saved models?`)) return
    setProviderError(null)
    try { await api().deleteChatProvider(id); if (providerId === id) setProviderId('') } catch (error) { setProviderError(error instanceof Error ? error.message : 'Unable to remove the provider.') }
  }
  const removeModel = async (id: string) => {
    setTestError(null)
    try { await api().deleteChatModel(id) } catch (error) { setTestError(error instanceof Error ? error.message : 'Unable to remove the model.') }
  }
  const models = snapshot.settings.chatModels
  return <div className="chat-providers">
    <div className="provider-list">
      {models.map(entry => <div key={entry.id} className={`provider-row ${entry.id === snapshot.settings.activeChat.modelId ? 'provider-active' : ''}`}>
        <span className="provider-choice"><span><strong>{entry.label}</strong><small>{entry.providerLabel} · {entry.slug}{entry.efforts.length ? ` · ${entry.efforts.join(', ')}` : ''}</small></span></span>
        {entry.id === snapshot.settings.activeChat.modelId && <span className="readiness ready"><i />In use</span>}
        {!entry.builtIn && <button className="mini-button" onClick={() => void removeModel(entry.id)} aria-label={`Remove ${entry.label}`} title="Remove model"><Icon name="trash" /></button>}
      </div>)}
    </div>
    <p className="provider-note">Pick the model for a conversation from the chat composer. Models listed here are available there.</p>
    {snapshot.settings.providers.length > 0 && <div className="settings-subsection"><h4>Custom endpoints</h4><div className="provider-list">
      {snapshot.settings.providers.map(entry => <div key={entry.id} className="provider-row">
        <span className="provider-choice"><span><strong>{entry.label}</strong><small>{entry.kind} · {entry.baseUrl}</small></span></span>
        <button className="mini-button" onClick={() => void removeProvider(entry.id, entry.label)} aria-label={`Remove ${entry.label}`} title="Remove endpoint"><Icon name="trash" /></button>
      </div>)}
    </div></div>}
    <div className="settings-subsection"><h4>Add an endpoint</h4><div className="provider-form">
      <label>Provider name<input value={label} onChange={event => setLabel(event.target.value)} placeholder="CommandCode" aria-label="Provider name" /></label>
      <label>Base URL<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.commandcode.ai/provider/v1" aria-label="Provider base URL" /></label>
      <label>Endpoint type<select value={kind} onChange={event => setKind(event.target.value as GenericProviderKind)} aria-label="Endpoint type"><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option><option value="anthropic">Anthropic Messages</option></select></label>
      {isDirectGemini(baseUrl) ? <p className="secure-note">Uses the shared Gemini API key above.</p> : <label>API key (optional)<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Leave empty for local providers like Ollama" aria-label="Provider API key" /></label>}
      <button className="secondary-button" onClick={() => void saveProvider()}>Save provider</button>
      {providerError && <p className="settings-error">{providerError}</p>}
    </div></div>
    {snapshot.settings.providers.length > 0 && <div className="settings-subsection"><h4>Add a model</h4><div className="provider-models">
      <label>Provider<select value={activeProvider} onChange={event => { setProviderId(event.target.value); resetTest() }} aria-label="Model provider">{snapshot.settings.providers.map((entry: { id: string; label: string; kind: string }) => <option key={entry.id} value={entry.id}>{entry.label} ({entry.kind})</option>)}</select></label>
      <label>Model name<input value={slug} onChange={event => { setSlug(event.target.value); resetTest() }} placeholder="deepseek-v4-flash" aria-label="Model name" /></label>
      <label>Efforts (comma separated, blank for default)<input value={efforts} onChange={event => { setEfforts(event.target.value); resetTest() }} placeholder="low, high" aria-label="Model efforts" /></label>
      <div className="model-row"><button className="secondary-button" onClick={() => void runTest()} disabled={testing}>{testing ? 'Testing…' : 'Test model'}</button><button className="secondary-button" onClick={() => void saveModel()} disabled={!testResult || testResult.failedEfforts.length > 0}>Save model</button></div>
      {testResult && <p className="secure-note">Efforts: {Object.entries(testResult.perEffort).map(([effort, result]) => `${effort || '(default)'}: ${result}`).join(' · ')} · Vision: {String(testResult.vision)} · Audio: {String(testResult.audio)}</p>}
      {testError && <p className="settings-error">{testError}</p>}
    </div></div>}
  </div>
}

function secondsLabel(value: number) { return Number.isFinite(value) ? value.toFixed(3) : '0.000' }

function ChatModelPicker({ snapshot, onChange, onSettings }: { snapshot: Snapshot; onChange: (modelId: string, effort: string) => void; onSettings: () => void }) {
  const models = snapshot.settings.chatModels
  const active = snapshot.settings.activeChat
  const current: ChatModelOption | undefined = models.find(entry => entry.id === active.modelId) ?? models[0]
  const efforts = current?.efforts ?? []
  const effort = efforts.length ? (efforts.includes(active.effort) ? active.effort : efforts[0]!) : ''
  useEffect(() => {
    if (current && (current.id !== active.modelId || effort !== active.effort)) onChange(current.id, effort)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, effort])
  if (!current) return <button type="button" className="model-picker-empty" onClick={onSettings}><Icon name="chip" /> Add a chat model</button>
  const providers = [...new Set(models.map(entry => entry.providerLabel))]
  return <span className="model-picker">
    <label className="model-select" title={`${current.providerLabel} · ${current.slug}`}><Icon name="chip" />
      <select aria-label="Chat model" value={current.id} onChange={event => {
        const next = models.find(entry => entry.id === event.target.value)
        if (next) onChange(next.id, next.efforts[0] ?? '')
      }}>
        {providers.map(provider => <optgroup key={provider} label={provider}>{models.filter(entry => entry.providerLabel === provider).map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</optgroup>)}
      </select>
      <Icon name="chevron-down" />
    </label>
    {efforts.length > 0 && <label className="model-select effort-select" title="Reasoning effort">
      <select aria-label="Reasoning effort" value={effort} onChange={event => onChange(current.id, event.target.value)}>
        {efforts.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <Icon name="chevron-down" />
    </label>}
  </span>
}

function ThemeOptions({ theme, onChange }: { theme: ThemeId; onChange: (id: ThemeId) => void }) {
  return <div className="theme-options" role="radiogroup" aria-label="Theme">
    {THEMES.map(entry => <button key={entry.id} type="button" role="radio" aria-checked={theme === entry.id} className={`theme-option${theme === entry.id ? ' theme-option-active' : ''}`} onClick={() => onChange(entry.id)}>
      <span className="theme-swatch" style={{ background: entry.swatch[0] }}><i style={{ background: entry.swatch[1] }} /><b style={{ background: entry.swatch[2] }} /></span>
      <span className="theme-copy"><strong>{entry.label}</strong><small>{entry.note}</small></span>
      {theme === entry.id && <Icon name="check" />}
    </button>)}
  </div>
}

function ThemePicker({ theme, onChange }: { theme: ThemeId; onChange: (id: ThemeId) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', outside); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('mousedown', outside); window.removeEventListener('keydown', escape) }
  }, [open])
  return <span className="theme-picker" ref={root}>
    <button type="button" className="icon-button" onClick={() => setOpen(value => !value)} aria-label="Theme" aria-expanded={open} title="Theme"><Icon name="palette" /></button>
    {open && <div className="theme-popover"><p className="eyebrow">Theme</p><ThemeOptions theme={theme} onChange={id => { onChange(id); setOpen(false) }} /></div>}
  </span>
}

function MusicProviderSettings({ snapshot, onSave, onDelete, onActivate }: { snapshot: Snapshot; onSave: (input: { id?: string; label: string; kind: MusicProviderKind; model: string }) => Promise<boolean>; onDelete: (id: string) => void; onActivate: (id: string) => void }) {
  const [kind, setKind] = useState<MusicProviderKind>('elevenlabs-music')
  const [label, setLabel] = useState('')
  const [model, setModel] = useState(MUSIC_MODELS['elevenlabs-music'][0]!.id)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const preset = MUSIC_PROVIDER_PRESETS.find(entry => entry.kind === kind)!
  const changeKind = (next: MusicProviderKind) => { setKind(next); setModel(MUSIC_MODELS[next][0]!.id) }
  const edit = (id: string) => {
    const provider = snapshot.settings.musicProviders.find(entry => entry.id === id)
    if (!provider) return
    setEditingId(provider.id); setKind(provider.kind); setLabel(provider.label); setModel(provider.model); setError(null)
  }
  const save = async () => {
    setError(null)
    if (!await onSave({ ...(editingId ? { id: editingId } : {}), label, kind, model })) { setError('Unable to save the music provider.'); return }
    setEditingId(null); setLabel('')
  }
  return <div className="music-providers">
    <p className="provider-note">Choose music models independently. Each vendor uses its one shared API key. A generation can target another configured music model.</p>
    {snapshot.settings.musicProviders.length > 0 && <div className="provider-list">
      {snapshot.settings.musicProviders.map(provider => <div key={provider.id} className={`provider-row ${provider.id === snapshot.settings.activeMusicId ? 'provider-active' : ''}`}>
        <label className="provider-choice">
          <input type="radio" name="active-music" checked={provider.id === snapshot.settings.activeMusicId} onChange={() => onActivate(provider.id)} aria-label={`Use ${provider.label} for music generation`} />
          <span><strong>{provider.label}</strong><small>{MUSIC_PROVIDER_PRESETS.find(entry => entry.kind === provider.kind)?.label ?? provider.kind} · {provider.model}</small></span>
        </label>
        <span className={`readiness ${provider.ready ? 'ready' : ''}`}><i />{provider.ready ? 'Key saved' : 'No key'}</span>
        <button className="mini-button" onClick={() => edit(provider.id)} aria-label={`Edit ${provider.label}`}><Icon name="edit" /></button>
        <button className="mini-button" onClick={() => onDelete(provider.id)} aria-label={`Delete ${provider.label}`}><Icon name="trash" /></button>
      </div>)}
    </div>}
    <div className="provider-form">
      <label>Provider type<select value={kind} onChange={event => changeKind(event.target.value as MusicProviderKind)} aria-label="Music provider type">{MUSIC_PROVIDER_PRESETS.map(entry => <option key={entry.kind} value={entry.kind}>{entry.label}</option>)}</select></label>
      <label>Provider name<input value={label} onChange={event => setLabel(event.target.value)} placeholder={preset.label} aria-label="Music provider name" /></label>
      <label>Model<select value={model} onChange={event => setModel(event.target.value)} aria-label="Music model">{MUSIC_MODELS[kind].map(entry => <option key={entry.id} value={entry.id}>{entry.label} — {entry.note}</option>)}</select></label>
      <div className="model-row"><button className="secondary-button" onClick={() => void save()} disabled={!label.trim()}>{editingId ? 'Update provider' : 'Save provider'}</button>{editingId && <button className="secondary-button" onClick={() => { setEditingId(null); setLabel('') }}>Cancel edit</button>}</div>
      {error && <p className="settings-error">{error}</p>}
    </div>
  </div>
}

const SETTINGS_PAGES = [
  { id: 'account', label: 'Account', icon: 'user', title: 'Codex account', blurb: 'Connect the assistant for sound design guidance and orchestration.' },
  { id: 'keys', label: 'API keys', icon: 'key', title: 'Provider API keys', blurb: 'One securely saved key per vendor, shared by effects, music, voice and direct Gemini chat.' },
  { id: 'chat', label: 'Chat models', icon: 'chip', title: 'Chat models', blurb: 'Custom OpenAI-compatible, Responses or Anthropic endpoints. Endpoints save without a network check; models save only after every listed effort passes a test.' },
  { id: 'music', label: 'Music', icon: 'music', title: 'Music models', blurb: 'Choose the music models generations can target. They use the shared vendor keys.' },
  { id: 'voice', label: 'Voice', icon: 'mic', title: 'Voice defaults', blurb: 'The default model and voice for each speech provider.' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', title: 'Appearance', blurb: 'Theme applies to this window and is remembered on this device.' },
  { id: 'agents', label: 'Agent integrations', icon: 'plug', title: 'Agent integrations', blurb: 'Install the sound-design skill for Codex or Claude Code and optionally register the local MCP server.' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'file', title: 'Diagnostics', blurb: 'Local logs keep failure details and request IDs. Credentials are redacted, and older logs rotate automatically.' },
] as const
type SettingsPage = typeof SETTINGS_PAGES[number]['id']

function SettingsDialog({ snapshot, theme, onTheme, onClose, onLogin, onCancelLogin, onLogout, onOpenLogs, onSaveMusicProvider, onDeleteMusicProvider, onSetActiveMusic }: { snapshot: Snapshot; theme: ThemeId; onTheme: (id: ThemeId) => void; onClose: () => void; onLogin: () => void; onCancelLogin: () => void; onLogout: () => void; onOpenLogs: () => void; onSaveMusicProvider: (input: { id?: string; label: string; kind: MusicProviderKind; model: string }) => Promise<boolean>; onDeleteMusicProvider: (id: string) => void; onSetActiveMusic: (id: string) => void }) {
  const [page, setPage] = useState<SettingsPage>('account')
  const current = SETTINGS_PAGES.find(entry => entry.id === page)!
  const keysReady = snapshot.settings.providerKeys.filter(key => key.ready).length
  const badge = (id: SettingsPage) => id === 'account' ? (snapshot.settings.codexReady ? 'ready' : '') : id === 'keys' ? `${keysReady}/2` : id === 'chat' ? String(snapshot.settings.chatModels.length) : id === 'music' ? String(snapshot.settings.musicProviders.length) : ''
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape) }, [onClose])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <nav className="settings-nav" aria-label="Settings sections">
        <h2 id="settings-title">Settings</h2>
        {SETTINGS_PAGES.map(entry => <button key={entry.id} type="button" className={page === entry.id ? 'settings-nav-active' : ''} aria-current={page === entry.id ? 'page' : undefined} onClick={() => setPage(entry.id)}>
          <Icon name={entry.icon} /><span>{entry.label}</span>{badge(entry.id) === 'ready' ? <i className="settings-nav-dot" /> : badge(entry.id) && <small>{badge(entry.id)}</small>}
        </button>)}
        <p className="settings-nav-foot"><Icon name="lock" /> Secure storage {snapshot.settings.secureStorageAvailable ? 'available' : 'waiting for desktop host'}</p>
      </nav>
      <div className="settings-main">
        <header className="settings-page-header"><div><h3>{current.title}</h3><p>{current.blurb}</p></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><Icon name="close" /></button></header>
        <div className="settings-body">
          {snapshot.settings.error && <p className="settings-error settings-banner"><Icon name="info" /> {snapshot.settings.error}</p>}
          {page === 'account' && <section className="settings-section settings-card"><div className="settings-section-heading"><div><h3>Codex</h3><p>Sign in with your ChatGPT account in the system browser. Tokens stay in OS-backed secure storage.</p></div><span className={`readiness ${snapshot.settings.codexReady ? 'ready' : ''}`}><i />{snapshot.settings.codexReady ? 'Connected' : snapshot.settings.loginPending ? 'Waiting for browser' : 'Not connected'}</span></div>{snapshot.settings.loginPending ? <button className="secondary-button" onClick={onCancelLogin}>Cancel sign in</button> : snapshot.settings.codexReady ? <button className="secondary-button" onClick={onLogout}>Log out</button> : <button className="primary-button" onClick={onLogin}>Connect Codex</button>}</section>}
          {page === 'keys' && <SharedProviderKeys snapshot={snapshot} />}
          {page === 'chat' && <ChatProviderSettings snapshot={snapshot} />}
          {page === 'music' && <MusicProviderSettings snapshot={snapshot} onSave={onSaveMusicProvider} onDelete={onDeleteMusicProvider} onActivate={onSetActiveMusic} />}
          {page === 'voice' && <VoiceSettings snapshot={snapshot} />}
          {page === 'appearance' && <ThemeOptions theme={theme} onChange={onTheme} />}
          {page === 'agents' && <AgentSettings />}
          {page === 'diagnostics' && <section className="settings-section settings-card"><div className="settings-section-heading"><div><h3>Diagnostic logs</h3><p>Open the folder to attach logs to a bug report. Request IDs help providers trace failures.</p></div></div><button className="secondary-button" onClick={onOpenLogs}><Icon name="folder" /> Open diagnostic logs</button></section>}
        </div>
      </div>
    </section>
  </div>
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot)
  const [uiError, setUiError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('effect')
  const [query, setQuery] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeId>(storedTheme)
  const changeTheme = (id: ThemeId) => { applyTheme(id); setTheme(id) }
  const [deletion, setDeletion] = useState<{ kind: 'project' | 'conversation'; id: string; projectId: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [projectDialog, setProjectDialog] = useState<'create' | 'rename' | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(34)
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null)
  const [pendingUiCommand, setPendingUiCommand] = useState<UiCommand | null>(null)
  const [auditionState, setAuditionState] = useState<AuditionState>({ status: 'stopped', updatedAt: '' })
  const audition = useRef<AuditionPlayer | null>(null)
  if (!audition.current) audition.current = new AuditionPlayer(setAuditionState)
  const handledUi = useRef<string | null>(null)
  const refreshSerial = useRef(0)
  const lastProject = useRef<string | null>(null)
  const resizingRef = useRef(false)

  const refresh = useCallback(async () => {
    const serial = ++refreshSerial.current
    try { const next = await api()?.snapshot(); if (next && serial === refreshSerial.current) { const projectChanged = lastProject.current !== null && lastProject.current !== next.activeProjectId; lastProject.current = next.activeProjectId; setSnapshot(next); if (projectChanged) { setPlayingKey(null); setQuery('') }; setConversationId(current => current && next.conversations.some(item => item.id === current) ? current : (next.conversations[0]?.id || null)); setSelectedAssetId(current => current && next.assets.some(item => item.id === current) ? current : null) } } catch (error) { setUiError(error instanceof Error ? error.message : 'Unable to refresh the workbench.') }
  }, [])
  useEffect(() => {
    const unsubscribe = api().onUiCommand(command => {
      void (async () => {
        try {
          audition.current!.stop(); setPlayingKey(null)
          if (command.action !== 'stop') {
            const next = await api().snapshot(); ++refreshSerial.current
            lastProject.current = next.activeProjectId; setSnapshot(next); setConversationId(command.sessionId)
            setSelectedReviewId(command.reviewId ?? null); setTab('playground')
          }
          setPendingUiCommand(command)
        } catch (e) { await api().uiAcknowledge(command.id, e instanceof Error ? e.message : 'Could not open review.') }
      })()
    })
    void api().uiReady()
    const hidden = () => { if (document.hidden) { audition.current!.stop(); setPlayingKey(null) } }
    const disconnected = () => { audition.current!.stop(); setPlayingKey(null); document.querySelectorAll('audio').forEach(audio => audio.pause()); setUiError('Browser host disconnected. Restart npm run dev:browser and open its printed URL.'); }
    const otherPlayback = (event: Event) => { if (event.target instanceof HTMLMediaElement) audition.current!.stop() }
    document.addEventListener('visibilitychange', hidden); document.addEventListener('play', otherPlayback, true); window.addEventListener('sfx-host-disconnected', disconnected)
    return () => { unsubscribe(); audition.current!.dispose(); document.removeEventListener('visibilitychange', hidden); document.removeEventListener('play', otherPlayback, true); window.removeEventListener('sfx-host-disconnected', disconnected) }
  }, [])
  useEffect(() => { audition.current!.stop(); setPlayingKey(null) }, [snapshot.activeProjectId, conversationId, selectedReviewId, tab, snapshot.reviews.find(review => review.id === selectedReviewId)?.revision])
  useEffect(() => {
    const command = pendingUiCommand
    if (!command || handledUi.current === command.id) return
    if (command.action !== 'stop' && (snapshot.activeProjectId !== command.projectId || conversationId !== command.sessionId || selectedReviewId !== command.reviewId)) return
    handledUi.current = command.id
    void (async () => {
      try { audition.current!.stop(); await api().uiAcknowledge(command.id) }
      catch (e) { await api().uiAcknowledge(command.id, e instanceof Error ? e.message : 'Playback failed.') }
    })()
  }, [pendingUiCommand, snapshot.activeProjectId, conversationId, selectedReviewId])
  useEffect(() => { void refresh(); const unsubscribe = api()?.onChanged?.(() => void refresh()); return () => unsubscribe?.() }, [refresh])
  useEffect(() => { const handle = (event: MouseEvent) => { if (!resizingRef.current || event.buttons !== 1) return; const next = Math.min(48, Math.max(24, (event.clientX / window.innerWidth) * 100)); setSidebarWidth(next) }; const stop = () => { resizingRef.current = false; document.body.classList.remove('resizing') }; const start = () => { resizingRef.current = true; document.body.classList.add('resizing') }; const handleEl = document.getElementById('resize-handle'); handleEl?.addEventListener('mousedown', start); window.addEventListener('mousemove', handle); window.addEventListener('mouseup', stop); return () => { handleEl?.removeEventListener('mousedown', start); window.removeEventListener('mousemove', handle); window.removeEventListener('mouseup', stop) } }, [])

  const activeReview = snapshot.reviews.find(review => review.id === selectedReviewId)
  const reviewCount = activeReview?.cues.reduce((count, cue) => count + cue.candidates.length + (cue.referenceId ? 1 : 0), 0)
  const selectedAsset = snapshot.assets.find(asset => asset.id === selectedAssetId) || null
  const playgroundIds = snapshot.playground[snapshot.activeProjectId] || []
  const effectCount = snapshot.assets.filter(asset => (asset.kind ?? 'effect') === 'effect').length
  const voiceCount = snapshot.assets.filter(asset => asset.kind === 'voice').length
  const musicCount = snapshot.assets.filter(asset => asset.kind === 'music').length
  const midiCount = snapshot.assets.filter(asset => asset.kind === 'midi').length
  const call = async (action: () => Promise<unknown>): Promise<boolean> => { try { await action(); void refresh(); return true } catch (error) { setUiError(error instanceof Error ? error.message : 'Operation failed.'); return false } }
  const conversation = snapshot.conversations.find(item => item.id === conversationId) ?? null
  const activeProject = snapshot.projects.find(project => project.id === snapshot.activeProjectId) ?? null
  const switchProject = (id: string) => { if (id !== snapshot.activeProjectId) void call(() => api().setActiveProject(id)) }
  const renameSession = (id: string, title: string) => void call(() => api().renameConversation(id, title))
  const projectAction = async (action: () => Promise<unknown>) => { if (await call(action)) setProjectDialog(null) }
  const confirmDelete = async () => {
    if (!deletion || deleting) return
    setDeleting(true); setDeleteError('')
    try {
      await workbench(deletion.kind === 'project' ? 'project_delete' : 'session_delete', { projectId: deletion.projectId, ...(deletion.kind === 'conversation' ? { sessionId: deletion.id } : {}) })
      audition.current!.stop(); setPlayingKey(null); setDeletion(null); await refresh()
    } catch (error) { setDeleteError(error instanceof Error ? error.message : 'Deletion failed.') }
    finally { setDeleting(false) }
  }
  const createConversation = async () => { try { const id = await api()?.createConversation(); if (id) { await refresh(); setConversationId(id) } } catch (error) { setUiError(error instanceof Error ? error.message : 'Unable to create a conversation.') } }
  const selectAsset = (id: string) => { setSelectedAssetId(id) }
  const play = useCallback((key: string, playing: boolean) => setPlayingKey(current => playing ? key : current === key ? null : current), [])
  const playingId = playingKey
  const updatePlayground = (ids: string[]) => { if (conversationId) void call(() => api().setPlayground(conversationId, ids)) }
  const moveAsset = (id: string, direction: -1 | 1) => { const index = playgroundIds.indexOf(id); const next = index + direction; if (index < 0 || next < 0 || next >= playgroundIds.length) return; const ids = [...playgroundIds]; [ids[index], ids[next]] = [ids[next], ids[index]]; updatePlayground(ids) }
  const removeAsset = (id: string) => updatePlayground(playgroundIds.filter(value => value !== id))

  const sendMessage = async (text: string) => conversationId ? call(() => api().sendMessage(conversationId, text)) : false
  const generateSound = async (input: GenerationInput) => conversationId ? call(() => api().generate(conversationId, input)) : false
  const generateVoice = async (input: VoiceGenerationInput) => conversationId ? call(() => api().generateVoice(conversationId, input)) : false
  const generateMusic = async (input: MusicGenerationInput) => conversationId ? call(() => api().generateMusic(conversationId, input)) : false
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
  return <div className="app-shell" style={{ '--sidebar-width': `${sidebarWidth}%` } as React.CSSProperties}><ChatSidebar snapshot={snapshot} projectName={activeProject?.name ?? 'Project'} selectedId={conversationId} onSelect={setConversationId} onNew={createConversation} onRename={renameSession} onDelete={() => { if (conversation) { setDeleteError(''); setDeletion({ kind: 'conversation', id: conversation.id, projectId: snapshot.activeProjectId, name: conversation.title }) } }} onSend={sendMessage} onStop={() => { if (conversationId) void call(() => api().cancelTurn(conversationId)) }} onChangeModel={(modelId, effort) => { void call(() => api().setActiveChat({ modelId, effort })) }} onSettings={() => setSettingsOpen(true)} />{uiError && <div className="error-banner" role="alert"><Icon name="info" /><span>{uiError}</span><button className="icon-button" onClick={() => setUiError(null)} aria-label="Dismiss error"><Icon name="close" /></button></div>}<div className="resize-handle" id="resize-handle" role="separator" aria-label="Resize chat sidebar" tabIndex={0} onKeyDown={event => { if (event.key === 'ArrowLeft') setSidebarWidth(value => Math.max(24, value - 2)); if (event.key === 'ArrowRight') setSidebarWidth(value => Math.min(48, value + 2)) }}><span /></div><main className="main-workspace"><header className="topbar"><div className="breadcrumb"><ProjectSwitcher snapshot={snapshot} onSwitch={switchProject} onCreate={() => setProjectDialog('create')} onRename={() => setProjectDialog('rename')} onDelete={() => { if (activeProject) { setDeleteError(''); setDeletion({ kind: 'project', id: activeProject.id, projectId: activeProject.id, name: activeProject.name }) } }} /><span className="breadcrumb-sep">/</span>{conversation ? <EditableTitle value={conversation.title} onCommit={title => void renameSession(conversation.id, title)} /> : <strong>New session</strong>}</div><div className="topbar-actions"><span className={`host-status${snapshot.settings.codexReady ? ' host-ready' : ''}`} title={api().hostMode === 'browser' ? 'Browser development · real library and secure provider operations' : snapshot.settings.codexReady ? 'Codex account connected' : 'Codex is not connected; open Settings to sign in'}><i />{api().hostMode === 'browser' && 'Browser · '}{snapshot.settings.codexReady ? 'Connected' : 'Local only'}</span><ThemePicker theme={theme} onChange={changeTheme} /><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings" title="Settings"><Icon name="settings" /></button></div></header><nav className="workspace-tabs" aria-label="Workspace view"><button className={tab === 'effect' ? 'tab-active' : ''} onClick={() => setTab('effect')}><Icon name="waveform" /> Effects <span>{effectCount}</span></button><button className={tab === 'music' ? 'tab-active' : ''} onClick={() => setTab('music')}><Icon name="music" /> Music <span>{musicCount}</span></button><button className={tab === 'voice' ? 'tab-active' : ''} onClick={() => setTab('voice')}><Icon name="mic" /> Voice <span>{voiceCount}</span></button><button className={tab === 'midi' ? 'tab-active' : ''} onClick={() => setTab('midi')}><Icon name="piano" /> MIDI Studio <span>{midiCount}</span></button><button className={tab === 'playground' ? 'tab-active' : ''} onClick={() => setTab('playground')}><Icon name="play" /> Playground <span>{reviewCount ?? playgroundIds.length}</span></button></nav>{tab === 'playground' ? <Playground key={snapshot.activeProjectId} reviewCount={reviewCount} reviewResults={activeReview && conversationId ? <ReviewPanel key={activeReview.id} snapshot={snapshot} sessionId={conversationId} selectedId={activeReview.id} onSelect={setSelectedReviewId} onSelectAsset={selectAsset} playback={auditionState} onSeek={position => audition.current!.seek(position)} onStop={() => audition.current!.stop()} onPlay={input => { setPlayingKey(null); return audition.current!.play(input) }} /> : undefined} reviewControls={!activeReview && conversationId && <ReviewLauncher snapshot={snapshot} onSelect={setSelectedReviewId} />} assets={snapshot.assets} jobs={snapshot.jobs} conversationId={conversationId} selectedId={selectedAssetId} playgroundIds={playgroundIds} musicProviders={snapshot.settings.musicProviders} activeMusicId={snapshot.settings.activeMusicId} voiceProviders={snapshot.settings.voiceProviders} activeVoiceId={snapshot.settings.activeVoiceId} onGenerateVoice={generateVoice} onSelect={selectAsset} onPlay={play} playingId={playingId} onGenerate={generateSound} onGenerateMusic={generateMusic} onCancelJob={id => void call(() => api().cancelJob(id))} onRemove={removeAsset} onMove={moveAsset} onOpenInspector={() => setInspectorOpen(true)} /> : tab === 'midi' ? <MidiStudio assets={snapshot.assets} conversationId={conversationId} selectedId={selectedAssetId} onSelect={setSelectedAssetId} onSaved={async () => { await refresh() }} /> : <Library kind={tab} assets={snapshot.assets} selectedId={selectedAssetId} query={query} setQuery={setQuery} onSelect={selectAsset} onImport={() => conversationId && void call(() => api().importAudio(conversationId, tab))} onPlay={play} playingId={playingId} onOpenInspector={() => setInspectorOpen(true)} onAddToPlayground={() => { if (selectedAssetId) updatePlayground([...playgroundIds, selectedAssetId]) }} inPlayground={selectedAssetId ? playgroundIds.includes(selectedAssetId) : false} />}</main>{inspectorOpen && <Inspector assets={snapshot.assets} voiceProviders={snapshot.settings.voiceProviders} activeVoiceId={snapshot.settings.activeVoiceId} asset={selectedAsset} onClose={() => setInspectorOpen(false)} onSave={async patch => { if (selectedAsset && await call(() => api().updateAsset(selectedAsset.id, patch, conversationId || undefined))) setInspectorOpen(false) }} onExport={format => selectedAsset && void call(() => api().exportAsset(selectedAsset.id, format))} onPlay={play} isPlaying={playingKey === selectedAssetId} playingKey={playingKey} onRegenerate={input => { if (conversationId) void call(() => input.kind === 'voice' ? api().generateVoice(conversationId, input) : input.kind === 'music' ? api().generateMusic(conversationId, input) : api().generate(conversationId, input)) }} onTrim={trimAsset} />}{settingsOpen && <SettingsDialog snapshot={snapshot} theme={theme} onTheme={changeTheme} onClose={() => setSettingsOpen(false)} onLogin={() => void call(() => api().startLogin())} onCancelLogin={() => void call(() => api().cancelLogin())} onLogout={() => void call(() => api().logout())} onOpenLogs={() => void call(() => api().openLogs())} onSaveMusicProvider={input => call(() => api().saveMusicProvider(input))} onDeleteMusicProvider={id => void call(() => api().deleteMusicProvider(id))} onSetActiveMusic={id => void call(() => api().setActiveMusic(id))} />}{deletion && <div className="modal-backdrop"><section className="settings-dialog project-dialog" role="dialog" aria-modal="true" aria-label={`Delete ${deletion.kind}`}><div className="drawer-header"><h2>Delete {deletion.kind}?</h2></div><div className="project-dialog-body"><p><strong>{deletion.name}</strong></p><p>{deletion.kind === 'project' ? 'This permanently removes the project, its conversations, reviews, and library records. Original media files remain on disk.' : 'This permanently removes this conversation, its messages, and job history. Project audio, reviews, and the shared Playground remain available.'}</p><p>This cannot be undone.</p>{deleteError && <p role="alert" className="settings-error">{deleteError}</p>}<div className="model-row"><button className="primary-button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Deleting…' : `Delete ${deletion.kind}`}</button><button className="secondary-button" disabled={deleting} onClick={() => setDeletion(null)}>Cancel</button></div></div></section></div>}{projectDialog && <ProjectDialog mode={projectDialog} project={activeProject} onClose={() => setProjectDialog(null)} onCreate={name => void projectAction(() => api().createProject(name))} onRename={(id, name) => void projectAction(() => api().renameProject(id, name))} />}</div>
}
