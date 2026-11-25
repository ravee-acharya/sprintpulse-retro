/**
 * Runtime environment detection.
 *
 * Inside Jira, Custom UI runs in an iframe and @forge/bridge talks to the host.
 * Outside Jira (plain `vite` dev server), with `?mock` in the URL, or when
 * `window.__FORGE_MOCK__` is set, the app uses the Local Mock Adapter (fleshed
 * out in Stage 3) so the full UI can be exercised in a normal browser with
 * simulated multi-user state.
 */
declare global {
  interface Window {
    __FORGE_MOCK__?: boolean;
  }
}

export function isMockMode(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.__FORGE_MOCK__) return true;
  if (new URLSearchParams(window.location.search).has('mock')) return true;
  try {
    // Not framed -> not inside Jira.
    return window.self === window.top;
  } catch {
    // Reading window.top across origins throws only when framed.
    return false;
  }
}
