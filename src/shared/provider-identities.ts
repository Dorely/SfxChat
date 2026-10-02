/** Recognize Google's direct endpoint, never a third-party proxy by its label. */
export function isDirectGemini(baseUrl: string): boolean {
  try { const url = new URL(baseUrl); return url.protocol === 'https:' && url.hostname === 'generativelanguage.googleapis.com' && !url.port; } catch { return false; }
}
