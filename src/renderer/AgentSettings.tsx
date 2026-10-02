import { useState } from 'react';
import type { InstallationInput } from '../shared/workbench';

export default function AgentSettings() {
  const [directory, setDirectory] = useState('');
  const [scope, setScope] = useState<'project' | 'user'>('project'); const [project, setProject] = useState('');
  const [codex, setCodex] = useState(true), [claude, setClaude] = useState(false), [mcp, setMcp] = useState(false), [force, setForce] = useState(false);
  const [result, setResult] = useState(''), [busy, setBusy] = useState(false);
  const run = async (action: InstallationInput['action'], dryRun = false) => {
    setBusy(true); try {
      const response = await window.sfx.installIntegration({ action, scope, targets: [...(codex ? ['codex' as const] : []), ...(claude ? ['claude' as const] : [])], projectDirectory: project || undefined, directory: directory || undefined, skill: true, mcp, force, dryRun });
      setResult(response.ok ? JSON.stringify(response.result, null, 2) : response.error?.message ?? 'Installation failed.');
    } catch (e) { setResult(e instanceof Error ? e.message : 'Installation failed.'); } finally { setBusy(false); }
  };
  return <section className="settings-section"><h3>Agent integrations</h3><p>Install the complete sound-design skill and optionally register the local MCP server. The bundled CLI starts SfxChat when needed.</p>
    <div className="review-toolbar"><label>Scope<select value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="project">This project directory</option><option value="user">Harness-wide for this user</option></select></label><label><input type="checkbox" checked={codex} onChange={e => setCodex(e.target.checked)} /> Codex</label><label><input type="checkbox" checked={claude} onChange={e => setClaude(e.target.checked)} /> Claude Code</label></div>
    {scope === 'project' && <div className="review-toolbar"><input aria-label="Integration project directory" value={project} onChange={e => setProject(e.target.value)} placeholder="Absolute project directory" /><button onClick={() => void window.sfx.chooseDirectory().then(path => { if (path) setProject(path); })}>Browse</button></div>}
    <label>Custom skills directory (optional)<input value={directory} onChange={e => setDirectory(e.target.value)} placeholder="Absolute skills parent directory" /></label>
    <label><input type="checkbox" checked={mcp} onChange={e => setMcp(e.target.checked)} /> Also register MCP</label><label><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} /> Replace conflicting SfxChat files/entry (backup retained)</label>
    <div className="review-toolbar"><button disabled={busy} onClick={() => void run('status')}>Installation status</button><button disabled={busy} onClick={() => void run('install', true)}>Preview changes</button><button disabled={busy} onClick={() => void run('install')}>Install / update</button><button disabled={busy} onClick={() => void run('uninstall')}>Uninstall integration</button><button onClick={() => void window.sfx.operation('status', {}).then(r => setResult(JSON.stringify(r, null, 2)))}>Connection status</button></div>
    {result && <pre className="integration-result" role="status">{result}</pre>}
  </section>;
}
